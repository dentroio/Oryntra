import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  createBrowserCapture,
  type BridgeEventPayload,
  type BrowserCapture,
} from "@oryntra/browser-service";
import {
  createId,
  loadOryntraConfig,
  type AgentThread,
  type BrowserEvent,
  type ChatMessage,
  type CreateSessionRequest,
  type CreateSessionResponse,
  type FeedbackMoment,
  type OryntraConfig,
  type ReviewArtifact,
  type ReviewMode,
  type ReviewSession,
  type ServerMessage,
  type SubmitFeedbackRequest,
  type ArtifactStatus,
  type DocUpdate,
  type ExecutionPlan,
  type HandoffPackage,
  type SubmitFeedbackResponse,
  type SubmitIdeAgentResponseRequest,
  type IdeProvider,
  type WorkOrder,
  type CaptureMode,
  type WorktreeStatus,
  type ChangeRequest,
  type SnapPreviewResponse,
  type ProposedPatch,
  type PatchResult,
  getIdeLabel,
  parseIdeProvider,
} from "@oryntra/core";
import {
  createFacilitator,
  InstantReviewFacilitator,
  type ReviewFacilitator,
} from "@oryntra/facilitator";
import {
  applyDocUpdate,
  applyPatch,
  buildExecutionPlan,
  createSessionWorktree,
  getCurrentBranch,
  getGitRoot,
  getWorktreeStatus,
  isGitRepository,
  proposePatch,
} from "@oryntra/workspace";
import {
  archiveAgentThreadHistory,
  createAgentThreadRecord,
  deriveAgentThreadTitle,
  filterMessagesForThread,
} from "./agent-threads.js";
import { clearIdePendingFile, writeIdePendingFile } from "./ide-pending.js";
import {
  artifactsFromCursorPayload,
  normalizeIdeAgentReply,
} from "./ide-response-parse.js";
import {
  buildResumeCommand,
  buildReviewFacilitatorPrompt,
  ensureCursorAgentSession,
  readCursorAgentSession,
  runCursorAgentPrompt,
  spawnCursorImplementAgent,
  spawnInteractiveCursorAgent,
  syncChatToCursorAgent,
} from "./cursor-agent.js";
import { SessionStore } from "./store.js";
import { applyApprovedWorkspaceChanges } from "./workspace-apply.js";
import {
  formatReviewHistoryMarkdown,
  readImplementActivityLog,
} from "./review-history.js";
import { IdeRegistry } from "./ide-registry.js";
import {
  buildIdeFeedbackHint,
  buildIdeHandoffHint,
  buildImplementPrompt,
  isTargetConnected,
  resolveTargetIde,
} from "./ide-handoff.js";

type WsClient = {
  send: (data: string) => void;
};

export type SessionManagerOptions = {
  host: string;
  port: number;
  store: SessionStore;
  ideRegistry?: IdeRegistry;
};

type RuntimeSession = {
  session: ReviewSession;
  config: OryntraConfig;
  browser: BrowserCapture;
  clients: Set<WsClient>;
};

export class SessionManager {
  private readonly sessions = new Map<string, RuntimeSession>();
  private facilitator: ReviewFacilitator = createFacilitator(undefined, {
    cursorAgent: runCursorAgentPrompt,
    buildReviewPrompt: buildReviewFacilitatorPrompt,
  });
  private readonly host: string;
  private readonly port: number;
  private readonly store: SessionStore;
  private readonly ideRegistry?: IdeRegistry;
  private latestSessionId: string | null = null;
  private readonly ideFallbackTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly IDE_FALLBACK_MS = 12_000;

  constructor(options: SessionManagerOptions) {
    this.host = options.host;
    this.port = options.port;
    this.store = options.store;
    this.ideRegistry = options.ideRegistry;
    const latest = this.store.getLatestSession();
    if (latest && latest.status !== "closed" && latest.status !== "failed") {
      this.latestSessionId = latest.id;
    }
  }

  async createSession(
    request: CreateSessionRequest,
  ): Promise<CreateSessionResponse> {
    const config = await loadOryntraConfig(request.workspacePath);
    this.facilitator = this.createFacilitator(config);
    const sessionId = createId("sess");
    const now = new Date().toISOString();
    let branchName = "main";
    if (await isGitRepository(request.workspacePath)) {
      try {
        branchName = await getCurrentBranch(request.workspacePath);
      } catch {
        branchName = "main";
      }
    }

    const captureMode: CaptureMode =
      request.captureMode ?? config.browser?.mode ?? "embedded";

    const preferredIde =
      request.preferredIde ??
      request.ide ??
      parseIdeProvider(config.ide?.preferred) ??
      "cursor";

    const session: ReviewSession = {
      id: sessionId,
      workspacePath: request.workspacePath,
      repoName: basename(request.workspacePath),
      branchName,
      appUrl: request.appUrl || config.app.url,
      devServerCommand: request.devCommand || config.app.devCommand,
      status: "starting",
      ide: preferredIde,
      preferredIde,
      reviewMode: "normal",
      captureMode,
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveSession(session);

    try {
      await this.startRuntime(session, config);
      session.status = "active";
      session.updatedAt = new Date().toISOString();
      this.store.saveSession(session);
      this.broadcast(sessionId, {
        type: "session_status",
        status: session.status,
        reviewMode: session.reviewMode,
      });
    } catch (error) {
      session.status = "failed";
      session.errorMessage =
        error instanceof Error ? error.message : "Failed to start browser";
      session.updatedAt = new Date().toISOString();
      this.store.saveSession(session);
      this.sessions.delete(sessionId);
      throw error;
    }

    void this.bootstrapTargetIde(sessionId, config);

    return {
      sessionId,
      reviewRoomUrl: `http://${this.host}:${this.port}/session/${sessionId}`,
      branch: session.branchName,
      status: session.status,
    };
  }

  getSession(sessionId: string): ReviewSession | null {
    return (
      this.sessions.get(sessionId)?.session ??
      this.store.getSession(sessionId)
    );
  }

  async getSessionDetail(sessionId: string): Promise<ReviewSession | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const runtime = this.sessions.get(sessionId);
    let facilitatorProvider = "instant";
    if (runtime?.config) {
      facilitatorProvider =
        process.env.ORYNTRA_FACILITATOR ??
        runtime.config.agent?.facilitatorProvider ??
        "instant";
    } else {
      try {
        const config = await loadOryntraConfig(session.workspacePath);
        facilitatorProvider =
          process.env.ORYNTRA_FACILITATOR ??
          config.agent?.facilitatorProvider ??
          "instant";
      } catch {
        // keep default
      }
    }
    return { ...session, facilitatorProvider };
  }

  async setPreferredIde(
    sessionId: string,
    preferredIde: IdeProvider,
  ): Promise<ReviewSession> {
    const runtime = await this.ensureRuntime(sessionId);
    runtime.session.preferredIde = preferredIde;
    runtime.session.ide = preferredIde;
    runtime.session.updatedAt = new Date().toISOString();
    this.store.saveSession(runtime.session);
    return runtime.session;
  }

