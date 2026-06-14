import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type IdePendingRecord = {
  sessionId: string;
  feedbackMomentId: string;
  transcript: string;
  createdAt: string;
  reviewRoomUrl: string;
  targetIde?: import("@oryntra/core").IdeProvider;
};

export async function writeIdePendingFile(
  workspacePath: string,
  record: IdePendingRecord,
): Promise<string> {
  const dir = join(workspacePath, ".oryntra");
  await mkdir(dir, { recursive: true });
  const path = join(dir, "ide-pending.json");
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

export async function clearIdePendingFile(
  workspacePath: string,
  feedbackMomentId?: string,
): Promise<void> {
  const path = join(workspacePath, ".oryntra", "ide-pending.json");
  try {
    const { readFile, unlink } = await import("node:fs/promises");
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as IdePendingRecord;
    if (feedbackMomentId && parsed.feedbackMomentId !== feedbackMomentId) {
      return;
    }
    await unlink(path);
  } catch {
    // no pending file
  }
}
