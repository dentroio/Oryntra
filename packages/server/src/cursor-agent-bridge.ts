import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeCursorAgentError } from "./cursor-agent-errors.js";
import { promisify } from "node:util";
import type { ChatMessage, ReviewArtifact, ReviewSession } from "@oryntra/core";
import {
  formatReviewHistoryMarkdown,
  readImplementActivityLog,
} from "./review-history.js";

const execFileAsync = promisify(execFile);

export type CursorAgentSession = {
  sessionId: string;
  cursorChatId: string;
  workspacePath: string;
  reviewRoomUrl: string;
  lastSyncedChatMessageId?: string;
  createdAt: string;
  updatedAt: string;
};

export type EnsureCursorAgentResult = {
  cursorChatId: string;
  created: boolean;
  resumeCommand: string;
  agentSessionPath: string;
};

function findCursorBinary(): string | null {
  const candidates = [
    process.env.CURSOR_PATH,
    "/Applications/Cursor.app/Contents/Resources/app/bin/cursor",
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

export function agentSessionPath(workspacePath: string): string {
  return join(workspacePath, ".oryntra", "agent-session.json");
}

export async function readCursorAgentSession(
  workspacePath: string,
): Promise<CursorAgentSession | null> {
  const path = agentSessionPath(workspacePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as CursorAgentSession;
  } catch {
    return null;
  }
}

async function writeCursorAgentSession(
  session: CursorAgentSession,
): Promise<string> {
  const path = agentSessionPath(session.workspacePath);
  await mkdir(join(session.workspacePath, ".oryntra"), { recursive: true });
  await writeFile(path, JSON.stringify(session, null, 2), "utf8");
  return path;
}

export function buildResumeCommand(input: {
  workspacePath: string;
  cursorChatId: string;
  interactive?: boolean;
}): string {
  const cursor = findCursorBinary() ?? "cursor";
  const parts = [
    `"${cursor}"`,
    "agent",
    "--resume",
    input.cursorChatId,
    "--workspace",
    `"${input.workspacePath}"`,
    "-f",
    "--approve-mcps",
  ];
  if (!input.interactive) {
    parts.push("-p", "--trust", "--mode", "ask");
  }
  return parts.join(" ");
}

async function createCursorChat(): Promise<string | null> {
  const cursor = findCursorBinary();
  if (!cursor) return null;
  try {
    const { stdout } = await execFileAsync(
      cursor,
      ["agent", "create-chat"],
      { timeout: 60_000, maxBuffer: 1024 * 1024 },
    );
    const id = stdout.trim().split("\n").pop()?.trim();
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch {
    return null;
  }
}

function formatChatDelta(messages: ChatMessage[]): string {
  const lines = messages.map((msg) => {
    const who = msg.role === "user" ? "Reviewer" : "Oryntra agent";
    return `**${who}:** ${msg.content}`;
  });
  return lines.join("\n\n");
}

function formatImplementUpdate(steps: string[]): string {
  return [
    "**Implementation activity**",
    ...steps.map((s) => `- ${s}`),
  ].join("\n");
}

function buildSyncPrompt(input: {
  session: ReviewSession;
  reviewRoomUrl: string;
  messages: ChatMessage[];
  artifacts: ReviewArtifact[];
  implementSteps?: string[];
  full: boolean;
}): string {
  if (input.full) {
    const markdown = formatReviewHistoryMarkdown({
      session: input.session,
      reviewRoomUrl: input.reviewRoomUrl,
      chat: input.messages,
      artifacts: input.artifacts,
      implementSteps: input.implementSteps,
    });
    return [
      "[Oryntra Review — session briefing]",
      "",
      "You are the Oryntra implementation agent for this review. The reviewer uses Review Studio in the browser; this chat mirrors that conversation so the developer sees full history in Cursor.",
      "",
      `Review Room: ${input.reviewRoomUrl}`,
      `Workspace: ${input.session.workspacePath}`,
      `Also on disk: ${join(input.session.workspacePath, ".oryntra", "review-history.md")}`,
      "",
      "When the reviewer approves a change in Review Studio, implement it in the workspace. Acknowledge this briefing briefly, then wait for updates.",
      "",
      markdown,
    ].join("\n");
  }

  const parts = ["[Oryntra Review — update]", ""];
  if (input.messages.length > 0) {
    parts.push(formatChatDelta(input.messages), "");
  }
  if (input.implementSteps?.length) {
    parts.push(formatImplementUpdate(input.implementSteps), "");
  }
  parts.push(
    "This is a history sync from Review Studio. Reply with a one-line acknowledgment only (e.g. 'Synced'). Do not edit files unless the update says the reviewer approved a change.",
  );
  return parts.join("\n");
}

async function runHeadlessSync(input: {
  workspacePath: string;
  cursorChatId: string;
  prompt: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const cursor = findCursorBinary();
  if (!cursor) {
    return { ok: false, reason: "Cursor CLI not found" };
  }

  return new Promise((resolve) => {
    const child = spawn(
      cursor,
      [
        "agent",
        "--resume",
        input.cursorChatId,
        "-p",
        "--trust",
        "--mode",
        "ask",
        "--workspace",
        input.workspacePath,
        input.prompt,
      ],
      {
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.unref();
    child.on("error", (err) => {
      resolve({
        ok: false,
        reason: err instanceof Error ? err.message : "spawn failed",
      });
    });
    child.on("spawn", () => resolve({ ok: true }));
  });
}

export async function ensureCursorAgentSession(input: {
  session: ReviewSession;
  reviewRoomUrl: string;
  forceNew?: boolean;
  cursorChatId?: string;
}): Promise<EnsureCursorAgentResult | null> {
  const existing = await readCursorAgentSession(input.session.workspacePath);
  let cursorChatId = input.cursorChatId ?? existing?.cursorChatId;
  let created = false;

  if (input.forceNew || !cursorChatId) {
    const newId = input.cursorChatId ?? (await createCursorChat());
    if (!newId) return null;
    cursorChatId = newId;
    created = true;
  }

  const now = new Date().toISOString();
  const record: CursorAgentSession = {
    sessionId: input.session.id,
    cursorChatId,
    workspacePath: input.session.workspacePath,
    reviewRoomUrl: input.reviewRoomUrl,
    lastSyncedChatMessageId: created
      ? undefined
      : existing?.lastSyncedChatMessageId,
    createdAt: created ? now : (existing?.createdAt ?? now),
    updatedAt: now,
  };

  const agentSessionPathWritten = await writeCursorAgentSession(record);

  return {
    cursorChatId,
    created,
    resumeCommand: buildResumeCommand({
      workspacePath: input.session.workspacePath,
      cursorChatId,
      interactive: true,
    }),
    agentSessionPath: agentSessionPathWritten,
  };
}

export async function syncChatToCursorAgent(input: {
  session: ReviewSession;
  reviewRoomUrl: string;
  chat: ChatMessage[];
  artifacts: ReviewArtifact[];
  forceFull?: boolean;
}): Promise<{ synced: boolean; reason?: string }> {
  const configEnabled = process.env.ORYNTRA_CURSOR_AGENT_SYNC !== "0";
  if (!configEnabled) {
    return { synced: false, reason: "sync disabled" };
  }

  const agentSession = await readCursorAgentSession(input.session.workspacePath);
  if (!agentSession) {
    return { synced: false, reason: "no agent session" };
  }

  const implementSteps = await readImplementActivityLog(
    input.session.workspacePath,
  );

  let delta = input.chat;
  let full = input.forceFull ?? false;

  if (!full && agentSession.lastSyncedChatMessageId) {
    const idx = input.chat.findIndex(
      (m) => m.id === agentSession.lastSyncedChatMessageId,
    );
    delta = idx >= 0 ? input.chat.slice(idx + 1) : input.chat;
    if (delta.length === 0 && !implementSteps?.length) {
      return { synced: true };
    }
  } else if (input.chat.length === 0 && !implementSteps?.length) {
    return { synced: true };
  } else {
    full = true;
  }

  const prompt = buildSyncPrompt({
    session: input.session,
    reviewRoomUrl: input.reviewRoomUrl,
    messages: full ? input.chat : delta,
    artifacts: input.artifacts,
    implementSteps: full ? implementSteps : implementSteps,
    full,
  });

  const result = await runHeadlessSync({
    workspacePath: input.session.workspacePath,
    cursorChatId: agentSession.cursorChatId,
    prompt,
  });

  if (result.ok && input.chat.length > 0) {
    const latest = input.chat[input.chat.length - 1]!;
    await writeCursorAgentSession({
      ...agentSession,
      lastSyncedChatMessageId: latest.id,
      updatedAt: new Date().toISOString(),
    });
  }

  return { synced: result.ok, reason: result.reason };
}

export function spawnInteractiveCursorAgent(input: {
  workspacePath: string;
  cursorChatId: string;
  prompt?: string;
}): { started: boolean; command: string; reason?: string } {
  const cursor = findCursorBinary();
  if (!cursor) {
    return {
      started: false,
      command: "",
      reason: "Cursor CLI not found",
    };
  }

  const args = [
    "agent",
    "--resume",
    input.cursorChatId,
    "--workspace",
    input.workspacePath,
    "-f",
    "--approve-mcps",
  ];
  if (input.prompt) {
    args.push(input.prompt);
  }

  const command = buildResumeCommand({
    workspacePath: input.workspacePath,
    cursorChatId: input.cursorChatId,
    interactive: true,
  });

  const child = spawn(cursor, args, {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  return { started: true, command };
}

export async function runCursorAgentProbe(): Promise<{
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
      ["agent", "--print", "--mode", "ask", "--workspace", process.cwd(), "ping"],
      { timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: sanitizeCursorAgentError(error) };
  }
}

export async function runCursorAgentPrompt(input: {
  workspacePath: string;
  cursorChatId: string;
  prompt: string;
  timeoutMs?: number;
}): Promise<{ ok: boolean; text?: string; reason?: string }> {
  const cursor = findCursorBinary();
  if (!cursor) {
    return { ok: false, reason: "Cursor CLI not found" };
  }

  const promptDir = join(input.workspacePath, ".oryntra");
  await mkdir(promptDir, { recursive: true });
  const promptPath = join(promptDir, "review-prompt.txt");
  await writeFile(promptPath, input.prompt, "utf8");

  const cliPrompt =
    "Read .oryntra/review-prompt.txt for the full Oryntra review context and instructions. " +
    "Reply in plain language, then end with the ORYNTRA_JSON line exactly as specified in that file.";

  try {
    const { stdout, stderr } = await execFileAsync(
      cursor,
      [
        "agent",
        "--resume",
        input.cursorChatId,
        "-p",
        "--print",
        "--trust",
        "--mode",
        "ask",
        "--workspace",
        input.workspacePath,
        cliPrompt,
      ],
      {
        timeout: input.timeoutMs ?? 180_000,
        maxBuffer: 4 * 1024 * 1024,
        env: process.env,
      },
    );
    const text = stdout.trim() || stderr.trim();
    if (!text) {
      return { ok: false, reason: "Cursor agent returned empty response" };
    }
    return { ok: true, text };
  } catch (error) {
    return { ok: false, reason: sanitizeCursorAgentError(error) };
  }
}

export function buildReviewFacilitatorPrompt(input: {
  session: ReviewSession;
  moment: import("@oryntra/core").FeedbackMoment;
  transcript: string;
  chatHistory?: ChatMessage[];
  artifacts?: ReviewArtifact[];
  reviewRoomUrl: string;
  effectiveTranscript: string;
}): string {
  const element =
    input.moment.spatial.lockedElement ??
    input.moment.spatial.lastClickedElement ??
    input.moment.spatial.elementUnderPointer;

  return [
    "[Oryntra Review Studio — live feedback]",
    "",
    "You are the review agent in this Cursor chat. The reviewer types in Review Studio (browser); you reply here and in Review Studio chat.",
    "Use the full conversation below — including prior messages — not only the latest line.",
    "",
    `Review Room: ${input.reviewRoomUrl}`,
    `App: ${input.session.appUrl}`,
    `Route: ${input.moment.spatial.route}`,
    `Page title: ${input.moment.spatial.pageTitle ?? ""}`,
    `Mouse: ${input.moment.spatial.mouse.x}, ${input.moment.spatial.mouse.y}`,
    `Element: ${JSON.stringify(element ?? null)}`,
    "",
    input.effectiveTranscript,
    "",
    "Instructions:",
    "- Reply in plain language (2–4 sentences). Be specific about what you will change.",
    "- Do not edit files yet — the reviewer approves first.",
    "- End with exactly one line (no markdown fence):",
    'ORYNTRA_JSON={"interpretation":"wrong|missing|correct|unclear","changeRequest":{"title":"short title","currentBehavior":"what happens now","expectedBehavior":"what should happen"}}',
    "- Omit changeRequest when the feedback is purely positive.",
  ].join("\n");
}

export function spawnCursorImplementAgent(input: {
  workspacePath: string;
  prompt: string;
  implementRequestPath: string;
  cursorChatId?: string;
  forceNewChat?: boolean;
}): Promise<{ started: boolean; reason?: string; cursorChatId?: string }> {
  return (async () => {
    const cursor = findCursorBinary();
    if (!cursor) {
      return { started: false, reason: "Cursor CLI not found" };
    }

    let chatId = input.cursorChatId;
    if (input.forceNewChat || !chatId) {
      chatId = (await createCursorChat()) ?? undefined;
    }
    if (!chatId) {
      return { started: false, reason: "Could not create Cursor chat" };
    }

    const prompt = [
      input.prompt,
      `Implement request file: ${input.implementRequestPath}`,
      "Read codeRoot from that file and edit only under that path.",
      "When done, set status to completed with completedAt in that JSON file.",
    ].join(" ");

    const args = [
      "agent",
      "--resume",
      chatId,
      "--print",
      "--force",
      "--trust",
      "--workspace",
      input.workspacePath,
      prompt,
    ];

    const child = spawn(cursor, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    child.unref();

    return { started: true, cursorChatId: chatId };
  })();
}
