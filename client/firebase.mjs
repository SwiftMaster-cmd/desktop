import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  get,
  runTransaction,
  onValue,
} from "firebase/database";
import { firebaseConfig } from "../firebase.config.mjs";
import { AppError, normalizeItem, isoDate } from "../src/item.mjs";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
let database;
let privacyCheck;
const authReady = new Promise((resolve) => {
  let unsubscribe = () => {};
  unsubscribe = onAuthStateChanged(
    auth,
    () => {
      unsubscribe();
      resolve();
    },
    () => {
      unsubscribe();
      resolve();
    },
  );
});

// Analytics is optional: blocked scripts or unsupported browsers never block notes.
if (firebaseConfig.measurementId && typeof window !== "undefined") {
  import("firebase/analytics")
    .then(async ({ isSupported, getAnalytics }) => {
      if (await isSupported()) getAnalytics(app);
    })
    .catch(() => {});
}

function bodyOf(options) {
  if (options.body === undefined) return {};
  try {
    const body =
      typeof options.body === "string"
        ? JSON.parse(options.body)
        : options.body;
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error();
    return body;
  } catch {
    throw new AppError(400, "Send a valid JSON object.");
  }
}
function credentials(body, creating = false) {
  if (
    typeof body.email !== "string" ||
    !body.email.trim() ||
    body.email.trim().length > 254
  )
    throw new AppError(400, "Enter your email address.");
  if (
    typeof body.password !== "string" ||
    (creating && body.password.length < 10) ||
    body.password.length > 256
  )
    throw new AppError(400, "Use a password with 10–256 characters.");
  return { email: body.email.trim(), password: body.password };
}
function databaseInstance() {
  if (!firebaseConfig.databaseURL)
    throw new AppError(
      503,
      "Add the exact Realtime Database URL to firebase.config.mjs before opening notes.",
    );
  database ??= getDatabase(app, firebaseConfig.databaseURL);
  return database;
}
async function ensurePrivateDatabase() {
  if (!privacyCheck) {
    privacyCheck = (async () => {
      databaseInstance();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      let response;
      try {
        const url = `${firebaseConfig.databaseURL.replace(/\/$/, "")}/user-desktops/__desktop_privacy_probe__.json`;
        response = await fetch(url, {
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal,
        });
      } catch {
        throw new AppError(
          503,
          "Could not verify database privacy. Check your connection and try again.",
        );
      } finally {
        clearTimeout(timer);
      }
      if (response.status === 200)
        throw new AppError(
          403,
          "Database privacy rules need to be published before notes can be saved. Connect Firebase or publish database.rules.json.",
        );
      if (![401, 403].includes(response.status))
        throw new AppError(
          503,
          "Could not verify database privacy. Check Firebase’s database rules and try again.",
        );
    })().catch((error) => {
      privacyCheck = undefined;
      throw error;
    });
  }
  return privacyCheck;
}
function desktopRef(uid) {
  return ref(databaseInstance(), `user-desktops/${uid}`);
}
async function transact(uid, mutate) {
  await ensurePrivateDatabase();
  const location = desktopRef(uid);
  // Prime the transaction cache before testing existence/version in its callback.
  await get(location);
  const result = await runTransaction(
    location,
    (current) => mutate(current ?? {}),
    { applyLocally: false },
  );
  if (!result.committed)
    throw new AppError(
      409,
      "This desktop changed elsewhere. Reload and try again.",
    );
  return result.snapshot.val() ?? {};
}
async function createItem(uid, body) {
  const now = new Date().toISOString();
  const item = {
    ...normalizeItem(body),
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  await transact(uid, (current) => {
    if (Object.hasOwn(current.items ?? {}, item.id))
      throw new AppError(409, "This item already exists. Try saving again.");
    return {
      ...current,
      items: { ...current.items, [item.id]: item },
      revisions: { ...current.revisions, [item.id]: { 1: item } },
    };
  });
  return item;
}
async function updateItem(uid, id, body, archive = false) {
  if (!Number.isSafeInteger(body.version))
    throw new AppError(400, "The current item version is required.");
  const fields = archive ? null : normalizeItem(body);
  const updatedAt = new Date().toISOString();
  const result = await transact(uid, (current) => {
    const previous = Object.hasOwn(current.items ?? {}, id) ? current.items[id] : null;
    if (!previous) throw new AppError(404, "This item was not found.");
    if (previous.version !== body.version)
      throw new AppError(
        409,
        "This item changed in another window. Reload it before saving.",
      );
    const item = {
      ...previous,
      ...(archive ? { archived: true } : fields),
      id,
      updatedAt,
      version: previous.version + 1,
    };
    return {
      ...current,
      items: { ...current.items, [id]: item },
      revisions: {
        ...current.revisions,
        [id]: { ...current.revisions?.[id], [item.version]: item },
      },
    };
  });
  return result.items[id];
}
async function listItems(uid) {
  await ensurePrivateDatabase();
  const snapshot = await get(
    ref(databaseInstance(), `user-desktops/${uid}/items`),
  );
  return Object.values(snapshot.val() ?? {})
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
}
async function importItems(uid, input) {
  if (!Array.isArray(input) || input.length > 250)
    throw new AppError(
      400,
      "Import up to 250 items at a time so the entire restore stays atomic.",
    );
  if (
    new TextEncoder().encode(JSON.stringify(input)).byteLength >
    5 * 1024 * 1024
  )
    throw new AppError(413, "This backup is too large. The limit is 5 MB.");
  const now = new Date().toISOString();
  const items = input.map((value) => {
    const fields = normalizeItem(value, { importing: true });
    const id = value.id ?? crypto.randomUUID();
    if (typeof id !== "string" || !/^[a-z0-9_-]{1,128}$/i.test(id))
      throw new AppError(400, "An imported item has an invalid ID.");
    return {
      ...fields,
      id,
      createdAt: isoDate(value.createdAt, now),
      updatedAt: isoDate(value.updatedAt, now),
      version: 1,
    };
  });
  const unique = [
    ...new Map(
      items
        .slice()
        .reverse()
        .map((item) => [item.id, item]),
    ).values(),
  ];
  if (!unique.length) return { imported: 0, skipped: 0 };
  let imported = 0;
  await transact(uid, (current) => {
    const next = {
      ...current,
      items: { ...current.items },
      revisions: { ...current.revisions },
    };
    imported = 0;
    for (const item of unique) {
      if (Object.hasOwn(next.items, item.id)) continue;
      next.items = { ...next.items, [item.id]: item };
      next.revisions = { ...next.revisions, [item.id]: { 1: item } };
      imported++;
    }
    return next;
  });
  return { imported, skipped: items.length - imported };
}
function friendlyError(error) {
  if (error instanceof AppError) return error;
  const code = (error.code ?? "")
    .replace(/^auth\//, "")
    .replace(/^database\//, "")
    .toLowerCase()
    .replaceAll("_", "-");
  const messages = {
    "invalid-credential": [401, "The email or password is incorrect."],
    "wrong-password": [401, "The email or password is incorrect."],
    "user-not-found": [401, "The email or password is incorrect."],
    "popup-blocked": [400, "Allow popups for this site, then try Google sign-in again."],
    "popup-closed-by-user": [400, "Google sign-in was cancelled. Try again when ready."],
    "cancelled-popup-request": [400, "A sign-in window is already open. Finish signing in there."],
    "account-exists-with-different-credential": [409, "Sign in using your existing account’s sign-in method for this email."],
    "invalid-email": [400, "Enter a valid email address."],
    "email-already-in-use": [
      409,
      "This email already has an account. Sign in instead.",
    ],
    "weak-password": [
      400,
      "Choose a stronger password with at least 10 characters.",
    ],
    "operation-not-allowed": [
      503,
      "Enable the selected sign-in provider in Firebase Authentication.",
    ],
    "configuration-not-found": [
      503,
      "Firebase Authentication needs to be configured for this project.",
    ],
    "unauthorized-domain": [
      503,
      "Add this site’s domain to Firebase Authentication’s authorized domains.",
    ],
    "permission-denied": [
      403,
      "Firebase blocked this request. Publish database.rules.json in your Realtime Database and check that your account is signed in.",
    ],
    unauthenticated: [401, "Sign in again to open your desktop."],
    "network-request-failed": [
      503,
      "Could not reach Firebase. Check your connection and try again.",
    ],
    "network-error": [
      503,
      "Could not reach Realtime Database. Check your connection and try again.",
    ],
    unavailable: [
      503,
      "Could not reach Realtime Database. Check your connection and try again.",
    ],
    "resource-exhausted": [
      429,
      "Firebase’s current limit was reached. Wait and try again, or restore a smaller backup.",
    ],
    "too-many-requests": [
      429,
      "Too many attempts. Wait a moment and try again.",
    ],
  };
  const [status, message] = messages[code] ?? [
    500,
    error.message || "The desktop could not complete that request.",
  ];
  return new AppError(status, message);
}

// Call directly from the click handler so the popup retains browser user activation.
export async function signInWithGoogle() {
  try {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
    privacyCheck = undefined;
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function firebaseApi(path, options = {}) {
  try {
    await authReady;
    const method = options.method ?? "GET";
    const body = bodyOf(options);
    if (path === "/api/auth" && method === "GET")
      return {
        configured: true,
        authenticated: Boolean(auth.currentUser),
        firebase: true,
      };
    if (["/api/setup", "/api/login"].includes(path) && method === "POST") {
      const { email, password } = credentials(body, path === "/api/setup");
      if (path === "/api/setup")
        await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
      privacyCheck = undefined;
      return { authenticated: true };
    }
    if (path === "/api/reset" && method === "POST") {
      if (typeof body.email !== "string" || !body.email.trim())
        throw new AppError(400, "Enter your email address first.");
      await sendPasswordResetEmail(auth, body.email.trim());
      return { sent: true };
    }
    if (path === "/api/logout" && method === "POST") {
      await signOut(auth);
      privacyCheck = undefined;
      return { authenticated: false };
    }
    const user = auth.currentUser;
    if (!user) throw new AppError(401, "Sign in to open your desktop.");
    if (path === "/api/items" && method === "GET")
      return { items: await listItems(user.uid) };
    if (path === "/api/items" && method === "POST")
      return { item: await createItem(user.uid, body) };
    const route = path.match(
      /^\/api\/items\/([a-z0-9_-]{1,128})(\/history)?$/i,
    );
    if (route) {
      if (route[2] && method === "GET") {
        await ensurePrivateDatabase();
        const snapshot = await get(
          ref(
            databaseInstance(),
            `user-desktops/${user.uid}/revisions/${route[1]}`,
          ),
        );
        return {
          revisions: Object.values(snapshot.val() ?? {})
            .filter(Boolean)
            .sort((a, b) => b.version - a.version),
        };
      }
      if (!route[2] && ["PUT", "DELETE"].includes(method))
        return {
          item: await updateItem(user.uid, route[1], body, method === "DELETE"),
        };
    }
    if (path === "/api/export" && method === "GET")
      return {
        format: "bossmans-desktop",
        version: 1,
        exportedAt: new Date().toISOString(),
        items: await listItems(user.uid),
      };
    if (path === "/api/import" && method === "POST")
      return await importItems(user.uid, body.items);
    throw new AppError(404, "This endpoint was not found.");
  } catch (error) {
    throw friendlyError(error);
  }
}

export async function subscribeToItems(onItems, onError = () => {}) {
  await authReady;
  const user = auth.currentUser;
  if (!user) throw new AppError(401, "Sign in to open your desktop.");
  await ensurePrivateDatabase();
  return onValue(
    ref(databaseInstance(), `user-desktops/${user.uid}/items`),
    (snapshot) => {
      const items = Object.values(snapshot.val() ?? {})
        .filter(Boolean)
        .sort(
          (a, b) =>
            b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
        );
      onItems(items);
    },
    (error) => onError(friendlyError(error)),
  );
}
