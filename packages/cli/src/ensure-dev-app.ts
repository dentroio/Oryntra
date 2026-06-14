import { spawn } from "node:child_process";

async function isAppRunning(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureAppDevServer(options: {
  workspacePath: string;
  appUrl: string;
  devCommand?: string;
  timeoutMs?: number;
}): Promise<{ started: boolean; alreadyRunning: boolean }> {
  if (await isAppRunning(options.appUrl)) {
    return { started: false, alreadyRunning: true };
  }

  const devCommand = options.devCommand?.trim() || "npm run dev";
  const child = spawn(devCommand, {
    cwd: options.workspacePath,
    shell: true,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (await isAppRunning(options.appUrl)) {
      return { started: true, alreadyRunning: false };
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  return { started: false, alreadyRunning: false };
}
