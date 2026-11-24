export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const colors = new Set(["blue", "violet", "teal", "amber", "rose"]);
const workspaces = new Set(["Personal", "Minecraft", "Work", "People"]);
export const isoDate = (value, fallback) =>
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
