import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
const manifest = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
assert.equal(manifest.static.directory, "dist");
const html = await readFile("dist/index.html", "utf8");
assert.ok(html.includes('src="/app.mjs"'));
assert.ok(html.includes('id="email"'));
for (const file of [
  "app.mjs",
  "style.css",
  "favicon.svg",
  ".openai/hosting.json",
])
  assert.ok((await stat(`dist/${file}`)).isFile());
const app = await readFile("dist/app.mjs", "utf8");
assert.ok(
  app.includes("desktop-6562f"),
  "bundle contains the selected Firebase project",
);
assert.ok(
  !app.includes("node:sqlite"),
  "bundle has no Node-only database dependency",
);
console.log("Static site and Firebase bundle validated.");
