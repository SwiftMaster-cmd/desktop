const firebaseMode =
  typeof __FIREBASE_DESKTOP__ !== "undefined" && __FIREBASE_DESKTOP__;
const firebaseClient = firebaseMode
  ? await import("../client/firebase.mjs")
  : null;
const firebaseApi = firebaseClient?.firebaseApi;
let stopRealtime = null;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/>',
  link: '<path d="m10 13 4-4m-6 6-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0m2 2 1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/>',
  pin: '<path d="m15 3 6 6-3 1-3 5-3-1-5 5m0-12 5-3 1-3M7 7l10 10"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  personal:
    '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  minecraft:
    '<path d="m12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10M7 4.8l10 5.4"/>',
  work: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12l9 4 9-4M12 13v4"/>',
  people:
    '<circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6m3 11v-3a7 7 0 0 0-3-5"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
  download: '<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-4 4 4-4 4 4M4 16v5h16v-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 4v3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-4v6l4 2"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  restore: '<path d="M3 5v6h6m-6 0a9 9 0 1 1 2 7"/>',
};
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.note}</svg>`;
}
function hydrateIcons(root = document) {
  $$("[data-icon]", root).forEach((el) => {
    el.innerHTML = icon(el.dataset.icon);
  });
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
const workspaces = [
  {
    name: "Personal",
    icon: "personal",
    detail: "Ideas & everyday things",
    color: "#b6cfa3",
    bg: "#eef4e5",
    fg: "#77945e",
  },
  {
    name: "Minecraft",
    icon: "minecraft",
    detail: "Builds, plans & possibilities",
    color: "#a1c5c0",
    bg: "#eaf3ef",
    fg: "#678f81",
  },
  {
    name: "Work",
    icon: "work",
    detail: "Keep your work in order",
    color: "#dfbd8c",
    bg: "#faf2e3",
    fg: "#b28e55",
  },
  {
    name: "People",
    icon: "people",
    detail: "Notes on connection",
    color: "#c1b4d4",
    bg: "#f0ecf7",
    fg: "#9581b3",
  },
];
const colors = {
  blue: { color: "#adc3dc", bg: "#ecf2f8", fg: "#7898bb" },
  violet: { color: "#c2b4d7", bg: "#f1edf8", fg: "#9a84b7" },
  teal: { color: "#a2c6b6", bg: "#eaf3ed", fg: "#6d9d83" },
  amber: { color: "#ddc393", bg: "#faf3e5", fg: "#b49a67" },
  rose: { color: "#d9b3b6", bg: "#f9eef0", fg: "#b5878d" },
};
const state = {
  items: [],
  view: "all",
  kind: "all",
  search: "",
  sort: "updated",
  configured: false,
  editing: null,
  editorKind: "note",
  baseline: "",
  pendingImport: null,
};
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5000);
}
async function api(path, options = {}) {
  if (firebaseApi) {
    try {
      return await firebaseApi(path, options);
    } catch (error) {
      if (
        error.status === 401 &&
        !["/api/login", "/api/setup", "/api/reset"].includes(path)
      )
        showAuth(true);
      throw error;
    }
  }
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    cache: "no-store",
  });
  const result = await response
    .json()
    .catch(() => ({ error: "The server returned an unreadable response." }));
  if (!response.ok) {
    if (response.status === 401 && !["/api/login", "/api/setup"].includes(path))
      showAuth(true);
    const error = new Error(
      result.error || "Something went wrong. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
function run(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (error) {
      toast(error.message);
    }
  };
}
async function busy(button, fn) {
  button.disabled = true;
  try {
    return await fn();
  } finally {
    button.disabled = false;
  }
}
function showAuth(configured) {
  state.configured = configured;
  $$("dialog[open]").forEach((dialog) => dialog.close());
  $("#desktop").hidden = true;
  $("#loading").hidden = true;
  $("#auth-screen").hidden = false;
  $("#auth-title").textContent = configured
    ? "Open your desktop"
    : "Make yourself at home";
  $("#auth-kicker").textContent = configured ? "WELCOME HOME" : "A FRESH START";
  $("#auth-description").textContent = configured
    ? "Enter your password to pick up where you left off."
    : "Create a password to protect your new desktop. Use at least 10 characters.";
  $("#auth-submit").textContent = configured
    ? "Open desktop"
    : "Create my desktop";
  $("#password").autocomplete = configured
    ? "current-password"
    : "new-password";
  $("#password").minLength = configured ? 1 : 10;
  $("#confirm-password-wrap").hidden = configured;
  $("#confirm-password").required = !configured;
  $("#auth-error").textContent = "";
  $("#email-wrap").hidden = !firebaseMode;
  $("#email").required = firebaseMode;
  $("#firebase-auth-actions").hidden = !firebaseMode;
  if (firebaseMode) {
    $("#auth-title").textContent = configured
      ? "Open your desktop"
      : "Create your account";
    $("#auth-description").textContent = configured
      ? "Sign in to access your notes and shortcuts on any device."
      : "Use your email and a password with at least 10 characters.";
    $("#auth-submit").textContent = configured ? "Sign in" : "Create account";
    $("#auth-toggle").textContent = configured
      ? "Create an account"
      : "Already have an account? Sign in";
    $("#reset-password").hidden = !configured;
    $("#auth-note").textContent =
      "Your notes are saved to your Firebase account. Export a backup whenever you need one.";
  }
}
async function openDesktop() {
  await reload();
  if (firebaseClient?.subscribeToItems) {
    stopRealtime?.();
    stopRealtime = await firebaseClient.subscribeToItems(
      (items) => {
        state.items = items;
        render();
      },
      (error) => toast(error.message),
    );
  }
  $("#auth-screen").hidden = true;
  $("#loading").hidden = true;
  $("#desktop").hidden = false;
  $("#password").value = "";
  $("#confirm-password").value = "";
}
async function reload() {
  const result = await api("/api/items");
  state.items = result.items;
  render();
}
function changeView(view) {
  state.view = view;
  state.search = "";
  $("#search").value = "";
  state.kind = "all";
  setMenu(false);
  render();
}
function renderNav() {
  const active = state.items.filter((x) => !x.archived);
  $("#all-count").textContent = active.length;
  $("#pinned-count").textContent = active.filter((x) => x.pinned).length;
  $("#trash-count").textContent = state.items.filter((x) => x.archived).length;
  $$("[data-view]").forEach((el) => {
    const selected = el.dataset.view === state.view;
    el.classList.toggle("active", selected);
    if (selected) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  });
  const nav = $("#workspace-nav");
  nav.replaceChildren();
  workspaces.forEach((space) => {
    const button = node("button", "nav-item");
    button.dataset.view = space.name;
    button.classList.toggle("active", state.view === space.name);
    if (state.view === space.name) button.setAttribute("aria-current", "page");
    const dot = node("span", "workspace-dot");
    dot.style.setProperty("--workspace-color", space.color);
    button.append(
      dot,
      node("span", "", space.name),
      node(
        "span",
        "nav-count",
        active.filter((x) => x.workspace === space.name).length,
      ),
    );
    nav.append(button);
  });
}
function renderWorkspaces() {
  const area = $("#workspace-cards");
  area.hidden = state.view !== "all";
  area.replaceChildren();
  workspaces.forEach((space) => {
    const button = node("button", "workspace-card");
    button.dataset.view = space.name;
    button.style.setProperty("--workspace-bg", space.bg);
    button.style.setProperty("--workspace-fg", space.fg);
    const top = node("div", "workspace-card-top");
    const mark = node("span", "workspace-card-icon");
    mark.innerHTML = icon(space.icon);
    const count = state.items.filter(
      (x) => !x.archived && x.workspace === space.name,
    ).length;
    top.append(
      mark,
      node("span", "", `${count} ${count === 1 ? "item" : "items"}`),
    );
    button.append(top, node("h3", "", space.name), node("p", "", space.detail));
    area.append(button);
  });
}
function filteredItems() {
  let items = state.items.filter((item) =>
    state.view === "trash" ? item.archived : !item.archived,
  );
  if (state.view === "pinned") items = items.filter((item) => item.pinned);
  if (workspaces.some((space) => space.name === state.view))
    items = items.filter((item) => item.workspace === state.view);
  if (state.kind !== "all")
    items = items.filter((item) => item.kind === state.kind);
  const search = state.search.trim().toLowerCase();
  if (search)
    items = items.filter((item) =>
      `${item.title}\n${item.content}\n${item.workspace}`
        .toLowerCase()
        .includes(search),
    );
  return items.sort((a, b) => {
    if (state.view !== "trash" && a.pinned !== b.pinned)
      return a.pinned ? -1 : 1;
    if (state.sort === "title") return a.title.localeCompare(b.title);
    return String(
      b[state.sort === "created" ? "createdAt" : "updatedAt"],
    ).localeCompare(
      String(a[state.sort === "created" ? "createdAt" : "updatedAt"]),
    );
  });
}
function dateLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(+date)) return "Saved";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  return `Updated ${date.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) })}`;
}
function safeUrl(content) {
  try {
    const url = new URL(content);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function itemCard(item) {
  const card = node("article", "item-card");
  const palette = colors[item.color] || colors.blue;
  for (const [key, value] of Object.entries(palette))
    card.style.setProperty(`--item-${key}`, value);
  const main = node("button", "item-card-main");
  main.setAttribute("aria-label", `Edit ${item.title}`);
  main.addEventListener("click", () => openEditor(item));
  const header = node("div", "item-card-header");
  const mark = node("span", "item-kind-icon");
  mark.innerHTML = icon(item.kind === "link" ? "link" : "note");
  header.append(mark, node("span", "item-workspace", item.workspace));
  let excerpt = item.content.trim() || "An open page. Make it yours.";
  if (item.kind === "link") {
    try {
      excerpt = new URL(item.content).hostname.replace(/^www\./, "");
    } catch {}
  }
  main.append(
    header,
    node("h3", "", item.title),
    node("p", "item-excerpt", excerpt),
  );
  const foot = node("div", "item-card-footer");
  const date = node("span", "", dateLabel(item.updatedAt));
  date.title = new Date(item.updatedAt).toLocaleString();
  const actions = node("div", "card-actions");
  if (item.archived) {
    const restore = node("button", "icon-button");
    restore.innerHTML = icon("restore");
    restore.title = "Restore item";
    restore.setAttribute("aria-label", `Restore ${item.title}`);
    restore.addEventListener(
      "click",
      run(() => updateItem(item, { archived: false }, "Item restored.")),
    );
    actions.append(restore);
  } else {
    if (item.kind === "link" && safeUrl(item.content)) {
      const link = node("a", "link-open", "Open");
      link.href = safeUrl(item.content);
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.insertAdjacentHTML("beforeend", icon("external"));
      link.setAttribute("aria-label", `Open ${item.title} in a new tab`);
      actions.append(link);
    }
    const pin = node("button", "icon-button pin-button");
    pin.innerHTML = icon("pin");
    pin.setAttribute(
      "aria-label",
      `${item.pinned ? "Unpin" : "Pin"} ${item.title}`,
    );
    pin.setAttribute("aria-pressed", String(item.pinned));
    pin.title = item.pinned ? "Unpin item" : "Pin item";
    pin.addEventListener(
      "click",
      run(() =>
        updateItem(
          item,
          { pinned: !item.pinned },
          item.pinned ? "Item unpinned." : "Pinned to the top.",
        ),
      ),
    );
    actions.append(pin);
  }
  foot.append(date, actions);
  card.append(main, foot);
  return card;
}
function render() {
  renderNav();
  renderWorkspaces();
  const titles = {
    all: "Your desktop.",
    pinned: "The important things.",
    trash: "A little breathing room.",
  };
  const descriptions = {
    all: "A home for your ideas, plans, and everyday essentials.",
    pinned: "Your pinned notes and shortcuts, all within reach.",
    trash: "Your items are kept here until you restore them.",
  };
  const labels = { all: "My desktop", pinned: "Pinned", trash: "Trash" };
  $("#page-title").textContent = titles[state.view] || `${state.view}.`;
  $("#page-description").textContent =
    descriptions[state.view] ||
    workspaces.find((x) => x.name === state.view)?.detail ||
    "";
  $("#breadcrumb-current").textContent = labels[state.view] || state.view;
  $("#page-kicker").textContent =
    state.view === "all"
      ? "A LITTLE MORE ORGANIZED"
      : state.view === "trash"
        ? "NOT GONE. JUST SET ASIDE."
        : "YOUR SPACE, YOUR WAY";
  $("#new-item").hidden = state.view === "trash";
  $$("[data-kind]").forEach((button) => {
    const active = button.dataset.kind === state.kind;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  const items = filteredItems();
  $("#filtered-count").textContent = items.length;
  $("#result-summary").textContent =
    `${items.length} ${items.length === 1 ? "item" : "items"}${state.search.trim() ? ` matching “${state.search.trim()}”` : state.view === "trash" ? " in trash" : " in this space"}`;
  const grid = $("#item-grid");
  grid.replaceChildren(...items.map(itemCard));
  const empty = !items.length;
  $("#empty-state").hidden = !empty;
  const filtered = !!state.search || state.kind !== "all";
  $("#empty-title").textContent = filtered
    ? "Nothing here matches."
    : state.view === "trash"
      ? "Nothing in the trash."
      : state.view === "pinned"
        ? "Keep your favorites close."
        : "Start with one good note.";
  $("#empty-description").textContent = filtered
    ? "Try a different search or switch to Everything."
    : state.view === "trash"
      ? "Items you move to trash will stay here, ready to restore."
      : state.view === "pinned"
        ? "Use the pin on any item to keep it at the top of your desktop."
        : "A plan for later, a thought worth keeping, or a link you use every day.";
  $(".empty-actions").hidden =
    filtered || ["trash", "pinned"].includes(state.view);
}
function draft() {
  return {
    title: $("#item-title").value.trim(),
    content: $("#item-content").value,
    workspace: $("#item-workspace").value,
    color: $("#item-color").value,
    pinned: $("#item-pinned").checked,
    kind: state.editorKind,
  };
}
function setEditorKind(kind) {
  state.editorKind = kind;
  $$("[data-editor-kind]").forEach((button) =>
    button.classList.toggle("selected", button.dataset.editorKind === kind),
  );
  $("#editor-heading").textContent =
    `${state.editing ? "Edit" : "New"} ${kind === "link" ? "shortcut" : "note"}`;
  $("#content-label").textContent =
    kind === "link" ? "Website address" : "Your note";
  $("#item-content").placeholder =
    kind === "link" ? "https://example.com" : "Start anywhere…";
  $("#item-content").rows = kind === "link" ? 3 : 12;
  $("#item-content").required = kind === "link";
  $("#content-help").textContent =
    kind === "link"
      ? "Use a full https:// or http:// address. Links open in a new tab."
      : "Plain text, with room to think. Changes save when you select Save.";
  $("#save-item").textContent = state.editing?.archived
    ? "Save changes"
    : `Save ${kind === "link" ? "shortcut" : "note"}`;
}
function openEditor(item = null, kind = "note") {
  state.editing = item;
  $("#item-title").value = item?.title || "";
  $("#item-content").value = item?.content || "";
  $("#item-workspace").value =
    item?.workspace ||
    (workspaces.some((space) => space.name === state.view)
      ? state.view
      : "Personal");
  $("#item-color").value = item?.color || "teal";
  $("#item-pinned").checked = item?.pinned || false;
  $("#editor-error").textContent = "";
  $("#revision-panel").hidden = true;
  $("#revision-list").replaceChildren();
  $("#archive-item").hidden = !item;
  $("#archive-item").textContent = item?.archived
    ? "Restore item"
    : "Move to trash";
  $("#show-history").hidden = !item;
  setEditorKind(item?.kind || kind);
  state.baseline = JSON.stringify(draft());
  $("#editor").showModal();
  $("#item-title").focus();
}
function confirmAction(
  title,
  description,
  yes = "Discard changes",
  no = "Keep editing",
) {
  const dialog = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-description").textContent = description;
  $("#confirm-yes").textContent = yes;
  $("#confirm-no").textContent = no;
  return new Promise((resolve) => {
    let answer = false;
    const accept = () => {
      answer = true;
      dialog.close();
    };
    const decline = () => dialog.close();
    const done = () => {
      $("#confirm-yes").removeEventListener("click", accept);
      $("#confirm-no").removeEventListener("click", decline);
      resolve(answer);
    };
    $("#confirm-yes").addEventListener("click", accept);
    $("#confirm-no").addEventListener("click", decline);
    dialog.addEventListener("close", done, { once: true });
    dialog.showModal();
    $("#confirm-no").focus();
  });
}
async function closeEditor() {
  if (
    JSON.stringify(draft()) !== state.baseline &&
    !(await confirmAction(
      "Discard changes?",
      "Your unsaved changes will be lost.",
    ))
  )
    return;
  $("#editor").close();
}
async function updateItem(item, patch, message) {
  try {
    await api(`/api/items/${encodeURIComponent(item.id)}`, {
      method: "PUT",
      body: JSON.stringify({ ...item, ...patch }),
    });
    await reload();
    if (message) toast(message);
  } catch (error) {
    if (error.status === 409) await reload();
    throw error;
  }
}
async function exportBackup() {
  const backup = await api("/api/export");
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
  );
  const anchor = node("a");
  anchor.href = url;
  anchor.download = `bossmans-desktop-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast("Backup downloaded. Keep it somewhere safe.");
}
function openImport() {
  state.pendingImport = null;
  $("#import-file").value = "";
  $("#import-preview").hidden = true;
  $("#import-preview").replaceChildren();
  $("#import-error").textContent = "";
  $("#confirm-import").disabled = true;
  $("#import-dialog").showModal();
}
async function boot() {
  hydrateIcons();
  $("#import-limit").textContent = firebaseMode ? "250" : "1,000";
  try {
    const auth = await api("/api/auth");
    state.configured = auth.configured;
    if (auth.authenticated) await openDesktop();
    else showAuth(auth.configured);
  } catch (error) {
    $("#loading").textContent =
      `Couldn’t open your desktop. ${error.message} Refresh to try again.`;
  }
}