  async getIdeTarget(sessionId: string): Promise<{
    preferredIde: IdeProvider;
    label: string;
    connected: boolean;
  }> {
    const runtime = await this.ensureRuntime(sessionId);
    const preferredIde = resolveTargetIde(runtime.session, runtime.config);
    return {
      preferredIde,
      label: getIdeLabel(preferredIde),
      connected: isTargetConnected(
        this.ideRegistry,
        runtime.session.workspacePath,
        preferredIde,
      ),
    };
  }

  async captureSnap(sessionId: string): Promise<SnapPreviewResponse> {
    const runtime = await this.ensureRuntime(sessionId);
    const { browser, config } = runtime;
    const spatial = await browser.captureSpatialContext();
    const screenshotId = createId("shot");
    const snapshotId = createId("snap");

    let capturedScreenshotId: string | undefined;
    let capturedSnapshotId: string | undefined;

    if (config.review?.captureScreenshot !== false) {
      try {
        await browser.captureScreenshot(screenshotId);
        capturedScreenshotId = screenshotId;
      } catch {
        // optional
      }
    }
    if (config.review?.captureAccessibilitySnapshot !== false) {
      try {
        await browser.captureAccessibilitySnapshot(snapshotId);
        capturedSnapshotId = snapshotId;
      } catch {
        // optional
      }
    }

    return {
      screenshotId: capturedScreenshotId,
      accessibilitySnapshotId: capturedSnapshotId,
      spatial,
      previewUrl: capturedScreenshotId
        ? `/api/sessions/${sessionId}/screenshots/${capturedScreenshotId}`
        : undefined,
    };
  }

  async proposePatchForArtifact(
    sessionId: string,
    artifactId: string,
  ): Promise<ProposedPatch> {
    const session = await this.ensureWorktree(sessionId);
    const artifact = this.listArtifacts(sessionId).find((a) => a.id === artifactId);
    if (!artifact || artifact.kind !== "change_request") {
      throw new Error("Approved change_request artifact required");
    }
    return proposePatch(artifact as ChangeRequest, session.worktreePath!);
  }

  async applyApprovedPatch(
    sessionId: string,
    patch: ProposedPatch,
  ): Promise<PatchResult> {
    const session = await this.ensureWorktree(sessionId);
    return applyPatch(session.worktreePath!, patch);
  }

  async ingestBridgeEvent(
    sessionId: string,
    payload: BridgeEventPayload,
  ): Promise<void> {
    const runtime = await this.ensureRuntime(sessionId);
    runtime.browser.ingestBridgeEvent?.(payload);
    if (payload.type !== "mouse_sample" && payload.type !== "viewport") {
      void this.publishBrowserState(sessionId);
    }
  }

  getPendingBridgeCapture(sessionId: string): {
    screenshotId?: string;
    snapshotId?: string;
  } {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return {};
    return runtime.browser.getPendingCapture?.() ?? {};
  }

  async fulfillBridgeCapture(
    sessionId: string,
    upload: {
      screenshotId?: string;
      pngBase64?: string;
      snapshotId?: string;
      snapshotText?: string;
    },
  ): Promise<boolean> {
    const runtime = await this.ensureRuntime(sessionId);
    return (await runtime.browser.fulfillBridgeCapture?.(upload)) ?? false;
  }

  async getBrowserState(sessionId: string) {
    const runtime = await this.ensureRuntime(sessionId);
    return runtime.browser.getBrowserState();
  }

  async setReviewMode(sessionId: string, mode: ReviewMode): Promise<ReviewSession> {
    const runtime = await this.ensureRuntime(sessionId);
    runtime.browser.setReviewMode(mode);
    runtime.session.reviewMode = mode;
    runtime.session.updatedAt = new Date().toISOString();
    this.store.saveSession(runtime.session);
    this.broadcast(sessionId, {
      type: "session_status",
      status: runtime.session.status,
      reviewMode: mode,
    });
    return runtime.session;
  }

  async submitFeedback(
    sessionId: string,
    request: SubmitFeedbackRequest,
  ): Promise<SubmitFeedbackResponse> {
    const runtime = await this.ensureRuntime(sessionId);
    const { session, config, browser } = runtime;
    const modality = request.modality ?? "typed";
    const reviewMode = request.reviewMode ?? session.reviewMode;
    const transcript = request.transcript.trim();

    const targetIde = resolveTargetIde(session, config);

    if (/^(process\s+(my\s+)?(latest\s+)?oryntra|handoff(\s+to\s+ide)?)/i.test(transcript)) {
      const agentMessage: ChatMessage = {
        id: createId("chat"),
        sessionId,
        role: "agent",
        content: buildIdeFeedbackHint(targetIde),
        timestamp: new Date().toISOString(),
      };
      const savedAgent = this.persistChatMessage(agentMessage);
      this.broadcast(sessionId, { type: "chat_message", message: savedAgent });
      return {
        feedbackMoment: {
          id: createId("fm"),
          sessionId,
          timestamp: new Date().toISOString(),
          modality,
          transcript,
          spatial: await browser.captureSpatialContext(),
          recentEventIds: [],
        },
        facilitatorResponse: {
          interpretation: "unclear",
          summary: agentMessage.content,
          delegatedToIde: false,
        },
        chatMessages: [agentMessage],
      };
    }

    const spatial = await browser.captureSpatialContext();
    const momentId = createId("fm");
    const screenshotId = createId("shot");
    const snapshotId = createId("snap");

    let capturedScreenshotId: string | undefined = request.screenshotId;
    let capturedSnapshotId: string | undefined =
      request.accessibilitySnapshotId;

    if (!capturedScreenshotId && config.review?.captureScreenshot !== false) {
      try {
        await browser.captureScreenshot(screenshotId);
        capturedScreenshotId = screenshotId;
      } catch {
        // Bridge capture may time out if iframe bridge is disconnected
      }
    }
    if (!capturedSnapshotId && config.review?.captureAccessibilitySnapshot !== false) {
      try {
        await browser.captureAccessibilitySnapshot(snapshotId);
        capturedSnapshotId = snapshotId;
      } catch {
        // Bridge snapshot optional when iframe bridge unavailable
      }
    }

    const recentEvents = this.store.recentBrowserEvents(
      sessionId,
      config.review?.recentEventWindowSeconds ?? 60,
      config.review?.recentEventMaxCount ?? 5,
    );

    let moment: FeedbackMoment = {
      id: momentId,
      sessionId,
      timestamp: new Date().toISOString(),
      modality,
      transcript,
      spatial,
      screenshotId: capturedScreenshotId,
      accessibilitySnapshotId: capturedSnapshotId,
      recentEventIds: recentEvents.map((e) => e.id),
    };
    this.store.saveFeedbackMoment(moment);
    this.broadcast(sessionId, { type: "feedback_moment", moment });

    const userMessage: ChatMessage = {
      id: createId("chat"),
      sessionId,
      role: "user",
      content: transcript,
      feedbackMomentId: momentId,
      timestamp: new Date().toISOString(),
    };
    const savedUser = this.persistChatMessage(userMessage);
    this.broadcast(sessionId, { type: "chat_message", message: savedUser });

    const chatHistory = this.listChatMessages(sessionId)
      .filter((m) => m.id !== userMessage.id)
      .slice(-30);
    const cursorChatId = await this.resolveCursorChatId(sessionId, config);
    const facilitatorResponse = await this.facilitator.processFeedback({
      moment,
      transcript,
      session,
      chatHistory,
      artifacts: this.listArtifacts(sessionId),
      cursorChatId,
      reviewRoomUrl: this.reviewRoomUrl(sessionId),
    });

    if (facilitatorResponse.delegatedToIde) {
      moment = { ...moment, ideStatus: "pending" };
      this.store.saveFeedbackMoment(moment);
      this.broadcast(sessionId, { type: "feedback_moment", moment });
      void writeIdePendingFile(session.workspacePath, {
        sessionId,
        feedbackMomentId: momentId,
        transcript,
        createdAt: moment.timestamp,
        reviewRoomUrl: this.reviewRoomUrl(sessionId),
        targetIde,
      }).catch(() => undefined);
      this.scheduleIdeFacilitatorFallback(sessionId, momentId, {
        moment,
        transcript,
        session,
        chatHistory,
        artifacts: this.listArtifacts(sessionId),
      });
    } else if (facilitatorResponse.suggestedArtifacts?.length) {
      moment = { ...moment, ideStatus: "processed" };
      this.store.saveFeedbackMoment(moment);
      this.broadcast(sessionId, { type: "feedback_moment", moment });
    }

    const proposalArtifact = facilitatorResponse.suggestedArtifacts?.find(
      (a) => a.kind === "change_request" && a.status === "draft",
    );

    const chatMessages: ChatMessage[] = [savedUser];
    if (!facilitatorResponse.skipAgentReply) {
      const agentMessage: ChatMessage = {
        id: createId("chat"),
        sessionId,
        role: "agent",
        content: facilitatorResponse.clarifyingQuestion
          ? `${facilitatorResponse.summary}\n\n${facilitatorResponse.clarifyingQuestion}`
          : facilitatorResponse.summary,
        feedbackMomentId: momentId,
        artifactId: proposalArtifact?.id,
        timestamp: new Date().toISOString(),
      };
      const savedAgent = this.persistChatMessage(agentMessage);
      this.broadcast(sessionId, { type: "chat_message", message: savedAgent });
      chatMessages.push(savedAgent);
    }

    if (
      !facilitatorResponse.delegatedToIde &&
      facilitatorResponse.suggestedArtifacts
    ) {
      for (const artifact of facilitatorResponse.suggestedArtifacts) {
        const enriched = this.attachEvidence(artifact, recentEvents);
        this.store.saveArtifact(enriched);
        this.broadcast(sessionId, { type: "artifact", artifact: enriched });
      }
    }

    session.status = "reviewing";
    session.reviewMode = reviewMode;
    session.updatedAt = new Date().toISOString();
    this.store.saveSession(session);

    void this.syncReviewHistory(sessionId);

    return {
      feedbackMoment: moment,
      facilitatorResponse,
      chatMessages,
    };
  }

