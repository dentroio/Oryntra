import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOryntraDataDir } from "@oryntra/core";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function serverPidPath(): string {
  return join(getOryntraDataDir(), "server.pid");
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readServerPid(): number | null {
  const path = serverPidPath();
  if (!existsSync(path)) return null;
  const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return isProcessAlive(pid) ? pid : null;
}

export function writeServerPid(pid: number): void {
  mkdirSync(getOryntraDataDir(), { recursive: true });
  writeFileSync(serverPidPath(), String(pid));
}

export function clearServerPid(): void {
  if (existsSync(serverPidPath())) unlinkSync(serverPidPath());
}

export function defaultServerScript(): string {
  return join(__dirname, "../../server/dist/start.js");
}

export async function checkHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(
  baseUrl: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await checkHealth(baseUrl)) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Oryntra server did not become ready at ${baseUrl}`);
}

export function stopServerDaemon(): boolean {
  const pid = readServerPid();
  if (!pid) return false;
  try {
    process.kill(pid);
  } catch {
    // already gone
  }
  clearServerPid();
  return true;
}

export async function restartServerDaemon(options: {
  host: string;
  port: number;
  serverScript?: string;
}): Promise<number> {
  stopServerDaemon();
  await new Promise((r) => setTimeout(r, 400));
  const pid = await spawnServerDaemon(options);
  await waitForHealth(`http://${options.host}:${options.port}`);
  return pid;
}

export async function spawnServerDaemon(options: {
  host: string;
  port: number;
  serverScript?: string;
}): Promise<number> {
  const script = options.serverScript ?? defaultServerScript();
  if (!existsSync(script)) {
    throw new Error(`Oryntra server not built (${script}). Run: npm run build`);
  }

  const child = spawn(process.execPath, [script], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ORYNTRA_HOST: options.host,
      ORYNTRA_PORT: String(options.port),
    },
  });
  child.unref();
  if (!child.pid) {
    throw new Error("Failed to start Oryntra server process");
  }
  writeServerPid(child.pid);
  return child.pid;
}
