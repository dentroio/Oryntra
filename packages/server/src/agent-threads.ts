import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createId,
  type AgentThread,
  type ChatMessage,
} from "@oryntra/core";

export function deriveAgentThreadTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser?.content.trim()) return "Agent chat";
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

export function filterMessagesForThread(
  messages: ChatMessage[],
  threadId: string,
  defaultThreadId?: string,
): ChatMessage[] {
  return messages.filter(
    (m) =>
      m.agentThreadId === threadId ||
      (!m.agentThreadId && threadId === defaultThreadId),
  );
}

export function createAgentThreadRecord(input: {
  sessionId: string;
  title?: string;
  status?: AgentThread["status"];
  cursorChatId?: string;
}): AgentThread {
  const now = new Date().toISOString();
  return {
    id: createId("ath"),
    sessionId: input.sessionId,
    title: input.title ?? "New agent",
    status: input.status ?? "active",
    createdAt: now,
    updatedAt: now,
    cursorChatId: input.cursorChatId,
  };
}

export async function archiveAgentThreadHistory(input: {
  workspacePath: string;
  thread: AgentThread;
  messages: ChatMessage[];
}): Promise<string> {
  const dir = join(input.workspacePath, ".oryntra", "agent-history");
  await mkdir(dir, { recursive: true });
  const path = join(dir, `${input.thread.id}.md`);
  const lines = [
    `# ${input.thread.title}`,
    "",
    `_Archived ${input.thread.archivedAt ?? input.thread.updatedAt}_`,
    "",
  ];
  for (const msg of input.messages) {
    const who = msg.role === "user" ? "You" : "Agent";
    lines.push(`## ${who} · ${new Date(msg.timestamp).toLocaleString()}`, "", msg.content, "");
  }
  await writeFile(path, `${lines.join("\n")}\n`, "utf8");
  return path;
}