  listArtifacts(sessionId: string): ReviewArtifact[] {
    return this.store.listArtifacts(sessionId);
  }

  saveArtifact(artifact: ReviewArtifact): ReviewArtifact {
    this.store.saveArtifact(artifact);
    this.broadcast(artifact.sessionId, { type: "artifact", artifact });
    return artifact;
  }

  async updateArtifactStatus(
    sessionId: string,
    artifactId: string,
    status: ArtifactStatus,
    options?: { cursorAgent?: "continue" | "new" },
  ): Promise<{
    artifact: ReviewArtifact;
    autoImplement?: { started: boolean; reason?: string };
    cursorAgent?: { cursorChatId?: string; resumeCommand?: string };
  }> {
    const runtime = await this.ensureRuntime(sessionId);
    const artifacts = this.listArtifacts(sessionId);
    const artifact = artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    const updated = { ...artifact, status } as ReviewArtifact;
    const saved = this.saveArtifact(updated);

    if (status !== "approved") {
      return { artifact: saved };
    }

    if (
      runtime.config.agent?.cursorAgent !== false &&
      options?.cursorAgent === "new"
    ) {
      await this.ensureCursorAgent(sessionId, { forceNew: true });
    }

    const autoImplement = await this.maybeAutoImplement(
      sessionId,
      runtime.config,
      options,
    );
    await this.syncReviewHistory(sessionId, { forceFull: true });
    const cursor = await this.getCursorAgentInfo(sessionId);
    return { artifact: saved, autoImplement, cursorAgent: cursor ?? undefined };
  }

  private async maybeAutoImplement(
    sessionId: string,
    config: OryntraConfig,
    approveOptions?: { cursorAgent?: "continue" | "new" },
  ): Promise<{ started: boolean; reason?: string } | undefined> {
    if (config.agent?.autoImplementOnApprove === false) {
      return undefined;
    }

    const approved = this.listArtifacts(sessionId).filter(
      (a) => a.status === "approved",
    );
    if (approved.length === 0) {
      return undefined;
    }

    try {
      const runtime = await this.ensureRuntime(sessionId);
      const session = runtime.session;
      const targetIde = resolveTargetIde(session, config);
      const targetLabel = getIdeLabel(targetIde);
      const targetConnected = isTargetConnected(
        this.ideRegistry,
        session.workspacePath,
        targetIde,
      );
      const implementInWorkspace =
        config.agent?.implementInWorkspace !== false &&
        session.captureMode === "embedded";

      const change = approved.find((a) => a.kind === "change_request");
      const changeTitle =
        change && change.kind === "change_request" ? change.title : "your change";

      const agentRecord = await readCursorAgentSession(session.workspacePath);
      const useNewChat = approveOptions?.cursorAgent === "new";

      if (implementInWorkspace) {
        await this.appendImplementActivity(
          sessionId,
          `Applying: ${changeTitle}`,
        );
        const applied = await this.finishDirectImplementation(
          sessionId,
          session.workspacePath,
          approved,
          { emitFailure: config.agent?.cursorAgent === false },
        );
        if (applied) {
          if (config.agent?.cursorAgent !== false) {
            void this.syncReviewHistory(sessionId, { forceFull: true });
          }
          return { started: true };
        }
        if (config.agent?.cursorAgent === false) {
          return { started: false, reason: "No built-in demo fix matched" };
        }
        await this.appendImplementActivity(
          sessionId,
          `No built-in demo fix — handing off to ${targetLabel}…`,
        );
      }

      const { implementRequestPath, implementPrompt, handoff } =
        await this.requestImplementation(sessionId);
      const handoffSession = handoff.session;
      let repoRoot = handoffSession.workspacePath;
      if (await isGitRepository(handoffSession.workspacePath)) {
        repoRoot = await getGitRoot(handoffSession.workspacePath);
      }

      if (targetIde === "cursor" && config.agent?.cursorAgent !== false) {
        const spawned = await spawnCursorImplementAgent({
          workspacePath: repoRoot,
          prompt: implementPrompt,
          implementRequestPath,
          cursorChatId: useNewChat ? undefined : agentRecord?.cursorChatId,
          forceNewChat: useNewChat,
        });

        const content = spawned.started
          ? session.captureMode === "extension"
            ? `Approved — Cursor is implementing in the worktree (${handoffSession.worktreePath ?? repoRoot}).`
            : "Approved — Cursor is implementing (embedded demo applies changes automatically)."
          : `Approved. ${spawned.reason ?? `Could not start ${targetLabel} agent`} — check .oryntra/review-history.md.`;

        const agentMessage: ChatMessage = {
          id: createId("chat"),
          sessionId,
          role: "agent",
          content,
          timestamp: new Date().toISOString(),
        };
        const savedImplement = this.persistChatMessage(agentMessage);
        this.broadcast(sessionId, {
          type: "chat_message",
          message: savedImplement,
        });

        if (spawned.started) {
          void this.watchImplementCompletion(sessionId, implementRequestPath);
        }

        return spawned;
      }

      const content = buildIdeHandoffHint(targetIde, targetConnected);
      const agentMessage: ChatMessage = {
        id: createId("chat"),
        sessionId,
        role: "agent",
        content,
        timestamp: new Date().toISOString(),
      };
      const savedImplement = this.persistChatMessage(agentMessage);
      this.broadcast(sessionId, {
        type: "chat_message",
        message: savedImplement,
      });
      void this.watchImplementCompletion(sessionId, implementRequestPath);
      return {
        started: true,
        reason: targetConnected ? undefined : `${targetLabel} MCP not connected`,
      };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Auto-implement failed";
      const runtime = await this.ensureRuntime(sessionId);
      const targetLabel = getIdeLabel(
        resolveTargetIde(runtime.session, runtime.config),
      );
      const agentMessage: ChatMessage = {
        id: createId("chat"),
        sessionId,
        role: "agent",
        content: `Approved. Could not auto-start ${targetLabel} (${reason}). Read .oryntra/implement-request.json in your IDE.`,
        timestamp: new Date().toISOString(),
      };
      const savedFail = this.persistChatMessage(agentMessage);
      this.broadcast(sessionId, { type: "chat_message", message: savedFail });
      return { started: false, reason };
    }
  }

