import { createReadStream, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import type { BridgeEventPayload } from "@oryntra/browser-service";
import type { BridgeCaptureUpload } from "@oryntra/browser-service";
import {
  getScreenshotPath,
  type CreateSessionRequest,
  type ReviewArtifact,
  type ReviewMode,
  type SubmitFeedbackRequest,
  type SubmitIdeAgentResponseRequest,
  type UpdateArtifactRequest,
} from "@oryntra/core";
import Fastify from "fastify";
import { openDatabase } from "./db.js";
import { SessionManager } from "./session-manager.js";
import { SessionStore } from "./store.js";
import { IdeRegistry } from "./ide-registry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const html2canvasPath = join(
  dirname(require.resolve("html2canvas/package.json")),
  "dist/html2canvas.min.js",
);

export type CreateAppOptions = {
  host?: string;
  port?: number;
  reviewRoomDist?: string;
};

export async function createApp(options: CreateAppOptions = {}) {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4317;
  const app = Fastify({ logger: true });
  const db = openDatabase();
  const store = new SessionStore(db);
  const ideRegistry = new IdeRegistry();
  const manager = new SessionManager({ host, port, store, ideRegistry });

  const reviewRoomDist =
    options.reviewRoomDist ??
    join(__dirname, "../../review-room/dist");
  const publicDir = join(__dirname, "../public");

  await app.register(cors, { origin: true });

  app.get("/oryntra-bridge.js", async (_req, reply) => {
    return reply.sendFile("oryntra-bridge.js", publicDir);
  });

  app.get("/oryntra-html2canvas.js", async (_req, reply) => {
    return reply.sendFile("html2canvas.min.js", dirname(html2canvasPath));
  });

  if (existsSync(reviewRoomDist)) {
    await app.register(fastifyStatic, {
      root: reviewRoomDist,
      prefix: "/",
    });
  }

  await app.register(websocket);

  app.get("/health", async () => ({ ok: true }));

  app.post<{ Body: import("@oryntra/core").IdeHeartbeatRequest }>(
    "/api/ide/heartbeat",
    async (req) => ideRegistry.heartbeat(req.body),
  );

  app.get<{ Querystring: { workspacePath?: string } }>(
    "/api/ide/connected",
    async (req) => ({
      ides: ideRegistry.listConnected(req.query.workspacePath),
    }),
  );

  app.get<{ Querystring: { workspacePath?: string } }>(
    "/api/ide/available",
    async (req) => ({
      ides: await ideRegistry.listAvailable(req.query.workspacePath),
    }),
  );

  app.post<{ Params: { id: string }; Body: { preferredIde?: string } }>(
    "/api/sessions/:id/preferred-ide",
    async (req, reply) => {
      try {
        return await manager.setPreferredIde(
          req.params.id,
          req.body.preferredIde as import("@oryntra/core").IdeProvider,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Update failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/ide-target",
    async (req, reply) => {
      try {
        return await manager.getIdeTarget(req.params.id);
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/snap",
    async (req, reply) => {
      try {
        return await manager.captureSnap(req.params.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Snap failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { artifactId: string } }>(
    "/api/sessions/:id/propose-patch",
    async (req, reply) => {
      try {
        return await manager.proposePatchForArtifact(
          req.params.id,
          req.body.artifactId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Propose patch failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{
    Params: { id: string };
    Body: import("@oryntra/core").ProposedPatch;
  }>("/api/sessions/:id/apply-patch", async (req, reply) => {
    try {
      return await manager.applyApprovedPatch(req.params.id, req.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Apply patch failed";
      return reply.code(400).send({ error: message });
    }
  });

  app.post<{ Params: { id: string }; Body: BridgeEventPayload }>(
    "/api/sessions/:id/bridge-events",
    async (req, reply) => {
      try {
        await manager.ingestBridgeEvent(req.params.id, req.body);
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/bridge-capture/pending",
    { logLevel: "silent" },
    async (req, reply) => {
      try {
        return manager.getPendingBridgeCapture(req.params.id);
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: BridgeCaptureUpload }>(
    "/api/sessions/:id/bridge-capture",
    async (req, reply) => {
      try {
        const ok = await manager.fulfillBridgeCapture(
          req.params.id,
          req.body,
        );
        if (!ok) {
          return reply.code(409).send({ error: "No matching capture request" });
        }
        return { ok: true };
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.post<{ Body: CreateSessionRequest }>("/api/sessions", async (req, reply) => {
    const result = await manager.createSession(req.body);
    return reply.code(201).send(result);
  });

  app.get("/api/sessions/active", async (_req, reply) => {
    const session = manager.getActiveSession();
    if (!session) return reply.code(404).send({ error: "No active session" });
    return session;
  });

  app.get<{ Params: { id: string } }>("/api/sessions/:id", async (req, reply) => {
    const session = await manager.getSessionDetail(req.params.id);
    if (!session) return reply.code(404).send({ error: "Session not found" });
    return session;
  });

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/handoff",
    async (req, reply) => {
      try {
        return await manager.buildHandoff(req.params.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Handoff failed";
        return reply.code(404).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/implement",
    async (req, reply) => {
      try {
        return await manager.requestImplementation(req.params.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Implement request failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/implement-status",
    async (req, reply) => {
      try {
        const status = await manager.getImplementStatus(req.params.id);
        if (status.status === "completed") {
          await manager.markImplementCompleted(req.params.id);
        }
        return status;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Status check failed";
        return reply.code(404).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/worktree",
    async (req, reply) => {
      const status = await manager.getWorktree(req.params.id);
      if (!status) return reply.code(404).send({ error: "No worktree for session" });
      return status;
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/worktree",
    async (req, reply) => {
      try {
        const session = await manager.ensureWorktree(req.params.id);
        const status = await manager.getWorktree(req.params.id);
        return { session, worktree: status };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Worktree creation failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/execution-plan",
    async (req, reply) => {
      try {
        return await manager.prepareExecution(req.params.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Execution plan failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/apply-docs",
    async (req, reply) => {
      try {
        return await manager.applyApprovedDocUpdates(req.params.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Apply docs failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/browser-state",
    async (req, reply) => {
      try {
        return await manager.getBrowserState(req.params.id);
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: SubmitFeedbackRequest }>(
    "/api/sessions/:id/feedback",
    async (req, reply) => {
      try {
        return await manager.submitFeedback(req.params.id, req.body);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Feedback failed";
        return reply.code(400).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { mode: ReviewMode } }>(
    "/api/sessions/:id/review-mode",
    async (req, reply) => {
      try {
        return await manager.setReviewMode(req.params.id, req.body.mode);
      } catch {
        return reply.code(404).send({ error: "Session not active" });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/artifacts",
    async (req) => manager.listArtifacts(req.params.id),
  );

  app.post<{ Params: { id: string }; Body: ReviewArtifact }>(
    "/api/sessions/:id/artifacts",
    async (req, reply) => {
      if (req.body.sessionId !== req.params.id) {
        return reply.code(400).send({ error: "sessionId mismatch" });
      }
      return manager.saveArtifact(req.body);
    },
  );

  app.patch<{
    Params: { id: string; artifactId: string };
    Body: UpdateArtifactRequest;
  }>("/api/sessions/:id/artifacts/:artifactId", async (req, reply) => {
    try {
      return await manager.updateArtifactStatus(
        req.params.id,
        req.params.artifactId,
        req.body.status,
        { cursorAgent: req.body.cursorAgent },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Artifact update failed";
      return reply.code(404).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/feedback-moments",
    async (req) => manager.listFeedbackMoments(req.params.id),
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/pending-feedback",
    async (req) => manager.listPendingFeedbackMoments(req.params.id),
  );

  app.post<{
    Params: { id: string };
    Body: SubmitIdeAgentResponseRequest;
  }>("/api/sessions/:id/ide-response", async (req, reply) => {
    try {
      return manager.submitIdeAgentResponse(req.params.id, req.body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "IDE response failed";
      return reply.code(404).send({ error: message });
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/events",
    async (req) => manager.listBrowserEvents(req.params.id),
  );

  app.get<{
    Params: { id: string };
    Querystring: { threadId?: string };
  }>("/api/sessions/:id/chat", async (req) =>
    manager.listChatMessages(req.params.id, req.query.threadId),
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/agent-threads",
    async (req) => manager.listAgentThreads(req.params.id),
  );

  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/agent-threads/new",
    async (req, reply) => {
      try {
        return await manager.createNewAgentThread(req.params.id);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "New agent thread failed";
        return reply.code(404).send({ error: message });
      }
    },
  );

  app.post<{ Params: { id: string; threadId: string } }>(
    "/api/sessions/:id/agent-threads/:threadId/activate",
    async (req, reply) => {
      try {
        return await manager.activateAgentThread(
          req.params.id,
          req.params.threadId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Activate thread failed";
        return reply.code(404).send({ error: message });
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/review-history",
    async (req, reply) => {
      const history = await manager.getReviewHistory(req.params.id);
      if (!history) {
        return reply.code(404).send({ error: "Session not found" });
      }
      return history;
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/cursor-agent",
    async (req, reply) => {
      const info = await manager.getCursorAgentInfo(req.params.id);
      if (!info) {
        return reply.code(404).send({ error: "No Cursor agent session" });
      }
      return info;
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      forceNew?: boolean;
      spawnInteractive?: boolean;
      cursorChatId?: string;
    };
  }>("/api/sessions/:id/cursor-agent/ensure", async (req, reply) => {
    try {
      const result = await manager.ensureCursorAgent(req.params.id, {
        forceNew: req.body?.forceNew,
        spawnInteractive: req.body?.spawnInteractive,
        cursorChatId: req.body?.cursorChatId,
      });
      if (!result) {
        return reply
          .code(404)
          .send({ error: "Cursor agent unavailable — create chat from CLI" });
      }
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Cursor agent setup failed";
      return reply.code(500).send({ error: message });
    }
  });

  app.get<{ Params: { id: string; screenshotId: string } }>(
    "/api/sessions/:id/screenshots/:screenshotId",
    async (req, reply) => {
      const path = getScreenshotPath(req.params.id, req.params.screenshotId);
      if (!existsSync(path)) {
        return reply.code(404).send({ error: "Screenshot not found" });
      }
      return reply.type("image/png").send(createReadStream(path));
    },
  );

  app.get("/session/:id", async (_req, reply) => {
    if (!existsSync(join(reviewRoomDist, "index.html"))) {
      return reply
        .code(503)
        .send("Review Room UI not built. Run: npm run build -w @oryntra/review-room");
    }
    return reply.sendFile("index.html");
  });

  app.register(async (scoped) => {
    scoped.get(
      "/api/sessions/:id/ws",
      { websocket: true },
      async (socket, req) => {
        const sessionId = (req.params as { id: string }).id;
        const client = {
          send: (data: string) => socket.send(data),
        };

        try {
          await manager.registerClient(sessionId, client);
        } catch {
          socket.close();
          return;
        }

        socket.on("message", (raw) => {
          try {
            const message = JSON.parse(String(raw)) as { type?: string };
            if (message.type === "ping") {
              socket.send(JSON.stringify({ type: "pong" }));
            }
          } catch {
            // ignore malformed messages
          }
        });

        socket.on("close", () => {
          manager.unregisterClient(sessionId, client);
        });
      },
    );
  });

  return { app, host, port, manager };
}
