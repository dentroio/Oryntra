import { mkdir, cp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

await mkdir(join(dist, "icons"), { recursive: true });
await cp(join(root, "src", "icons"), join(dist, "icons"), { recursive: true });

for (const file of [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
  "oryntra.jpg",
]) {
  await cp(join(root, "src", file), join(dist, file));
}

console.log("Built @oryntra/browser-extension → dist/");