  listFeedbackMoments(sessionId: string): FeedbackMoment[] {
    return this.store.listFeedbackMoments(sessionId);
  }

  listPendingFeedbackMoments(sessionId: string): FeedbackMoment[] {
    return this.listFeedbackMoments(sessionId).filter(
      (m) => m.ideStatus === "pending",
    );
  }

  submitIdeAgentResponse(
    sessionId: string,
    request: SubmitIdeAgentResponseRequest,
  ): { moment: FeedbackMoment; chatMessage: ChatMessage; artifacts: ReviewArtifact[] } {
    const moments = this.listFeedbackMoments(sessionId);
    const moment = moments.find((m) => m.id === request.feedbackMomentId);
    if (!moment) {
      throw new Error(`Feedback moment not found: ${request.feedbackMomentId}`);
    }

    this.cancelIdeFacilitatorFallback(sessionId, moment.id);

    const recentEvents = this.store.recentBrowserEvents(sessionId, 60, 5);
    const rawReply = request.chatMessage ?? request.summary;
    const parsedReply = normalizeIdeAgentReply(rawReply);

    const artifacts: ReviewArtifact[] = [];
    if (request.artifacts?.length) {
      for (const raw of request.artifacts) {
        const artifact = this.normalizeArtifact(raw, sessionId, moment.id);
        const enriched = this.attachEvidence(artifact, recentEvents);
        this.store.saveArtifact(enriched);
        this.broadcast(sessionId, { type: "artifact", artifact: enriched });
        artifacts.push(enriched);
      }
    } else if (parsedReply.payload) {
      const drafted = artifactsFromCursorPayload({
        payload: parsedReply.payload,
        sessionId,
        momentId: moment.id,
        transcript: moment.transcript ?? "",
        route: moment.spatial.route,
      });
      for (const artifact of drafted) {
        const enriched = this.attachEvidence(artifact, recentEvents);
        this.store.saveArtifact(enriched);
        this.broadcast(sessionId, { type: "artifact", artifact: enriched });
        artifacts.push(enriched);
      }
    }

    const updatedMoment: FeedbackMoment = {
      ...moment,
      ideStatus: "processed",
      linkedArtifactIds: artifacts.map((a) => a.id),
    };
    this.store.saveFeedbackMoment(updatedMoment);
    this.broadcast(sessionId, { type: "feedback_moment", moment: updatedMoment });

    const chatMessage: ChatMessage = {
      id: createId("chat"),
      sessionId,
      role: "agent",
      content: parsedReply.summary,
      feedbackMomentId: moment.id,
      artifactId: artifacts.find((a) => a.kind === "change_request")?.id,
      timestamp: new Date().toISOString(),
    };
    const savedReply = this.persistChatMessage(chatMessage);
    this.broadcast(sessionId, { type: "chat_message", message: savedReply });

    const session = this.getSession(sessionId);
    if (session) {
      void clearIdePendingFile(session.workspacePath, moment.id).catch(
        () => undefined,
      );
      void this.syncReviewHistory(sessionId);
    }

    return { moment: updatedMoment, chatMessage, artifacts };
  }

  listBrowserEvents(sessionId: string): BrowserEvent[] {
    return this.store.listBrowserEvents(sessionId);
  }

  listChatMessages(sessionId: string, threadId?: string): ChatMessage[] {
    this.ensureAgentThreads(sessionId);
    const threads = this.store.listAgentThreads(sessionId);
    const active = threads.find((t) => t.status === "active");
    const defaultThreadId = threads[0]?.id;
    const targetId = threadId ?? active?.id ?? defaultThreadId;
    if (!targetId) {
      return this.store.listChatMessages(sessionId);
    }
    return filterMessagesForThread(
      this.store.listChatMessages(sessionId),
      targetId,
      defaultThreadId,
    );
  }

  listAgentThreads(sessionId: string): AgentThread[] {
    this.ensureAgentThreads(sessionId);
    return this.store.listAgentThreads(sessionId);
  }

  getActiveAgentThread(sessionId: string): AgentThread {
    return this.ensureAgentThreads(sessionId);
  }

  async createNewAgentThread(sessionId: string): Promise<{
    activeThread: AgentThread;
    threads: AgentThread[];
  }> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const threads = this.store.listAgentThreads(sessionId);
    const active = threads.find((t) => t.status === "active");
    const now = new Date().toISOString();

    if (active) {
      const msgs = filterMessagesForThread(
        this.store.listChatMessages(sessionId),
        active.id,
        threads[0]?.id,
      );
      const titled =
        active.title === "New agent" && msgs.length > 0
          ? { ...active, title: deriveAgentThreadTitle(msgs) }
          : active;
      const archived: AgentThread = {
        ...titled,
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      };
      this.store.saveAgentThread(archived);
      void archiveAgentThreadHistory({
        workspacePath: session.workspacePath,
        thread: archived,
        messages: msgs,
      }).catch(() => undefined);
    }

    const cursor = await this.ensureCursorAgent(sessionId, { forceNew: true });
    const newThread = createAgentThreadRecord({
      sessionId,
      title: "New agent",
      status: "active",
      cursorChatId: cursor?.cursorChatId,
    });
    this.store.saveAgentThread(newThread);

