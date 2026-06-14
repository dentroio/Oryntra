import type { FacilitatorResponse, ReviewArtifact } from "@oryntra/core";
import { buildEffectiveTranscript } from "./chat-context.js";
import { buildConversationalReply } from "./feedback-analysis.js";
import { StubReviewFacilitator } from "./stub.js";
import type { ProcessFeedbackInput, ReviewFacilitator } from "./types.js";

export class InstantReviewFacilitator implements ReviewFacilitator {
  private readonly stub = new StubReviewFacilitator();

  async processFeedback(input: ProcessFeedbackInput): Promise<FacilitatorResponse> {
    const context = buildEffectiveTranscript({
      transcript: input.transcript,
      chatHistory: input.chatHistory,
      artifacts: input.artifacts,
    });
    const result = await this.stub.processFeedback(input);
    const artifact = result.suggestedArtifacts?.[0];

    return {
      ...result,
      summary: buildConversationalReply({
        moment: input.moment,
        artifact,
        hasConversationContext: context.hasConversationContext,
      }),
      clarifyingQuestion: undefined,
    };
  }

  async clarify(
    input: Parameters<ReviewFacilitator["clarify"]>[0],
  ): Promise<FacilitatorResponse> {
    return this.stub.clarify(input);
  }

  async draftArtifacts(
    input: Parameters<ReviewFacilitator["draftArtifacts"]>[0],
  ): Promise<ReviewArtifact[]> {
    return this.stub.draftArtifacts(input);
  }
}
