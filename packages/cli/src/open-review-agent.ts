import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openFileInEditor } from "./launcher.js";

type AgentSessionFile = {
  cursorChatId: string;
  workspacePath: string;
};

export async function openReviewAgent(options: {
  workspacePath?: string;
}): Promise<{
  started: boolean;
  historyPath?: string;
  command?: string;
  reason?: string;
}> {
  const workspacePath = resolve(
    options.workspacePath ??
      process.env.ORYNTRA_WORKSPACE ??
      process.cwd(),
  );
  const historyPath = resolve(workspacePath, ".oryntra", "review-history.md");
  const sessionPath = resolve(workspacePath, ".oryntra", "agent-session.json");

  if (!existsSync(historyPath)) {
    return {
      started: false,
      reason: `No review history at ${historyPath} — run collaborate first`,
    };
  }

  const opened = await openFileInEditor(historyPath);

  let command: string | undefined;
  if (existsSync(sessionPath)) {
    const raw = JSON.parse(
      await readFile(sessionPath, "utf8"),
    ) as AgentSessionFile;
    command = [
      "cursor",
      "agent",
      "--resume",
      raw.cursorChatId,
      "--workspace",
      `"${raw.workspacePath}"`,
      "-f",
      "--approve-mcps",
    ].join(" ");
  }

  return {
    started: opened,
    historyPath,
    command,
    reason: opened
      ? undefined
      : "Could not open review-history.md in Cursor — open the file manually",
  };
}
