#!/usr/bin/env node
import { collaborateNow } from "@oryntra/cli/collaborate";
import { openCollaborationRoom } from "@oryntra/cli/launcher";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getIdeLabel, parseIdeProvider } from "@oryntra/core";
import { OryntraApiClient } from "./client.js";

const baseUrl = process.env.ORYNTRA_URL ?? "http://127.0.0.1:4317";
const client = new OryntraApiClient(baseUrl);

async function resolveSessionId(sessionId?: string): Promise<string> {
  if (sessionId) return sessionId;
  const active = await client.getActiveSession();
  return active.id;
}

async function assertIdeTarget(sessionId: string): Promise<
  | { ok: true; session: import("@oryntra/core").ReviewSession }
  | { ok: false; skipped: true; reason: string }
> {
  const session = await client.getSession(sessionId);
  const caller = resolveIdeProvider();
  const target = session.preferredIde ?? session.ide ?? "cursor";
  if (target !== "other" && target !== caller) {
    return {
      ok: false,
      skipped: true,
      reason: `Session targets ${getIdeLabel(target)}; this MCP is ${getIdeLabel(caller)}.`,
    };
  }
  return { ok: true, session };
}

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function markdownResult(markdown: string) {
  return {
    content: [{ type: "text" as const, text: markdown }],
  };
}

const server = new McpServer({
  name: "oryntra",
  version: "0.1.0",
});

server.registerTool(
  "collaborate_now",
  {
    description:
      "One step into review: resume session, ensure server, open Review Room, sync chat history to Cursor agent (use while coding)",
    inputSchema: {
      workspacePath: z.string().optional(),
      appUrl: z.string().optional(),
      fresh: z.boolean().optional().describe("Start new session instead of resume"),
    },
  },
  async ({ workspacePath, appUrl, fresh }) => {
    const result = await collaborateNow({
      workspacePath:
        workspacePath ?? process.env.ORYNTRA_WORKSPACE ?? process.cwd(),
      appUrl,
      fresh,
      skipCursorAgent: true,
      autoStartApp: true,
      skipOpenHistory: true,
    });
    return textResult({
      ...result,
      hint:
        "Review Studio opened. Call await_review_feedback to wait for browser chat, then process_pending_review + submit_review_response.",
    });
  },
);

server.registerTool(
  "open_collaboration_room",
  {
    description:
      "Start Oryntra if needed and open the Review collaboration room for this workspace (from Cursor or VS Code)",
    inputSchema: {
      workspacePath: z
        .string()
        .optional()
        .describe(
          "Project root; defaults to ORYNTRA_WORKSPACE env or MCP process cwd",
        ),
      appUrl: z
        .string()
        .optional()
        .describe("Running app URL; falls back to oryntra.yaml"),
      ide: z
        .enum([
          "cursor",
          "vscode",
          "windsurf",
          "jetbrains",
          "zed",
          "antigravity",
          "other",
        ])
        .optional(),
      openInEditor: z
        .boolean()
        .optional()
        .describe("Open in Cursor/VS Code Simple Browser (default true)"),
    },
  },
  async ({ workspacePath, appUrl, ide, openInEditor }) => {
    const ws =
      workspacePath ?? process.env.ORYNTRA_WORKSPACE ?? process.cwd();
    const result = await openCollaborationRoom({
      workspacePath: ws,
      appUrl,
      ide:
        ide ??
        parseIdeProvider(process.env.ORYNTRA_IDE) ??
        "cursor",
      host: process.env.ORYNTRA_HOST ?? "127.0.0.1",
      port: Number(process.env.ORYNTRA_PORT ?? 4317),
      openTarget: openInEditor === false ? "browser" : "editor",
    });
    return textResult({
      ...result,
      hint: "Review in the browser; then ask the IDE agent to process feedback via get_review_context.",
    });
  },
);

server.registerTool(
  "get_active_session",
  {
    description: "Return the current Oryntra review session",
    inputSchema: {},
  },
  async () => textResult(await client.getActiveSession()),
);

server.registerTool(
  "get_browser_state",
  {
    description: "Return live browser spatial state for a review session",
    inputSchema: {
      sessionId: z.string().optional().describe("Session ID; defaults to active session"),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getBrowserState(id));
  },
);

server.registerTool(
  "get_feedback_moments",
  {
    description: "List spatial feedback moments with linked evidence",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getFeedbackMoments(id));
  },
);

server.registerTool(
  "get_pending_feedback",
  {
    description:
      "List feedback moments waiting for the IDE agent (Cursor) to process — use this as the review facilitator queue",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getPendingFeedback(id));
  },
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

