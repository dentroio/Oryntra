#!/usr/bin/env node
/**
 * Portable MCP entry — no absolute paths in mcp.json.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.ORYNTRA_URL ??= "http://127.0.0.1:4317";
process.env.ORYNTRA_WORKSPACE ??= join(root, "apps/demo-app");
process.env.ORYNTRA_IDE ??= "cursor";

await import(join(root, "packages/mcp/dist/index.js"));
