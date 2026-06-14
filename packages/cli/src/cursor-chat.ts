import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function findCursorBinary(): string | null {
  const candidates = [
    process.env.CURSOR_PATH,
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export async function probeCursorAgentAuth(): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const cursor = findCursorBinary();
  if (!cursor) {
    return { ok: false, reason: "Cursor CLI not found" };
  }
  try {
    await execFileAsync(
      cursor,
      ["agent", "--print", "--mode", "ask", "ping"],
      { timeout: 20_000, maxBuffer: 64 * 1024 },
    );
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Authentication required|CURSOR_API_KEY|cursor agent login/i.test(message)) {
      return {
        ok: false,
        reason: "Run `cursor agent login` (or set CURSOR_API_KEY)",
      };
    }
    return { ok: true };
  }
}

export async function createCursorChat(): Promise<string | null> {
  const cursor = findCursorBinary();
  if (!cursor) return null;
  try {
    const { stdout } = await execFileAsync(cursor, ["agent", "create-chat"], {
      timeout: 180_000,
      maxBuffer: 1024 * 1024,
    });
    const id = stdout.trim().split("\n").pop()?.trim();
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}