server.registerTool(
  "await_review_feedback",
  {
    description:
      "Block until the reviewer sends feedback in Review Studio (polls pending queue). Use after collaborate_now.",
    inputSchema: {
      sessionId: z.string().optional(),
      pollIntervalMs: z
        .number()
        .optional()
        .describe("Poll interval in ms (default 2000)"),
      timeoutMs: z
        .number()
        .optional()
        .describe("Max wait in ms (default 300000)"),
    },
  },
  async ({ sessionId, pollIntervalMs, timeoutMs }) => {
    const id = await resolveSessionId(sessionId);
    const interval = pollIntervalMs ?? 2000;
    const deadline = Date.now() + (timeoutMs ?? 300_000);
    while (Date.now() < deadline) {
      const pending = await client.getPendingFeedback(id);
      if (pending.length > 0) {
        const latest = pending[pending.length - 1]!;
        return textResult({
          event: "review_feedback_received",
          feedbackMomentId: latest.id,
          transcript: latest.transcript,
          nextStep:
            "Call process_pending_review, then submit_review_response with a conversational reply and change_request draft when appropriate.",
        });
      }
      await sleep(interval);
    }
    return textResult({ event: "timeout", pending: [] });
  },
);

server.registerTool(
  "process_pending_review",
  {
    description:
      "Load full context for the latest pending Review Studio feedback (browser state, transcript, artifacts)",
    inputSchema: {
      sessionId: z.string().optional(),
      feedbackMomentId: z
        .string()
        .optional()
        .describe("Defaults to the oldest pending moment"),
    },
  },
  async ({ sessionId, feedbackMomentId }) => {
    const id = await resolveSessionId(sessionId);
    const gate = await assertIdeTarget(id);
    if (!gate.ok) return textResult(gate);
    const pending = await client.getPendingFeedback(id);
    if (pending.length === 0) {
      return textResult({ error: "No pending feedback" });
    }
    const moment = feedbackMomentId
      ? pending.find((m) => m.id === feedbackMomentId)
      : pending[0];
    if (!moment) {
      return textResult({ error: `Pending moment not found: ${feedbackMomentId}` });
    }
    const [session, browserState, transcript, artifacts] = await Promise.all([
      client.getSession(id),
      client.getBrowserState(id),
      client.getTranscript(id),
      client.listArtifacts(id),
    ]);
    return textResult({
      session,
      feedbackMoment: moment,
      browserState,
      transcript,
      artifacts,
      workspacePath: session.workspacePath,
      appUrl: session.appUrl,
      instructions:
        "Reply conversationally in Review Studio via submit_review_response. Include a change_request draft when the reviewer wants a change.",
    });
  },
);

server.registerTool(
  "get_review_context",
  {
    description:
      "Full context for processing review feedback: pending moments, browser state, transcript, artifacts, session",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    const [session, pending, browserState, transcript, artifacts] =
      await Promise.all([
        client.getSession(id),
        client.getPendingFeedback(id),
        client.getBrowserState(id),
        client.getTranscript(id),
        client.listArtifacts(id),
      ]);
    return textResult({
      session,
      pendingFeedback: pending,
      browserState,
      transcript,
      artifacts,
      workspacePath: session.workspacePath,
      appUrl: session.appUrl,
    });
  },
);

server.registerTool(
  "submit_review_response",
  {
    description:
      "Post the IDE agent's review response back to Oryntra: chat reply + optional change requests / work orders",
    inputSchema: {
      sessionId: z.string().optional(),
      feedbackMomentId: z
        .string()
        .describe("Feedback moment ID from get_pending_feedback"),
      summary: z.string().describe("Short summary of interpretation"),
      chatMessage: z
        .string()
        .optional()
        .describe("Full agent reply shown in Review Room chat"),
      artifacts: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Change requests, work orders, or doc updates to create"),
    },
  },
  async ({ sessionId, feedbackMomentId, summary, chatMessage, artifacts }) => {
    const id = await resolveSessionId(sessionId);
    const gate = await assertIdeTarget(id);
    if (!gate.ok) return textResult(gate);
    return textResult(
      await client.submitReviewResponse(id, {
        feedbackMomentId,
        summary,
        chatMessage,
        artifacts: artifacts as import("@oryntra/core").ReviewArtifact[],
      }),
    );
  },
);

server.registerTool(
  "get_review_transcript",
  {
    description: "Return the review room chat transcript (JSON)",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getTranscript(id));
  },
);

