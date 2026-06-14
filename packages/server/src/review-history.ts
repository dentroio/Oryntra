import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChatMessage, ReviewArtifact, ReviewSession } from "@oryntra/core";

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function artifactTitle(artifact: ReviewArtifact): string {
  if (artifact.kind === "change_request") return artifact.title;
  if (artifact.kind === "work_order") return artifact.title;
  if (artifact.kind === "doc_update") return artifact.summary;
  return artifact.section;
}

export function formatReviewHistoryMarkdown(input: {
  session: ReviewSession;
  reviewRoomUrl: string;
  chat: ChatMessage[];
  artifacts: ReviewArtifact[];
  implementSteps?: string[];
  workspaceScoped?: boolean;
}): string {
  const lines: string[] = [
    "# Oryntra Review History",
    "",
    `**Workspace:** ${input.session.workspacePath}`,
    `**Active session:** ${input.session.id}`,
    `**Review Room:** ${input.reviewRoomUrl}`,
    `**Updated:** ${new Date().toISOString()}`,
    "",
    input.workspaceScoped
      ? "> Full review history for this workspace (all sessions). Open in Cursor anytime."
      : "> Open in Cursor anytime — this file mirrors the Review Room chat.",
    "",
    "## Chat",
    "",
  ];

  if (input.chat.length === 0) {
    lines.push("_No messages yet._", "");
  } else {
    for (const msg of input.chat) {
      const who = msg.role === "user" ? "You" : "Agent";
      lines.push(`### ${who} · ${formatTime(msg.timestamp)}`, "");
      lines.push(msg.content, "");
    }
  }

  lines.push("## Change requests", "");
  const changes = input.artifacts.filter((a) => a.kind === "change_request");
  if (changes.length === 0) {
    lines.push("_None yet._", "");
  } else {
    for (const a of changes) {
      if (a.kind !== "change_request") continue;
      lines.push(
        `- **${a.status}** — ${a.title}`,
        `  - Expected: ${a.expectedBehavior}`,
      );
    }
    lines.push("");
  }

  if (input.implementSteps?.length) {
    lines.push("## Implementation activity", "");
    for (const step of input.implementSteps) {
      lines.push(`- ${step}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export async function readImplementActivityLog(
  workspacePath: string,
): Promise<string[] | undefined> {
  const path = join(workspacePath, ".oryntra", "implement-request.json");
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as {
      activityLog?: string[];
      steps?: string[];
      status?: string;
    };
    const log = raw.activityLog ?? raw.steps ?? [];
    if (raw.status === "completed" && !log.some((s) => s.startsWith("Done"))) {
      return [...log, "Done — change is live in the preview."];
    }
    return log.length > 0 ? log : undefined;
  } catch {
    return undefined;
  }
}

export async function syncReviewHistoryToWorkspace(input: {
  session: ReviewSession;
  reviewRoomUrl: string;
  chat: ChatMessage[];
  artifacts: ReviewArtifact[];
}): Promise<string> {
  const implementSteps = await readImplementActivityLog(input.session.workspacePath);
  const markdown = formatReviewHistoryMarkdown({
    ...input,
    implementSteps,
  });
  const path = join(input.session.workspacePath, ".oryntra", "review-history.md");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, "utf8");
  return path;
}
