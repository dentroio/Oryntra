#!/usr/bin/env node
/**
 * Silent background start for Oryntra server (used on workspace open).
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "packages/server/dist/start.js");

if (!existsSync(server)) {
  process.exit(0);
}

const { ensureServerRunning } = await import(
  join(root, "packages/cli/dist/daemon.js")
);

try {
  await ensureServerRunning({ host: "127.0.0.1", port: 4317 });
} catch {
  process.exit(0);
}
