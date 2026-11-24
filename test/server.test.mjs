import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.mjs";

const password = "a sensible desktop password";
const example = {
  title: "Farm plan",
  kind: "note",
  content: "Build a bamboo farm.",
  color: "teal",
  workspace: "Minecraft",
  pinned: true,
};
async function harness(t) {
  const dataDir = await mkdtemp(join(tmpdir(), "bossman-test-"));
  let app = await startServer({ port: 0, dataDir });
  let session = "";
  const request = async (path, method = "GET", data, overrides = {}) => {
    const origin = `http://127.0.0.1:${app.port}`;
    const response = await fetch(`${origin}${path}`, {
      method,
      headers: {
        ...(method !== "GET"
          ? { Origin: origin, "Content-Type": "application/json" }
          : {}),
        ...(session ? { Cookie: session } : {}),
        ...overrides,
      },
      ...(data === undefined
        ? {}
        : { body: typeof data === "string" ? data : JSON.stringify(data) }),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) session = setCookie.split(";")[0];
    return {
      status: response.status,
      headers: response.headers,
      body: await response.json(),
    };
  };
  t.after(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  return {
    origin: () => `http://127.0.0.1:${app.port}`,
    request,
    setup: () => request("/api/setup", "POST", { password }),
    restart: async () => {
      await app.close();
      app = await startServer({ port: 0, dataDir });
    },
    clearSession: () => {
      session = "";
    },
  };
}

test("password setup, protected data, persistent sessions, login and logout", async (t) => {
  const h = await harness(t);
  assert.deepEqual((await h.request("/api/auth")).body, {
    configured: false,
    authenticated: false,
  });
  assert.equal((await h.request("/api/export")).status, 401);
  assert.equal((await h.request("/api/items")).status, 401);
  assert.equal(
    (await h.request("/api/setup", "POST", { password: "short" })).status,
    400,
  );
  const setup = await h.setup();
  assert.equal(setup.status, 200);
  assert.match(setup.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  assert.equal(
    (await h.request("/api/setup", "POST", { password })).status,
    409,
  );
  await h.restart();
  assert.deepEqual((await h.request("/api/auth")).body, {
    configured: true,
    authenticated: true,
  });
  assert.equal((await h.request("/api/logout", "POST", {})).status, 200);
  assert.equal((await h.request("/api/export")).status, 401);
  assert.equal(
    (await h.request("/api/login", "POST", { password: "wrong password" }))
      .status,
    401,
  );
  assert.equal(
    (await h.request("/api/login", "POST", { password })).status,
    200,
  );
});

test("items survive restart; updates preserve history and reject stale edits", async (t) => {
  const h = await harness(t);
  await h.setup();
  const created = await h.request("/api/items", "POST", example);
  assert.equal(created.status, 201);
  const item = created.body.item;
  assert.equal(item.version, 1);
  const changed = await h.request(`/api/items/${item.id}`, "PUT", {
    ...item,
    content: "Collect supplies first.",
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.item.version, 2);
  const stale = await h.request(`/api/items/${item.id}`, "PUT", {
    ...item,
    content: "Lost update",
  });
  assert.equal(stale.status, 409);
  const history = (await h.request(`/api/items/${item.id}/history`)).body
    .revisions;
  assert.deepEqual(
    history.map((value) => value.version),
    [2, 1],
  );
  assert.equal(history[1].content, example.content);
  await h.restart();
  assert.equal(
    (await h.request("/api/items")).body.items[0].content,
    "Collect supplies first.",
  );
  const trashed = await h.request(`/api/items/${item.id}`, "DELETE", {
    version: 2,
  });
  assert.equal(trashed.body.item.archived, true);
  const restored = await h.request(`/api/items/${item.id}`, "PUT", {
    ...trashed.body.item,
    archived: false,
  });
  assert.equal(restored.body.item.archived, false);
});

test("cross-site writes, invalid JSON and unsafe shortcut protocols are rejected", async (t) => {
  const h = await harness(t);
  const blockedSetup = await h.request(
    "/api/setup",
    "POST",
    { password },
    { Origin: "https://other.example" },
  );
  assert.equal(blockedSetup.status, 403);
  await h.setup();
  assert.equal(
    (
      await h.request("/api/items", "POST", example, {
        Origin: "https://other.example",
      })
    ).status,
    403,
  );
  assert.equal(
    (await h.request("/api/items", "POST", example, { Origin: "" })).status,
    403,
  );
  assert.equal(
    (await h.request("/api/items", "POST", "{bad JSON")).status,
    400,
  );
  assert.equal(
    (
      await h.request("/api/items", "POST", {
        ...example,
        kind: "link",
        content: "javascript:alert(1)",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.request("/api/items", "POST", {
        ...example,
        kind: "link",
        content: "https://minecraft.wiki/",
      })
    ).status,
    201,
  );
  assert.equal(
    (await h.request("/api/items", "POST", { ...example, pinned: "yes" }))
      .status,
    400,
  );
});

test("backup import is atomic, additive and deduplicated; exports omit credentials", async (t) => {
  const h = await harness(t);
  await h.setup();
  const legacy = {
    id: "legacy-note-1",
    title: "Minecraft Realm",
    kind: "note",
    content: "Original content",
    color: "blue",
  };
  const imported = await h.request("/api/import", "POST", {
    items: [legacy, legacy],
  });
  assert.deepEqual(imported.body, { imported: 1, skipped: 1 });
  const again = await h.request("/api/import", "POST", {
    items: [{ ...legacy, content: "Must not overwrite" }],
  });
  assert.deepEqual(again.body, { imported: 0, skipped: 1 });
  const invalid = await h.request("/api/import", "POST", {
    items: [
      { ...legacy, id: "would-be-new" },
      { ...legacy, id: "broken", kind: "link", content: "file:///etc/passwd" },
    ],
  });
  assert.equal(invalid.status, 400);
  const exported = (await h.request("/api/export")).body;
  assert.equal(exported.format, "bossmans-desktop");
  assert.equal(exported.version, 1);
  assert.equal(exported.items.length, 1);
  assert.equal(exported.items[0].workspace, "Minecraft");
  assert.equal(exported.items[0].content, "Original content");
  assert.deepEqual(Object.keys(exported).sort(), [
    "exportedAt",
    "format",
    "items",
    "version",
  ]);
  h.clearSession();
  assert.equal(
    (await h.request("/api/import", "POST", { items: [legacy] })).status,
    401,
  );
  assert.equal(
    (await h.request("/api/items/legacy-note-1/history")).status,
    401,
  );
});

test("the desktop entry point and its module are served with browser-compatible types", async (t) => {
  const h = await harness(t);
  const page = await fetch(h.origin());
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  const html = await page.text();
  const moduleSource = html.match(
    /<script[^>]*type="module"[^>]*src="([^"\s]+)"/,
  );
  assert.ok(moduleSource, "index.html declares a module entry point");
  const script = await fetch(new URL(moduleSource[1], h.origin()));
  assert.equal(script.status, 200);
  assert.match(
    script.headers.get("content-type"),
    /^(text|application)\/javascript/,
  );
  assert.ok((await script.text()).length > 0, "the module has content");
  const stylesheetSource = html.match(
    /<link[^>]*rel="stylesheet"[^>]*href="([^"\s]+)"/,
  );
  assert.ok(stylesheetSource, "index.html declares its stylesheet");
  const stylesheet = await fetch(new URL(stylesheetSource[1], h.origin()));
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type"), /^text\/css/);
});

test("oversized JSON imports return an actionable error without losing stored data", async (t) => {
  const h = await harness(t);
  await h.setup();
  await h.request("/api/items", "POST", example);
  const tooLarge = await h.request("/api/import", "POST", {
    items: [],
    padding: "x".repeat(5 * 1024 * 1024),
  });
  assert.equal(tooLarge.status, 413);
  assert.match(tooLarge.body.error, /5 MB/);
  assert.equal((await h.request("/api/items")).body.items.length, 1);
});
