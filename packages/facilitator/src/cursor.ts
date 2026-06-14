import type { FacilitatorResponse } from "@oryntra/core";
import { buildEffectiveTranscript } from "./chat-context.js";
import {
  artifactsFromCursorPayload,
  parseCursorReviewResponse,
} from "./cursor-parse.js";
import { InstantReviewFacilitator } from "./instant.js";
import type {
  CursorAgentRunner,
  ProcessFeedbackInput,
  ReviewFacilitator,
} from "./types.js";

export type BuildReviewPrompt = (input: {
  session: ProcessFeedbackInput["session"];
  moment: ProcessFeedbackInput["moment"];
  transcript: string;
  chatHistory?: ProcessFeedbackInput["chatHistory"];
  artifacts?: ProcessFeedbackInput["artifacts"];
  reviewRoomUrl: string;
  effectiveTranscript: string;
}) => string;

export class CursorReviewFacilitator implements ReviewFacilitator {
  private readonly instant = new InstantReviewFacilitator();

  constructor(
    private readonly runner: CursorAgentRunner,
    private readonly buildPrompt: BuildReviewPrompt,
  ) {}

  async processFeedback(
    input: ProcessFeedbackInput,
  ): Promise<FacilitatorResponse> {
    const context = buildEffectiveTranscript({
      transcript: input.transcript,
      chatHistory: input.chatHistory,
      artifacts: input.artifacts,
    });

    if (!input.cursorChatId) {
      return this.fallback(
        input,
        "No Cursor agent session — run collaborate or enable cursorAgent in oryntra.yaml.",
      );
    }

    const prompt = this.buildPrompt({
      session: input.session,
      moment: input.moment,
      transcript: input.transcript,
      chatHistory: input.chatHistory,
      artifacts: input.artifacts,
      reviewRoomUrl: input.reviewRoomUrl ?? "",
      effectiveTranscript: context.effectiveTranscript,
    });

    const result = await this.runner({
      workspacePath: input.session.workspacePath,
      cursorChatId: input.cursorChatId,
      prompt,
    });

    if (!result.ok || !result.text) {
      return this.fallback(
        input,
        result.reason ?? "Cursor agent did not return a response",
      );
    }

    const parsed = parseCursorReviewResponse(result.text);
    const interpretation =
      parsed.payload?.interpretation ??
      (parsed.payload?.changeRequest ? "wrong" : "unclear");

    let suggestedArtifacts = artifactsFromCursorPayload({
      payload: parsed.payload,
      sessionId: input.session.id,
      momentId: input.moment.id,
      transcript: context.effectiveTranscript,
      route: input.moment.spatial.route,
    });

    if (suggestedArtifacts.length === 0 && interpretation !== "correct") {
      const fallback = await this.instant.processFeedback(input);
      suggestedArtifacts = fallback.suggestedArtifacts ?? [];
    }

    return {
      interpretation,
      summary: parsed.summary || result.text.trim(),
      suggestedArtifacts,
    };
  }

  private async fallback(
    input: ProcessFeedbackInput,
    reason: string,
  ): Promise<FacilitatorResponse> {
    const result = await this.instant.processFeedback(input);
    const hint = this.sanitizeFallbackReason(reason);
    return {
      ...result,
      summary: `${result.summary}\n\n⚠️ ${hint}`,
    };
  }

  private sanitizeFallbackReason(reason: string): string {
    if (/Authentication required|cursor agent login|CURSOR_API_KEY|not logged in/i.test(reason)) {
      return "Cursor agent needs login — run `cursor agent login` in a terminal, then send again. (Using a local reply for now.)";
    }
    if (reason.length > 220 || reason.includes("Oryntra Review Studio")) {
      return "Cursor agent unavailable — run `cursor agent login` or set CURSOR_API_KEY. (Using a local reply for now.)";
    }
    return `Cursor agent unavailable (${reason}). Using a local reply for now.`;
  }

  async clarify(
    input: Parameters<ReviewFacilitator["clarify"]>[0],
  ): Promise<FacilitatorResponse> {
    return this.instant.clarify(input);
  }

  async draftArtifacts(
    input: Parameters<ReviewFacilitator["draftArtifacts"]>[0],
  ): Promise<import("@oryntra/core").ReviewArtifact[]> {
    return this.instant.draftArtifacts(input);
  }
}
