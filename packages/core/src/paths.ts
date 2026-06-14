import { homedir } from "node:os";
import { join } from "node:path";

export function getOryntraDataDir(): string {
  return join(homedir(), ".oryntra");
}

export function getSessionDir(sessionId: string): string {
  return join(getOryntraDataDir(), "sessions", sessionId);
}

export function getScreenshotPath(sessionId: string, screenshotId: string): string {
  return join(getSessionDir(sessionId), "screenshots", `${screenshotId}.png`);
}

export function getSnapshotPath(
  sessionId: string,
  snapshotId: string,
): string {
  return join(getSessionDir(sessionId), "snapshots", `${snapshotId}.json`);
}
