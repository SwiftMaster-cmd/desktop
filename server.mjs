import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { DesktopStore, AppError } from "./src/store.mjs";

const scrypt = promisify(scryptCallback);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const sessionAge = 60 * 60 * 24 * 7;
const cookieName = "bossman_session";

async function passwordRecord(password) {
  if (
    typeof password !== "string" ||
    password.length < 10 ||
    password.length > 256
  )
    throw new AppError(400, "Use a password with 10–256 characters.");
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}
async function checkPassword(password, record) {
  if (typeof password !== "string" || password.length > 256) return false;
  const [salt, stored] = record.split(":");
  const derived = await scrypt(password, salt, 64);
  return timingSafeEqual(Buffer.from(stored, "hex"), derived);
}
function sessionToken(request) {
  const entry = (request.headers.cookie ?? "")
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${cookieName}=`));
  const token = entry?.slice(cookieName.length + 1) ?? "";
  return /^[a-f0-9]{64}$/.test(token) ? token : "";
}
function cookie(request, token, maxAge = sessionAge) {
  const secure =
    request.socket.encrypted || request.headers.origin?.startsWith("https://");
  return `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
function checkOrigin(request) {
  if (request.headers["sec-fetch-site"] === "cross-site")
    throw new AppError(403, "Cross-site requests are not allowed.");
  try {
    const origin = new URL(request.headers.origin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.host !== request.headers.host
    )
      throw new Error();
  } catch {
    throw new AppError(403, "Write requests must come from this desktop.");
  }
}
async function readJSON(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 5 * 1024 * 1024)
      throw new AppError(413, "This backup is too large. The limit is 5 MB.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new AppError(400, "Send a valid JSON object.");
  }
}
function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

export async function startServer({
  port = Number(process.env.PORT ?? 3000),
  host = process.env.HOST ?? "127.0.0.1",
  dataDir = resolve(process.env.DATA_DIR ?? ".data"),
} = {}) {
  const store = new DesktopStore(dataDir);
  const loginAttempts = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "same-origin");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      if (!url.pathname.startsWith("/api/")) {
        if (!["GET", "HEAD"].includes(request.method))
          throw new AppError(405, "Method not allowed.");
        const route = decodeURIComponent(url.pathname);
        const file = resolve(
          publicDir,
          `.${route === "/" ? "/index.html" : route}`,
        );
        if (!file.startsWith(`${publicDir}/`))
          throw new AppError(404, "Not found.");
        let data;
        try {
          if (!(await stat(file)).isFile()) throw new Error();
          data = await readFile(file);
        } catch {
          throw new AppError(404, "Not found.");
        }
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".mjs": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".json": "application/json",
        };
        response.writeHead(200, {
          "Content-Type": types[extname(file)] ?? "application/octet-stream",
        });
        response.end(request.method === "HEAD" ? undefined : data);
        return;
      }
      if (!["GET", "POST", "PUT", "DELETE"].includes(request.method))
        throw new AppError(405, "Method not allowed.");
      if (request.method !== "GET") checkOrigin(request);
      const configured = Boolean(store.getSetting("password"));
      const token = sessionToken(request);
      const authenticated = Boolean(token && store.hasSession(hash(token)));
      if (url.pathname === "/api/auth" && request.method === "GET") {
        json(response, 200, { configured, authenticated });
        return;
      }
      if (
        ["/api/setup", "/api/login"].includes(url.pathname) &&
        request.method === "POST"
      ) {
        const remote = request.socket.remoteAddress;
        const now = Date.now();
        let attempts = loginAttempts.get(remote);
        if (!attempts || now - attempts.started > 60_000) {
          attempts = { started: now, count: 0 };
          loginAttempts.set(remote, attempts);
        }
        if (++attempts.count > 10)
          throw new AppError(
            429,
            "Too many attempts. Wait one minute and try again.",
          );
        const body = await readJSON(request);
        if (url.pathname === "/api/setup") {
          if (configured)
            throw new AppError(
              409,
              "This desktop already has a password. Sign in instead.",
            );
          const record = await passwordRecord(body.password);
          // Recheck after asynchronous password derivation to serialize first-time setup.
          if (store.getSetting("password"))
            throw new AppError(
              409,
              "This desktop already has a password. Sign in instead.",
            );
          store.setSetting("password", record);
        } else {
          if (
            !configured ||
            !(await checkPassword(body.password, store.getSetting("password")))
          )
            throw new AppError(401, "The password is incorrect.");
        }
        loginAttempts.delete(remote);
        const newToken = randomBytes(32).toString("hex");
        store.addSession(hash(newToken), now + sessionAge * 1000);
        json(
          response,
          200,
          { authenticated: true },
          { "Set-Cookie": cookie(request, newToken) },
        );
        return;
      }
      if (!authenticated)
        throw new AppError(401, "Sign in to open your desktop.");
      if (url.pathname === "/api/logout" && request.method === "POST") {
        store.removeSession(hash(token));
        json(
          response,
          200,
          { authenticated: false },
          { "Set-Cookie": cookie(request, "", 0) },
        );
        return;
      }
      if (url.pathname === "/api/items") {
        if (request.method === "GET") {
          json(response, 200, { items: store.list() });
          return;
        }
        if (request.method === "POST") {
          json(response, 201, { item: store.create(await readJSON(request)) });
          return;
        }
      }
      const itemRoute = url.pathname.match(
        /^\/api\/items\/([a-z0-9_-]{1,128})(\/history)?$/i,
      );
      if (itemRoute) {
        if (itemRoute[2] && request.method === "GET") {
          json(response, 200, { revisions: store.history(itemRoute[1]) });
          return;
        }
        if (!itemRoute[2] && request.method === "PUT") {
          json(response, 200, {
            item: store.update(itemRoute[1], await readJSON(request)),
          });
          return;
        }
        if (!itemRoute[2] && request.method === "DELETE") {
          const body = await readJSON(request);
          json(response, 200, {
            item: store.archive(itemRoute[1], body.version),
          });
          return;
        }
      }
      if (url.pathname === "/api/export" && request.method === "GET") {
        json(
          response,
          200,
          {
            format: "bossmans-desktop",
            version: 1,
            exportedAt: new Date().toISOString(),
            items: store.list(),
          },
          {
            "Content-Disposition":
              'attachment; filename="bossmans-desktop-backup.json"',
          },
        );
        return;
      }
      if (url.pathname === "/api/import" && request.method === "POST") {
        const body = await readJSON(request);
        json(response, 200, store.import(body.items));
        return;
      }
      throw new AppError(404, "This endpoint was not found.");
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }
      if (!(error instanceof AppError))
        console.error("Desktop request failed:", error.message);
      json(response, error instanceof AppError ? error.status : 500, {
        error:
          error instanceof AppError
            ? error.message
            : "The desktop could not complete that request.",
      });
    }
  });
  try {
    await new Promise((resolveListening, reject) => {
      server.once("error", reject);
      server.listen(port, host, resolveListening);
    });
  } catch (error) {
    store.close();
    throw error;
  }
  const address = server.address();
  return {
    server,
    store,
    port: address.port,
    host,
    close: () =>
      new Promise((resolveClosed, reject) => {
        server.close((error) => {
          store.close();
          if (error) reject(error);
          else resolveClosed();
        });
        server.closeIdleConnections();
      }),
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = await startServer();
  console.log(
    `Bossman's Desktop is listening on http://${app.host}:${app.port}`,
  );
  console.log(
    "Personal data stays in DATA_DIR (default: .data). Complete password setup in your browser.",
  );
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, async () => {
      if (closing) return;
      closing = true;
      await app.close();
      process.exit(0);
    });
}
