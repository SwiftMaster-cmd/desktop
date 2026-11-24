import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const colors = new Set(["blue", "violet", "teal", "amber", "rose"]);
const workspaces = new Set(["Personal", "Minecraft", "Work", "People"]);
const isoDate = (value, fallback) =>
  typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
const guessWorkspace = (title) =>
  /minecraft/i.test(title)
    ? "Minecraft"
    : /walmart|stocking/i.test(title)
      ? "Work"
      : /people|harvest|relationship/i.test(title)
        ? "People"
        : "Personal";

export function normalizeItem(input, { importing = false } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new AppError(400, "Each item must be an object.");
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!title || title.length > 160)
    throw new AppError(400, "Titles must contain 1–160 characters.");
  if (!["note", "link"].includes(input.kind))
    throw new AppError(400, "Choose a note or a shortcut.");
  if (typeof input.content !== "string" || input.content.length > 200_000)
    throw new AppError(
      400,
      "Item content must be text, up to 200,000 characters.",
    );
  if (input.kind === "link") {
    try {
      const url = new URL(input.content);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      throw new AppError(
        400,
        "Shortcuts need a complete http:// or https:// address.",
      );
    }
  }
  const color = input.color ?? "blue";
  const workspace =
    input.workspace ?? (importing ? guessWorkspace(title) : "Personal");
  if (!colors.has(color))
    throw new AppError(400, "Choose a supported item color.");
  if (!workspaces.has(workspace))
    throw new AppError(400, "Choose a supported workspace.");
  for (const field of ["pinned", "archived"]) {
    if (input[field] !== undefined && typeof input[field] !== "boolean")
      throw new AppError(400, `${field} must be true or false.`);
  }
  return {
    title,
    kind: input.kind,
    content: input.content,
    color,
    workspace,
    pinned: input.pinned ?? false,
    archived: input.archived ?? false,
  };
}

const fromRow = (row) =>
  row
    ? {
        id: row.id,
        title: row.title,
        kind: row.kind,
        content: row.content,
        color: row.color,
        workspace: row.workspace,
        pinned: Boolean(row.pinned),
        archived: Boolean(row.archived),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        version: row.version,
      }
    : null;

export class DesktopStore {
  constructor(dataDir) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(dataDir, "desktop.sqlite"));
    chmodSync(join(dataDir, "desktop.sqlite"), 0o600);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL,
        color TEXT NOT NULL, workspace TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS revisions (
        item_id TEXT NOT NULL REFERENCES items(id), version INTEGER NOT NULL,
        snapshot TEXT NOT NULL, PRIMARY KEY (item_id, version)
      );
    `);
  }
  close() {
    this.db.close();
  }
  getSetting(key) {
    return this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key)
      ?.value;
  }
  setSetting(key, value) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)")
      .run(key, value);
  }
  addSession(hash, expiresAt) {
    this.db
      .prepare("DELETE FROM sessions WHERE expires_at < ?")
      .run(Date.now());
    this.db
      .prepare("INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)")
      .run(hash, expiresAt);
  }
  hasSession(hash) {
    return Boolean(
      this.db
        .prepare(
          "SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?",
        )
        .get(hash, Date.now()),
    );
  }
  removeSession(hash) {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
  }
  list() {
    return this.db
      .prepare("SELECT * FROM items ORDER BY updated_at DESC, id")
      .all()
      .map(fromRow);
  }
  get(id) {
    return fromRow(this.db.prepare("SELECT * FROM items WHERE id = ?").get(id));
  }
  insert(item) {
    this.db
      .prepare(
        `INSERT INTO items (id,title,kind,content,color,workspace,pinned,archived,created_at,updated_at,version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        item.id,
        item.title,
        item.kind,
        item.content,
        item.color,
        item.workspace,
        Number(item.pinned),
        Number(item.archived),
        item.createdAt,
        item.updatedAt,
        item.version,
      );
    this.record(item);
  }
  record(item) {
    this.db
      .prepare(
        "INSERT INTO revisions (item_id, version, snapshot) VALUES (?, ?, ?)",
      )
      .run(item.id, item.version, JSON.stringify(item));
  }
  create(input) {
    const now = new Date().toISOString();
    const item = {
      ...normalizeItem(input),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.insert(item);
      this.db.exec("COMMIT");
      return item;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  update(id, input) {
    if (!Number.isSafeInteger(input?.version))
      throw new AppError(400, "The current item version is required.");
    const fields = normalizeItem(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(id);
      if (!previous) throw new AppError(404, "This item was not found.");
      if (input.version !== previous.version)
        throw new AppError(
          409,
          "This item changed in another window. Reload it before saving.",
        );
      const item = {
        ...previous,
        ...fields,
        updatedAt: new Date().toISOString(),
        version: previous.version + 1,
      };
      this.db
        .prepare(
          `UPDATE items SET title=?,kind=?,content=?,color=?,workspace=?,pinned=?,archived=?,updated_at=?,version=? WHERE id=?`,
        )
        .run(
          item.title,
          item.kind,
          item.content,
          item.color,
          item.workspace,
          Number(item.pinned),
          Number(item.archived),
          item.updatedAt,
          item.version,
          id,
        );
      this.record(item);
      this.db.exec("COMMIT");
      return item;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  archive(id, version) {
    const previous = this.get(id);
    if (!previous) throw new AppError(404, "This item was not found.");
    return this.update(id, { ...previous, archived: true, version });
  }
  history(id) {
    if (!this.get(id)) throw new AppError(404, "This item was not found.");
    return this.db
      .prepare(
        "SELECT snapshot FROM revisions WHERE item_id = ? ORDER BY version DESC",
      )
      .all(id)
      .map((row) => JSON.parse(row.snapshot));
  }
  import(input) {
    if (!Array.isArray(input) || input.length > 1000)
      throw new AppError(400, "Import a backup containing up to 1,000 items.");
    const now = new Date().toISOString();
    const items = input.map((value) => {
      const fields = normalizeItem(value, { importing: true });
      const id = value.id ?? randomUUID();
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
    let imported = 0,
      skipped = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const item of items) {
        if (this.get(item.id)) {
          skipped++;
          continue;
        }
        this.insert(item);
        imported++;
      }
      this.db.exec("COMMIT");
      return { imported, skipped };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
