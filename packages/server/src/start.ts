import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getOryntraDataDir } from "@oryntra/core";
import { createApp } from "./app.js";

const port = Number(process.env.ORYNTRA_PORT ?? 4317);
const host = process.env.ORYNTRA_HOST ?? "127.0.0.1";

const dataDir = getOryntraDataDir();
mkdirSync(dataDir, { recursive: true });
writeFileSync(join(dataDir, "server.pid"), String(process.pid));

const { app } = await createApp({ host, port });
await app.listen({ host, port });
console.log(`Oryntra backend listening on http://${host}:${port}`);
