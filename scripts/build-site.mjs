import { build } from "esbuild";
import { mkdir, rm, cp } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, ".openai"), { recursive: true });
for (const name of ["index.html", "style.css", "favicon.svg"])
  await cp(resolve(root, "public", name), resolve(dist, name));
await cp(
  resolve(root, ".openai/hosting.json"),
  resolve(dist, ".openai/hosting.json"),
);
await build({
  entryPoints: [resolve(root, "public/app.mjs")],
  outfile: resolve(dist, "app.mjs"),
  define: { __FIREBASE_DESKTOP__: "true" },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  logLevel: "info",
});
console.log("Built a static Firebase desktop for Sites or Firebase Hosting.");