$("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#auth-error").textContent = "";
  if (
    !state.configured &&
    $("#password").value !== $("#confirm-password").value
  ) {
    $("#auth-error").textContent = "The passwords don’t match.";
    return;
  }
  try {
    await busy($("#auth-submit"), async () => {
      await api(state.configured ? "/api/login" : "/api/setup", {
        method: "POST",
        body: JSON.stringify({
          email: $("#email").value.trim(),
          password: $("#password").value,
        }),
      });
      state.configured = true;
      await openDesktop();
    });
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
});
$("#google-sign-in").addEventListener("click", async () => {
  if (!firebaseMode) return;
  $("#auth-error").textContent = "";
  try {
    await busy($("#google-sign-in"), async () => {
      await firebaseClient.signInWithGoogle();
      state.configured = true;
      await openDesktop();
    });
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
});
$("#auth-toggle").addEventListener("click", () => showAuth(!state.configured));
$("#reset-password").addEventListener("click", async () => {
  $("#auth-error").textContent = "";
  const email = $("#email").value.trim();
  if (!email || !$("#email").checkValidity()) {
    $("#auth-error").textContent = "Enter your email address first.";
    $("#email").focus();
    return;
  }
  try {
    await busy($("#reset-password"), () =>
      api("/api/reset", { method: "POST", body: JSON.stringify({ email }) }),
    );
    toast(
      "If an account exists for that email, a password reset link is on its way.",
    );
  } catch (error) {
    $("#auth-error").textContent = error.message;
  }
});
$("#logout").addEventListener(
  "click",
  run(async () => {
    await api("/api/logout", { method: "POST", body: "{}" });
    stopRealtime?.();
    stopRealtime = null;
    state.items = [];
    showAuth(true);
    $("#password").focus();
  }),
);
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) changeView(button.dataset.view);
});
$$("[data-kind]").forEach((button) =>
  button.addEventListener("click", () => {
    state.kind = button.dataset.kind;
    render();
    button.focus();
  }),
);
$(".tabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = $$("[data-kind]");
  let index = tabs.indexOf(document.activeElement);
  index =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) %
          tabs.length;
  tabs[index].click();
});
$("#search").addEventListener("input", (event) => {
  state.search = event.target.value;
  render();
});
$("#sort").addEventListener("change", (event) => {
  state.sort = event.target.value;
  render();
});
$("#new-item").addEventListener("click", () => openEditor());
$("#empty-note").addEventListener("click", () => openEditor());
$("#empty-link").addEventListener("click", () => openEditor(null, "link"));
$("#editor-close").addEventListener("click", run(closeEditor));
$("#cancel-edit").addEventListener("click", run(closeEditor));
$("#editor").addEventListener("cancel", (event) => {
  event.preventDefault();
  run(closeEditor)();
});
$$("[data-editor-kind]").forEach((button) =>
  button.addEventListener("click", () =>
    setEditorKind(button.dataset.editorKind),
  ),
);
$("#editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#editor-error").textContent = "";
  const data = draft();
  if (!data.title) {
    $("#editor-error").textContent = "Add a title so you can find this again.";
    return;
  }
  if (data.kind === "link" && !safeUrl(data.content.trim())) {
    $("#editor-error").textContent =
      "Enter a valid http:// or https:// address.";
    return;
  }
  if (data.kind === "link") data.content = data.content.trim();
  try {
    await busy($("#save-item"), async () => {
      const existing = state.editing;
      await api(
        existing
          ? `/api/items/${encodeURIComponent(existing.id)}`
          : "/api/items",
        {
          method: existing ? "PUT" : "POST",
          body: JSON.stringify(
            existing
              ? {
                  ...data,
                  version: existing.version,
                  archived: existing.archived,
                }
              : data,
          ),
        },
      );
      $("#editor").close();
      await reload();
      toast(
        existing
          ? "Changes saved."
          : `${data.kind === "link" ? "Shortcut" : "Note"} saved. Make yourself at home.`,
      );
    });
  } catch (error) {
    $("#editor-error").textContent =
      error.status === 409
        ? "This item changed elsewhere. Your draft is still here. Copy any changes, then close and reopen the item to see the latest version."
        : error.message;
    if (error.status === 409) await reload().catch(() => {});
  }
});
$("#archive-item").addEventListener("click", async () => {
  const item = state.editing;
  if (!item) return;
  if (
    JSON.stringify(draft()) !== state.baseline &&
    !(await confirmAction(
      "Discard this draft?",
      `Your unsaved changes will be discarded before ${item.archived ? "restoring" : "moving"} this item.`,
      "Continue",
      "Keep editing",
    ))
  )
    return;
  try {
    await busy($("#archive-item"), () =>
      updateItem(
        item,
        { archived: !item.archived },
        item.archived
          ? "Item restored."
          : "Moved to trash. You can restore it anytime.",
      ),
    );
    $("#editor").close();
  } catch (error) {
    $("#editor-error").textContent = error.message;
  }
});
$("#show-history").addEventListener("click", async () => {
  if (!$("#revision-panel").hidden) {
    $("#revision-panel").hidden = true;
    return;
  }
  try {
    await busy($("#show-history"), async () => {
      const { revisions } = await api(
        `/api/items/${encodeURIComponent(state.editing.id)}/history`,
      );
      const list = $("#revision-list");
      list.replaceChildren();
      if (!revisions.length)
        list.append(node("p", "muted", "No earlier versions yet."));
      revisions
        .slice()
        .sort((a, b) => b.version - a.version)
        .forEach((revision) => {
          const row = node("div", "revision-row");
          row.append(
            node(
              "span",
              "",
              `Version ${revision.version} · ${new Date(revision.updatedAt).toLocaleString()}`,
            ),
          );
          const button = node("button", "", "Load this version");
          button.type = "button";
          button.addEventListener("click", () => {
            $("#item-title").value = revision.title;
            $("#item-content").value = revision.content;
            $("#item-workspace").value = revision.workspace;
            $("#item-color").value = revision.color;
            $("#item-pinned").checked = revision.pinned;
            setEditorKind(revision.kind);
            $("#revision-panel").hidden = true;
            toast("Previous version loaded. Review it, then save to restore.");
          });
          row.append(button);
          list.append(row);
        });
      $("#revision-panel").hidden = false;
    });
  } catch (error) {
    $("#editor-error").textContent = error.message;
  }
});
["#sidebar-export", "#footer-export"].forEach((selector) =>
  $(selector).addEventListener("click", run(exportBackup)),
);
$("#import-button").addEventListener("click", openImport);
["#import-close", "#import-cancel"].forEach((selector) =>
  $(selector).addEventListener("click", () => $("#import-dialog").close()),
);
$("#import-file").addEventListener("change", async (event) => {
  state.pendingImport = null;
  $("#confirm-import").disabled = true;
  $("#import-error").textContent = "";
  $("#import-preview").hidden = true;
  try {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024)
      throw new Error("Choose a backup smaller than 5 MB.");
    const data = JSON.parse(await file.text());
    const items = Array.isArray(data) ? data : data.items;
    const limit = firebaseMode ? 250 : 1000;
    if (!Array.isArray(items) || !items.length || items.length > limit)
      throw new Error(
        `Choose a JSON backup containing between 1 and ${limit.toLocaleString()} items.`,
      );
    if (
      items.some(
        (item) =>
          !item ||
          typeof item.title !== "string" ||
          typeof item.content !== "string" ||
          !["note", "link"].includes(item.kind),
      )
    )
      throw new Error(
        "Some items are missing a title, content, or valid item type.",
      );
    state.pendingImport = items;
    const preview = $("#import-preview");
    preview.replaceChildren();
    const existing = new Set(state.items.map((x) => x.id));
    const duplicateCount = items.filter((x) => existing.has(x.id)).length;
    preview.append(
      node(
        "p",
        "",
        `${items.length} items found${duplicateCount ? ` · ${duplicateCount} already on this desktop` : ""}.`,
      ),
    );
    const list = node("ul");
    items
      .slice(0, 8)
      .forEach((item) => list.append(node("li", "", item.title)));
    if (items.length > 8)
      list.append(node("li", "", `And ${items.length - 8} more…`));
    preview.append(list);
    preview.hidden = false;
    $("#confirm-import").disabled = false;
  } catch (error) {
    $("#import-error").textContent =
      error instanceof SyntaxError
        ? "This file isn’t valid JSON. Choose a Desktop backup."
        : error.message;
  }
});
$("#confirm-import").addEventListener("click", async () => {
  if (!state.pendingImport) return;
  try {
    await busy($("#confirm-import"), async () => {
      const { imported, skipped } = await api("/api/import", {
        method: "POST",
        body: JSON.stringify({ items: state.pendingImport }),
      });
      $("#import-dialog").close();
      await reload();
      toast(
        `${imported} ${imported === 1 ? "item" : "items"} imported${skipped ? `; ${skipped} existing items skipped` : ""}.`,
      );
    });
  } catch (error) {
    $("#import-error").textContent = error.message;
  }
});
const mobileLayout = window.matchMedia("(max-width: 650px)");
function setMenu(open) {
  $("#sidebar").classList.toggle("open", open);
  $("#menu-toggle").setAttribute("aria-expanded", String(open));
  $("#sidebar").inert = mobileLayout.matches && !open;
}
mobileLayout.addEventListener("change", () => setMenu(false));
setMenu(false);
$("#menu-toggle").addEventListener("click", () =>
  setMenu(!$("#sidebar").classList.contains("open")),
);
document.addEventListener("click", (event) => {
  if (
    $("#sidebar").classList.contains("open") &&
    !event.target.closest("#sidebar,#menu-toggle")
  )
    setMenu(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#sidebar").classList.contains("open")) {
    setMenu(false);
    $("#menu-toggle").focus();
    return;
  }
  const typing = event.target.closest(
    'input,textarea,select,[contenteditable="true"]',
  );
  if (
    typing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    $("dialog[open]") ||
    $("#desktop").hidden
  )
    return;
  if (event.key === "/") {
    event.preventDefault();
    $("#search").focus();
  }
  if (event.key.toLowerCase() === "n") {
    event.preventDefault();
    openEditor();
  }
});
window.addEventListener("beforeunload", (event) => {
  if ($("#editor").open && JSON.stringify(draft()) !== state.baseline) {
    event.preventDefault();
    event.returnValue = "";
  }
});
await boot();
