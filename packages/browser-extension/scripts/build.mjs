import { mkdir, cp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const dist = join(root, "dist");

const MIN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

await mkdir(join(dist, "icons"), { recursive: true });

for (const size of [16, 48, 128]) {
  await writeFile(join(dist, "icons", `icon${size}.png`), MIN_PNG);
}

for (const file of [
  "manifest.json",
  "background.js",
  "content.js",
  "sidepanel.html",
  "sidepanel.js",
  "options.html",
  "options.js",
]) {
  await cp(join(root, "src", file), join(dist, file));
}

console.log("Built @oryntra/browser-extension → dist/");