    const all = this.store.listAgentThreads(sessionId);
    this.broadcast(sessionId, {
      type: "agent_thread_changed",
      activeThread: newThread,
      threads: all,
    });
    return { activeThread: newThread, threads: all };
  }

  async activateAgentThread(
    sessionId: string,
    threadId: string,
  ): Promise<{ activeThread: AgentThread; threads: AgentThread[] }> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const target = this.store.getAgentThread(sessionId, threadId);
    if (!target) throw new Error(`Agent thread not found: ${threadId}`);

    const threads = this.store.listAgentThreads(sessionId);
    const now = new Date().toISOString();

    for (const thread of threads) {
      if (thread.status === "active" && thread.id !== threadId) {
        const msgs = filterMessagesForThread(
          this.store.listChatMessages(sessionId),
          thread.id,
          threads[0]?.id,
        );
        const archived: AgentThread = {
          ...thread,
          status: "archived",
          archivedAt: now,
          updatedAt: now,
        };
        this.store.saveAgentThread(archived);
        void archiveAgentThreadHistory({
          workspacePath: session.workspacePath,
          thread: archived,
          messages: msgs,
        }).catch(() => undefined);
      }
    }

    const resumed: AgentThread = {
      ...target,
      status: "active",
      archivedAt: undefined,
      updatedAt: now,
    };
    this.store.saveAgentThread(resumed);

    if (resumed.cursorChatId) {
      await this.ensureCursorAgent(sessionId, {
        cursorChatId: resumed.cursorChatId,
      });
    }

    const all = this.store.listAgentThreads(sessionId);
    this.broadcast(sessionId, {
      type: "agent_thread_changed",
      activeThread: resumed,
      threads: all,
    });
    return { activeThread: resumed, threads: all };
  }

  private ensureAgentThreads(sessionId: string): AgentThread {
    const existing = this.store.listAgentThreads(sessionId);
    const active = existing.find((t) => t.status === "active");
    if (active) return active;

    if (existing.length > 0) {
      const latest = existing[existing.length - 1]!;
      const resumed: AgentThread = {
        ...latest,
        status: "active",
        archivedAt: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.store.saveAgentThread(resumed);
      return resumed;
    }

    const messages = this.store.listChatMessages(sessionId);
    const thread = createAgentThreadRecord({
      sessionId,
      title: deriveAgentThreadTitle(messages) || "Review agent",
      status: "active",
    });
    this.store.saveAgentThread(thread);
    return thread;
  }

  private getActiveAgentThreadId(sessionId: string): string {
    return this.ensureAgentThreads(sessionId).id;
  }

  private persistChatMessage(message: ChatMessage): ChatMessage {
    const threadId = this.getActiveAgentThreadId(message.sessionId);
    const enriched: ChatMessage = {
      ...message,
      agentThreadId: message.agentThreadId ?? threadId,
    };
    this.store.saveChatMessage(enriched);
    return enriched;
  }

  private reviewRoomUrl(sessionId: string): string {
    return `http://${this.host}:${this.port}/session/${sessionId}`;
  }

  private ideFallbackKey(sessionId: string, momentId: string): string {
    return `${sessionId}:${momentId}`;
  }

  private scheduleIdeFacilitatorFallback(
    sessionId: string,
    momentId: string,
    input: {
      moment: FeedbackMoment;
      transcript: string;
      session: ReviewSession;
      chatHistory: ChatMessage[];
      artifacts: ReviewArtifact[];
    },
  ): void {
    const key = this.ideFallbackKey(sessionId, momentId);
    const existing = this.ideFallbackTimers.get(key);
    if (existing) clearTimeout(existing);

    const timeout = setTimeout(() => {
      void this.tryIdeFacilitatorFallback(sessionId, momentId, input);
    }, SessionManager.IDE_FALLBACK_MS);

    this.ideFallbackTimers.set(key, timeout);
  }

  private cancelIdeFacilitatorFallback(
    sessionId: string,
    momentId: string,
  ): void {
    const key = this.ideFallbackKey(sessionId, momentId);
    const existing = this.ideFallbackTimers.get(key);
    if (existing) clearTimeout(existing);
    this.ideFallbackTimers.delete(key);
  }

  private async tryIdeFacilitatorFallback(
    sessionId: string,
    momentId: string,
    input: {
      moment: FeedbackMoment;
      transcript: string;
      session: ReviewSession;
      chatHistory: ChatMessage[];
      artifacts: ReviewArtifact[];
    },
  ): Promise<void> {
    this.ideFallbackTimers.delete(this.ideFallbackKey(sessionId, momentId));

    const moment = this.listFeedbackMoments(sessionId).find(
      (m) => m.id === momentId,
    );
    if (!moment || moment.ideStatus !== "pending") return;

    const instant = new InstantReviewFacilitator();

    try {
      const response = await instant.processFeedback({
        moment,
        transcript: input.transcript,
        session: input.session,
        chatHistory: input.chatHistory,
        artifacts: input.artifacts,
        reviewRoomUrl: this.reviewRoomUrl(sessionId),
      });

      this.submitIdeAgentResponse(sessionId, {
        feedbackMomentId: momentId,
        summary: response.summary,
        chatMessage: response.summary,
        artifacts: response.suggestedArtifacts,
      });
    } catch {
      // leave pending — UI timeout will surface a hint
    }
  }

  private createFacilitator(config?: OryntraConfig): ReviewFacilitator {
    return createFacilitator(config, {
      cursorAgent: runCursorAgentPrompt,
      buildReviewPrompt: buildReviewFacilitatorPrompt,
    });
  }

  private usesCursorFacilitator(config: OryntraConfig): boolean {
    const provider =
      process.env.ORYNTRA_FACILITATOR ??
      config.agent?.facilitatorProvider ??
      "instant";
    return provider === "cursor" && config.agent?.cursorAgent !== false;
  }

  private async resolveCursorChatId(
    sessionId: string,
    config: OryntraConfig,
  ): Promise<string | undefined> {
    if (!this.usesCursorFacilitator(config)) return undefined;

    const session = this.getSession(sessionId);
    if (!session) return undefined;

    const existing = await readCursorAgentSession(session.workspacePath);
    if (existing?.cursorChatId) return existing.cursorChatId;

    const ensured = await ensureCursorAgentSession({
      session,
      reviewRoomUrl: this.reviewRoomUrl(sessionId),
    });
    return ensured?.cursorChatId;
  }

  private async bootstrapTargetIde(
    sessionId: string,
    config: OryntraConfig,
  ): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) return;
    if (resolveTargetIde(session, config) !== "cursor") return;
    await this.bootstrapCursorAgent(sessionId, config);
  }

  private async bootstrapCursorAgent(
    sessionId: string,
    config: OryntraConfig,
  ): Promise<void> {
    if (config.agent?.cursorAgent === false) return;
    try {
      await this.ensureCursorAgent(sessionId);
      await this.syncReviewHistory(sessionId, { forceFull: true });
    } catch {
      // best-effort
    }
  }

  async ensureCursorAgent(
    sessionId: string,
    options?: {
      forceNew?: boolean;
      spawnInteractive?: boolean;
      cursorChatId?: string;
    },
  ): Promise<{
    cursorChatId: string;
    resumeCommand: string;
    created: boolean;
  } | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;

    const config = await loadOryntraConfig(session.workspacePath);
    if (config.agent?.cursorAgent === false) return null;

    const ensured = await ensureCursorAgentSession({
      session,
      reviewRoomUrl: this.reviewRoomUrl(sessionId),
      forceNew: options?.forceNew,
      cursorChatId: options?.cursorChatId,
    });
    if (!ensured) return null;

    await this.syncReviewHistory(sessionId, { forceFull: true });

    if (options?.spawnInteractive) {
      spawnInteractiveCursorAgent({
        workspacePath: session.workspacePath,
        cursorChatId: ensured.cursorChatId,
        prompt: ensured.created
          ? "You are the Oryntra review agent for this workspace. Review Studio chat will mirror here — acknowledge briefly."
          : undefined,
      });
    }

    return {
      cursorChatId: ensured.cursorChatId,
      resumeCommand: ensured.resumeCommand,
      created: ensured.created,
    };
  }

  async getCursorAgentInfo(sessionId: string): Promise<{
    cursorChatId: string;
    resumeCommand: string;
  } | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const record = await readCursorAgentSession(session.workspacePath);
    if (!record) return null;
    return {
      cursorChatId: record.cursorChatId,
      resumeCommand: buildResumeCommand({
        workspacePath: session.workspacePath,
        cursorChatId: record.cursorChatId,
        interactive: true,
      }),
    };
  }

  private workspaceReviewData(session: ReviewSession): {
    chat: ChatMessage[];
    artifacts: ReviewArtifact[];
  } {
    return {
      chat: this.store.listChatMessagesForWorkspace(session.workspacePath),
      artifacts: this.store.listArtifactsForWorkspace(session.workspacePath),
    };
  }

  private async syncReviewHistory(
    sessionId: string,
    options?: { forceFull?: boolean },
  ): Promise<string | undefined> {
    const session = this.getSession(sessionId);
    if (!session) return undefined;
    try {
      const { chat, artifacts } = this.workspaceReviewData(session);
      const implementSteps = await readImplementActivityLog(
        session.workspacePath,
      );
      const markdown = formatReviewHistoryMarkdown({
        session,
        reviewRoomUrl: this.reviewRoomUrl(sessionId),
        chat,
        artifacts,
        implementSteps,
        workspaceScoped: true,
      });
      const path = join(session.workspacePath, ".oryntra", "review-history.md");
      await mkdir(join(session.workspacePath, ".oryntra"), { recursive: true });
      await writeFile(path, markdown, "utf8");

      const runtime = this.sessions.get(sessionId);
      if (
        runtime &&
        resolveTargetIde(runtime.session, runtime.config) === "cursor" &&
        runtime.config.agent?.cursorAgent !== false
      ) {
        void syncChatToCursorAgent({
          session,
          reviewRoomUrl: this.reviewRoomUrl(sessionId),
          chat,
          artifacts,
          forceFull: options?.forceFull,
        });
      }

      return path;
    } catch {
      return undefined;
    }
  }

  async getReviewHistory(sessionId: string): Promise<{
    path: string;
    markdown: string;
    reviewRoomUrl: string;
  } | null> {
    const session = this.getSession(sessionId);
    if (!session) return null;
    const path = await this.syncReviewHistory(sessionId);
    if (!path) return null;
    const { chat, artifacts } = this.workspaceReviewData(session);
    const implementSteps = await readImplementActivityLog(session.workspacePath);
    const markdown = formatReviewHistoryMarkdown({
      session,
      reviewRoomUrl: this.reviewRoomUrl(sessionId),
      chat,
      artifacts,
      implementSteps,
      workspaceScoped: true,
    });
    return {
      path,
      markdown,
      reviewRoomUrl: this.reviewRoomUrl(sessionId),
    };
  }

  getActiveSession(): ReviewSession | null {
    if (this.latestSessionId) {
      const runtime = this.sessions.get(this.latestSessionId);
      if (runtime) return runtime.session;
      const stored = this.store.getSession(this.latestSessionId);
      if (stored && stored.status !== "closed" && stored.status !== "failed") {
        return stored;
      }
    }
    return this.store.getLatestSession();
  }

  async ensureWorktree(sessionId: string): Promise<ReviewSession> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    if (session.worktreePath) return session;

    if (!(await isGitRepository(session.workspacePath))) {
      throw new Error("Workspace is not a git repository");
    }

    const worktree = await createSessionWorktree({
      workspacePath: session.workspacePath,
      sessionId,
    });

    session.worktreePath = worktree.worktreePath;
    session.branchName = worktree.branchName;
    session.updatedAt = new Date().toISOString();
    this.store.saveSession(session);
    return session;
  }

  async getWorktree(sessionId: string): Promise<WorktreeStatus | null> {
    const session = this.getSession(sessionId);
    if (!session?.worktreePath) return null;
    return getWorktreeStatus(
      session.workspacePath,
      session.worktreePath,
      session.branchName,
    );
  }

  async prepareExecution(sessionId: string): Promise<ExecutionPlan> {
    const session = await this.ensureWorktree(sessionId);
    const artifacts = this.listArtifacts(sessionId);
    const approved = artifacts.filter((a) => a.status === "approved");

    return buildExecutionPlan({
      sessionId,
      worktreePath: session.worktreePath!,
      branchName: session.branchName,
      workOrders: approved.filter((a) => a.kind === "work_order") as WorkOrder[],
      docUpdates: approved.filter((a) => a.kind === "doc_update") as DocUpdate[],
      changeRequests: approved.filter(
        (a) => a.kind === "change_request",
      ) as ChangeRequest[],
    });
  }

  async applyApprovedDocUpdates(sessionId: string): Promise<
    Array<{ artifactId: string; targetPath: string; mode: string }>
  > {
    const session = await this.ensureWorktree(sessionId);
    const artifacts = this.listArtifacts(sessionId);
    const results: Array<{ artifactId: string; targetPath: string; mode: string }> =
      [];

    for (const artifact of artifacts) {
      if (artifact.kind !== "doc_update" || artifact.status !== "approved") {
        continue;
      }
      const applied = await applyDocUpdate(session.worktreePath!, artifact);
      results.push({
        artifactId: artifact.id,
        targetPath: applied.targetPath,
        mode: applied.mode,
      });
      this.saveArtifact({ ...artifact, status: "applied" });
    }

    return results;
  }

  async requestImplementation(sessionId: string): Promise<{
    handoff: HandoffPackage;
    implementRequestPath: string;
    implementPrompt: string;
  }> {
    const runtime = await this.ensureRuntime(sessionId);
    const handoff = await this.buildHandoff(sessionId);
    const approved = handoff.artifacts.filter((a) => a.status === "approved");
    if (approved.length === 0) {
      throw new Error("Approve at least one artifact before implementing");
    }

    const session = handoff.session;
    const config = runtime.config;
    const targetIde = resolveTargetIde(session, config);
    const targetConnected = isTargetConnected(
      this.ideRegistry,
      session.workspacePath,
      targetIde,
    );
    const implementInWorkspace =
      config.agent?.implementInWorkspace !== false &&
      session.captureMode === "embedded";
    const codeRoot = implementInWorkspace
      ? session.workspacePath
      : (session.worktreePath ?? session.workspacePath);

    const dir = join(session.workspacePath, ".oryntra");
    await mkdir(dir, { recursive: true });
    const implementRequestPath = join(dir, "implement-request.json");
    const implementPrompt = buildImplementPrompt({
      codeRoot,
      implementInWorkspace,
      worktreePath: session.worktreePath,
      targetIde,
    });

    await writeFile(
      implementRequestPath,
      JSON.stringify(
        {
          sessionId,
          status: "implementing",
          targetIde,
          targetIdeLabel: getIdeLabel(targetIde),
          targetIdeConnected: targetConnected,
          implementInWorkspace,
          codeRoot,
          worktreePath: session.worktreePath,
          branchName: session.branchName,
          summary: handoff.summary,
          approvedArtifacts: approved,
          executionPlan: handoff.executionPlan,
          requestedAt: new Date().toISOString(),
          implementPrompt,
        },
        null,
        2,
      ),
      "utf8",
    );

    await this.appendImplementActivity(
      sessionId,
      `Starting implementation (${getIdeLabel(targetIde)})…`,
    );

    return { handoff, implementRequestPath, implementPrompt };
  }

  async getImplementStatus(sessionId: string): Promise<{
    status: "none" | "pending" | "implementing" | "completed" | "failed";
    message?: string;
    completedAt?: string;
    steps?: string[];
  }> {
    const session = this.getSession(sessionId);
    if (!session) return { status: "none" };

    const path = join(session.workspacePath, ".oryntra", "implement-request.json");
    if (!existsSync(path)) return { status: "none" };

    const raw = JSON.parse(await readFile(path, "utf8")) as {
      sessionId?: string;
      status?: string;
      completedAt?: string;
      error?: string;
      activityLog?: string[];
      steps?: string[];
      requestedAt?: string;
    };

    if (raw.sessionId && raw.sessionId !== sessionId) {
      return { status: "none" };
    }

    const activityLog = raw.activityLog ?? raw.steps ?? [];
    const lastStep = activityLog[activityLog.length - 1];
    const status = raw.status ?? "pending";

    if (status === "completed") {
      const runtime = this.sessions.get(sessionId);
      const captureMode =
        runtime?.session.captureMode ??
        this.getSession(sessionId)?.captureMode;
      const doneMessage =
        captureMode === "extension"
          ? "Done — changes are in the git worktree. Merge or checkout to see them in the app tab."
          : "Done — the change is live in the app on the left.";
      const doneLog = [
        ...activityLog,
        captureMode === "extension"
          ? "Worktree updated — refresh app after merge/checkout."
          : "Done — change is live in the preview.",
      ];
      return {
        status: "completed",
        message: doneMessage,
        completedAt: raw.completedAt,
        steps: doneLog,
      };
    }
    if (status === "failed") {
      return {
        status: "failed",
        message:
          activityLog[activityLog.length - 1] ??
          raw.error ??
          "Implementation failed.",
        steps: activityLog,
      };
    }
    return {
      status: status as "implementing" | "pending",
      message: lastStep ?? "Applying your approved change…",
      steps: activityLog,
    };
  }

  private implementRequestPath(sessionId: string): string {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return join(session.workspacePath, ".oryntra", "implement-request.json");
  }

  private async appendImplementActivity(
    sessionId: string,
    message: string,
  ): Promise<void> {
    const path = this.implementRequestPath(sessionId);
    await mkdir(dirname(path), { recursive: true });

    let raw: {
      sessionId: string;
      status: string;
      activityLog: string[];
    } = {
      sessionId,
      status: "implementing",
      activityLog: [],
    };

    if (existsSync(path)) {
      const existing = JSON.parse(await readFile(path, "utf8")) as {
        activityLog?: string[];
        status?: string;
      };
      raw = {
        sessionId,
        status: existing.status ?? "implementing",
        activityLog: existing.activityLog ?? [],
      };
    }

    if (raw.activityLog[raw.activityLog.length - 1] !== message) {
      raw.activityLog.push(message);
    }

    const nextStatus =
      raw.status === "completed" || raw.status === "failed"
        ? raw.status
        : "implementing";

    await writeFile(
      path,
      JSON.stringify({ ...raw, status: nextStatus }, null, 2),
      "utf8",
    );

    this.broadcast(sessionId, {
      type: "implement_status",
      status: "implementing",
      message,
    });
  }

  private async finishDirectImplementation(
    sessionId: string,
    workspacePath: string,
    artifacts: ReviewArtifact[],
    options?: { emitFailure?: boolean },
  ): Promise<boolean> {
    const result = await applyApprovedWorkspaceChanges({
      codeRoot: workspacePath,
      artifacts,
    });

    for (const step of result.steps) {
      await this.appendImplementActivity(sessionId, step);
    }

    const dir = join(workspacePath, ".oryntra");
    await mkdir(dir, { recursive: true });

    if (!result.applied) {
      if (options?.emitFailure !== false) {
        await writeFile(
          join(dir, "implement-request.json"),
          JSON.stringify(
            {
              sessionId,
              status: "failed",
              failedAt: new Date().toISOString(),
              summary: result.summary,
              activityLog: result.steps,
            },
            null,
            2,
          ),
          "utf8",
        );
        await this.appendImplementActivity(
          sessionId,
          "Could not auto-apply — continue in Cursor via .oryntra/review-history.md",
        );
        this.broadcast(sessionId, {
          type: "implement_status",
          status: "failed",
          message:
            "No automatic fix for this request — open Cursor and check .oryntra/review-history.md",
        });
        void this.syncReviewHistory(sessionId);
      }
      return false;
    }

    const doneSteps = [
      ...result.steps,
      "Files saved — refreshing preview…",
      "Done — change is live in the preview.",
    ];

    await writeFile(
      join(dir, "implement-request.json"),
      JSON.stringify(
        {
          sessionId,
          status: "completed",
          completedAt: new Date().toISOString(),
          summary: result.summary ?? "Change applied.",
          mode: "direct",
          steps: doneSteps,
          activityLog: doneSteps,
        },
        null,
        2,
      ),
      "utf8",
    );

    this.broadcast(sessionId, {
      type: "implement_status",
      status: "completed",
      message: "Done — the change is live in the app on the left.",
    });
    await this.markImplementCompleted(sessionId);
    return true;
  }

  private async watchImplementCompletion(
    sessionId: string,
    implementRequestPath: string,
  ): Promise<void> {
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!existsSync(implementRequestPath)) return;

      const raw = JSON.parse(
        await readFile(implementRequestPath, "utf8"),
      ) as { status?: string };

      if (raw.status === "completed") {
        await this.markImplementCompleted(sessionId);
        return;
      }
      if (raw.status === "failed") {
        const runtime = this.sessions.get(sessionId);
        const label = getIdeLabel(
          resolveTargetIde(
            runtime?.session ?? this.getSession(sessionId)!,
            runtime?.config,
          ),
        );
        this.broadcast(sessionId, {
          type: "implement_status",
          status: "failed",
          message: `Implementation failed — check ${label}.`,
        });
        return;
      }
    }
  }

  async markImplementCompleted(sessionId: string): Promise<void> {
    const artifacts = this.listArtifacts(sessionId);
    const pending = artifacts.filter((a) => a.status === "approved");
    if (pending.length === 0) {
      return;
    }

    for (const artifact of pending) {
      this.saveArtifact({ ...artifact, status: "implemented" } as ReviewArtifact);
    }

    const runtime = this.sessions.get(sessionId);
    const session = runtime?.session ?? this.getSession(sessionId);
    const content =
      session?.captureMode === "extension"
        ? "Done — changes are in the git worktree. Merge or checkout the branch to see them in your app tab."
        : "Done — the change is implemented. The app on the left should reflect it now (refresh if needed).";

    const agentMessage: ChatMessage = {
      id: createId("chat"),
      sessionId,
      role: "agent",
      content,
      timestamp: new Date().toISOString(),
    };
    const savedDone = this.persistChatMessage(agentMessage);
    this.broadcast(sessionId, { type: "chat_message", message: savedDone });
    this.broadcast(sessionId, {
      type: "implement_status",
      status: "completed",
      message: savedDone.content,
    });
    void this.syncReviewHistory(sessionId, { forceFull: true });
  }

  async buildHandoff(sessionId: string): Promise<HandoffPackage> {
    const session = this.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const artifacts = this.listArtifacts(sessionId);
    const feedbackMoments = this.listFeedbackMoments(sessionId);
    const transcript = this.listChatMessages(sessionId);

    const draftArtifacts = artifacts.filter((a) => a.status === "draft");
    const approvedArtifacts = artifacts.filter((a) => a.status === "approved");

    const openItems = draftArtifacts.map((a) => {
      if (a.kind === "work_order") return a.title;
      if (a.kind === "change_request") return a.title;
      if (a.kind === "doc_update") return `Doc: ${a.targetPath}`;
      if (a.kind === "architecture_update") return `Arch: ${a.section}`;
      return "artifact";
    });

    let worktree: WorktreeStatus | undefined;
    let executionPlan: ExecutionPlan | undefined;
    let updatedSession = session;

    if (approvedArtifacts.length > 0) {
      try {
        updatedSession = await this.ensureWorktree(sessionId);
        worktree =
          (await this.getWorktree(sessionId)) ?? undefined;
        executionPlan = await this.prepareExecution(sessionId);
      } catch {
        // git/worktree unavailable — handoff still returns review context
      }
    }

    const summaryParts = [
      `Oryntra review session ${sessionId} on ${session.appUrl}.`,
      `${feedbackMoments.length} feedback moment(s), ${artifacts.length} artifact(s).`,
      approvedArtifacts.length
        ? `${approvedArtifacts.length} approved for implementation.`
        : draftArtifacts.length
          ? `${draftArtifacts.length} draft artifact(s) awaiting approval.`
          : "No artifacts yet.",
    ];
    if (updatedSession.worktreePath) {
      summaryParts.push(
        `Worktree: ${updatedSession.worktreePath} (branch ${updatedSession.branchName}).`,
      );
    }

    const runtime = this.sessions.get(sessionId);
    const config =
      runtime?.config ??
      (await loadOryntraConfig(session.workspacePath));
    const targetIde = resolveTargetIde(updatedSession, config);
    const targetIdeConnected = isTargetConnected(
      this.ideRegistry,
      session.workspacePath,
      targetIde,
    );

    if (session.status !== "handoff") {
      session.status = "handoff";
      session.updatedAt = new Date().toISOString();
      this.store.saveSession(session);
      this.broadcast(sessionId, {
        type: "session_status",
        status: session.status,
        reviewMode: session.reviewMode,
      });
    }

    return {
      sessionId,
      session: updatedSession,
      summary: summaryParts.join(" "),
      openItems,
      feedbackMoments,
      artifacts,
      transcript,
      worktree,
      executionPlan,
      targetIde,
      targetIdeLabel: getIdeLabel(targetIde),
      targetIdeConnected,
      generatedAt: new Date().toISOString(),
    };
  }

  async registerClient(sessionId: string, client: WsClient): Promise<void> {
    const runtime = await this.ensureRuntime(sessionId);
    runtime.clients.add(client);
  }

  unregisterClient(sessionId: string, client: WsClient): void {
    this.sessions.get(sessionId)?.clients.delete(client);
  }

  private handleBrowserEvent(sessionId: string, event: BrowserEvent): void {
    this.store.addBrowserEvent(event);
    this.broadcast(sessionId, { type: "browser_event", event });
    if (event.type !== "mouse_sample") {
      void this.publishBrowserState(sessionId);
    }
  }

  private async publishBrowserState(sessionId: string): Promise<void> {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    const state = await runtime.browser.getBrowserState();
    this.broadcast(sessionId, { type: "browser_state", state });
  }

  private broadcast(sessionId: string, message: ServerMessage): void {
    const runtime = this.sessions.get(sessionId);
    if (!runtime) return;
    const payload = JSON.stringify(message);
    for (const client of runtime.clients) {
      client.send(payload);
    }
  }

  private normalizeArtifact(
    raw: ReviewArtifact,
    sessionId: string,
    feedbackMomentId: string,
  ): ReviewArtifact {
    const prefix =
      raw.kind === "work_order"
        ? "wo"
        : raw.kind === "doc_update"
          ? "doc"
          : raw.kind === "architecture_update"
            ? "arch"
            : "cr";
    return {
      ...raw,
      id: raw.id ?? createId(prefix),
      sessionId,
      status: raw.status ?? "draft",
      feedbackMomentIds: raw.feedbackMomentIds ?? [feedbackMomentId],
      browserEvidence:
        raw.kind === "change_request" ? (raw.browserEvidence ?? []) : undefined,
    } as ReviewArtifact;
  }

  private attachEvidence(
    artifact: ReviewArtifact,
    events: BrowserEvent[],
  ): ReviewArtifact {
    if (artifact.kind !== "change_request") return artifact;
    return {
      ...artifact,
      browserEvidence: events,
    };
  }

  private async startRuntime(
    session: ReviewSession,
    config?: OryntraConfig,
  ): Promise<RuntimeSession> {
    const resolvedConfig =
      config ?? (await loadOryntraConfig(session.workspacePath));
    this.facilitator = this.createFacilitator(resolvedConfig);

    const captureMode: CaptureMode =
      session.captureMode ?? resolvedConfig.browser?.mode ?? "embedded";

    const browser = createBrowserCapture({
      mode: captureMode,
      sessionId: session.id,
      appUrl: session.appUrl,
      config: resolvedConfig,
      onEvent: (event) => this.handleBrowserEvent(session.id, event),
    });

    const runtime: RuntimeSession = {
      session,
      config: resolvedConfig,
      browser,
      clients: new Set(),
    };
    this.sessions.set(session.id, runtime);
    this.latestSessionId = session.id;
    await browser.start();
    return runtime;
  }

  private async ensureRuntime(sessionId: string): Promise<RuntimeSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session = this.store.getSession(sessionId);
    if (
      !session ||
      session.status === "closed" ||
      session.status === "failed"
    ) {
      throw new Error(`Session not found or not active: ${sessionId}`);
    }

    return this.startRuntime(session);
  }
}
