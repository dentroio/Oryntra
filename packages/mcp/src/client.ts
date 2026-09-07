import type {
  BrowserState,
  ChatMessage,
  ExecutionPlan,
  FeedbackMoment,
  HandoffPackage,
  ReviewArtifact,
  ReviewSession,
  SubmitIdeAgentResponseRequest,
  WorktreeStatus,
} from "@oryntra/core";

export class OryntraApiClient {
  constructor(private readonly baseUrl: string) {}

  async getActiveSession(): Promise<ReviewSession> {
    return this.get("/api/sessions/active");
  }

  async getSession(sessionId: string): Promise<ReviewSession> {
    return this.get(`/api/sessions/${sessionId}`);
  }

  async getBrowserState(sessionId: string): Promise<BrowserState> {
    return this.get(`/api/sessions/${sessionId}/browser-state`);
  }

  async getFeedbackMoments(sessionId: string): Promise<FeedbackMoment[]> {
    return this.get(`/api/sessions/${sessionId}/feedback-moments`);
  }

  async getPendingFeedback(sessionId: string): Promise<FeedbackMoment[]> {
    return this.get(`/api/sessions/${sessionId}/pending-feedback`);
  }

  async submitReviewResponse(
    sessionId: string,
    request: SubmitIdeAgentResponseRequest,
  ): Promise<{
    moment: FeedbackMoment;
    chatMessage: ChatMessage;
    artifacts: ReviewArtifact[];
  }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/ide-response`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `IDE response failed (${res.status})`);
    }
    return res.json() as Promise<{
      moment: FeedbackMoment;
      chatMessage: ChatMessage;
      artifacts: ReviewArtifact[];
    }>;
  }

  async listArtifacts(sessionId: string): Promise<ReviewArtifact[]> {
    return this.get(`/api/sessions/${sessionId}/artifacts`);
  }

  async getTranscript(sessionId: string): Promise<ChatMessage[]> {
    return this.get(`/api/sessions/${sessionId}/chat`);
  }

  async getReviewHistory(sessionId: string): Promise<{
    path: string;
    markdown: string;
    reviewRoomUrl: string;
  }> {
    return this.get(`/api/sessions/${sessionId}/review-history`);
  }

  async updateArtifactStatus(
    sessionId: string,
    artifactId: string,
    status: string,
  ): Promise<ReviewArtifact> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/artifacts/${artifactId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Artifact update failed (${res.status})`);
    }
    return res.json() as Promise<ReviewArtifact>;
  }

  async getWorktree(sessionId: string): Promise<WorktreeStatus> {
    return this.get(`/api/sessions/${sessionId}/worktree`);
  }

  async prepareExecution(sessionId: string): Promise<ExecutionPlan> {
    return this.get(`/api/sessions/${sessionId}/execution-plan`);
  }

  async applyApprovedDocs(
    sessionId: string,
  ): Promise<Array<{ artifactId: string; targetPath: string; mode: string }>> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/apply-docs`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Apply docs failed (${res.status})`);
    }
    return res.json() as Promise<
      Array<{ artifactId: string; targetPath: string; mode: string }>
    >;
  }

  async handoff(sessionId: string): Promise<HandoffPackage> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/handoff`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Handoff failed (${res.status})`);
    }
    return res.json() as Promise<HandoffPackage>;
  }

  async getImplementStatus(sessionId: string): Promise<{
    status: string;
    message?: string;
    steps?: string[];
    completedAt?: string;
  }> {
    return this.get(`/api/sessions/${sessionId}/implement-status`);
  }

  async requestImplementation(sessionId: string): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/implement`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Implement request failed (${res.status})`);
    }
    return res.json();
  }

  async proposePatch(
    sessionId: string,
    artifactId: string,
  ): Promise<import("@oryntra/core").ProposedPatch> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/propose-patch`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifactId }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Propose patch failed (${res.status})`);
    }
    return res.json() as Promise<import("@oryntra/core").ProposedPatch>;
  }

  async applyPatch(
    sessionId: string,
    patch: import("@oryntra/core").ProposedPatch,
  ): Promise<import("@oryntra/core").PatchResult> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/apply-patch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Apply patch failed (${res.status})`);
    }
    return res.json() as Promise<import("@oryntra/core").PatchResult>;
  }

  async getFactoryContext(sessionId: string): Promise<{
    factoryWo: string | null;
    factoryAgent: string | null;
    factoryBackend: string | null;
    factorySlug: string | null;
    factoryAddressedTo: string | null;
    participants: Array<{
      name: string;
      role: "implementer" | "reviewer" | "agent" | "human" | "system";
    }>;
    thread: Array<{
      author: string;
      role: string;
      type: string;
      content: string;
      image_url?: string;
    }>;
  }> {
    return this.get(`/api/sessions/${sessionId}/factory-context`);
  }

  async joinFactoryReview(wo: string): Promise<{
    sessionId: string;
    reviewRoomUrl: string;
    wo: string;
  }> {
    const url = new URL("/api/factory/join", `${this.baseUrl}/`);
    url.searchParams.set("wo", wo);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Join factory review failed (${res.status})`);
    }
    return res.json() as Promise<{
      sessionId: string;
      reviewRoomUrl: string;
      wo: string;
    }>;
  }

  async setFactoryAddressedTo(
    sessionId: string,
    agent: string | null,
  ): Promise<ReviewSession> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/factory-address`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Address factory agent failed (${res.status})`);
    }
    return res.json() as Promise<ReviewSession>;
  }

  async listFactoryLiveWork(): Promise<
    Array<{
      wo: string;
      status: string;
      agent: string;
      backend: string;
      slug: string;
      step: string;
      prUrl: string;
      claimedAt: string | null;
    }>
  > {
    return this.get("/api/factory/live-work");
  }

  async bindFactoryWo(sessionId: string, wo: string | null): Promise<ReviewSession> {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/factory-wo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wo }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Bind factory WO failed (${res.status})`);
    }
    return res.json() as Promise<ReviewSession>;
  }

  async exportArtifactToFactory(
    sessionId: string,
    artifactId: string,
  ): Promise<{ ok: boolean; woId?: string; error?: string; alreadyExported?: boolean }> {
    const res = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/artifacts/${artifactId}/export-factory`,
      { method: "POST" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Export to factory failed (${res.status})`);
    }
    return res.json() as Promise<{
      ok: boolean;
      woId?: string;
      error?: string;
      alreadyExported?: boolean;
    }>;
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
  }
}