server.registerTool(
  "get_review_history",
  {
    description:
      "Human-readable review history for Cursor — same chat, change requests, and implementation log as the Review Room. Also synced to .oryntra/review-history.md in the workspace.",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    const history = await client.getReviewHistory(id);
    return markdownResult(
      `${history.markdown}\n\n---\n_File: ${history.path}_\n_Review Room: ${history.reviewRoomUrl}_`,
    );
  },
);

server.registerTool(
  "list_review_artifacts",
  {
    description: "List change requests, work orders, and doc/arch updates",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.listArtifacts(id));
  },
);

server.registerTool(
  "approve_artifact",
  {
    description: "Approve or reject a review artifact by ID",
    inputSchema: {
      sessionId: z.string().optional(),
      artifactId: z.string().describe("Artifact ID to update"),
      status: z
        .enum(["approved", "rejected", "draft", "in-progress"])
        .describe("New artifact status"),
    },
  },
  async ({ sessionId, artifactId, status }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(
      await client.updateArtifactStatus(id, artifactId, status),
    );
  },
);

server.registerTool(
  "get_worktree_status",
  {
    description: "Return git worktree path and branch for isolated implementation",
    inputSchema: { sessionId: z.string().optional() },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getWorktree(id));
  },
);

server.registerTool(
  "prepare_execution",
  {
    description:
      "Create worktree if needed and return execution plan from approved artifacts",
    inputSchema: { sessionId: z.string().optional() },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.prepareExecution(id));
  },
);

server.registerTool(
  "apply_approved_docs",
  {
    description:
      "Apply approved doc_update artifacts into the session worktree",
    inputSchema: { sessionId: z.string().optional() },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.applyApprovedDocs(id));
  },
);

server.registerTool(
  "get_implement_status",
  {
    description: "Return implementation progress for approved artifacts",
    inputSchema: { sessionId: z.string().optional() },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.getImplementStatus(id));
  },
);

server.registerTool(
  "request_implementation",
  {
    description:
      "Write implement-request.json and start the implementation handoff for approved artifacts",
    inputSchema: { sessionId: z.string().optional() },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    const gate = await assertIdeTarget(id);
    if (!gate.ok) return textResult(gate);
    return textResult(await client.requestImplementation(id));
  },
);

server.registerTool(
  "propose_patch",
  {
    description: "Draft a structured patch from an approved change_request artifact",
    inputSchema: {
      sessionId: z.string().optional(),
      artifactId: z.string(),
    },
  },
  async ({ sessionId, artifactId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.proposePatch(id, artifactId));
  },
);

server.registerTool(
  "apply_patch",
  {
    description: "Apply a proposed patch in the session git worktree",
    inputSchema: {
      sessionId: z.string().optional(),
      patch: z.record(z.string(), z.unknown()),
    },
  },
  async ({ sessionId, patch }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(
      await client.applyPatch(
        id,
        patch as import("@oryntra/core").ProposedPatch,
      ),
    );
  },
);

server.registerTool(
  "handoff_to_ide",
  {
    description:
      "Package session summary, feedback moments, artifacts, and transcript for IDE execution",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    return textResult(await client.handoff(id));
  },
);

server.registerTool(
  "summarize_session",
  {
    description: "Create a handoff summary with decisions and open items",
    inputSchema: {
      sessionId: z.string().optional(),
    },
  },
  async ({ sessionId }) => {
    const id = await resolveSessionId(sessionId);
    const handoff = await client.handoff(id);
    return textResult({
      summary: handoff.summary,
      openItems: handoff.openItems,
      artifactCount: handoff.artifacts.length,
      feedbackMomentCount: handoff.feedbackMoments.length,
      workspacePath: handoff.session.workspacePath,
      appUrl: handoff.session.appUrl,
    });
  },
);

function resolveIdeProvider(): import("@oryntra/core").IdeProvider {
  return parseIdeProvider(process.env.ORYNTRA_IDE) ?? "cursor";
}

async function sendIdeHeartbeat(): Promise<void> {
  await fetch(`${baseUrl}/api/ide/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: resolveIdeProvider(),
      clientId: process.env.ORYNTRA_MCP_CLIENT_ID ?? "mcp-stdio",
      workspacePath: process.env.ORYNTRA_WORKSPACE,
      source: "mcp",
    }),
  }).catch(() => {});
}

void sendIdeHeartbeat();
setInterval(() => {
  void sendIdeHeartbeat();
}, 30_000);

const transport = new StdioServerTransport();
await server.connect(transport);
