import type { FacilitatorResponse } from "@oryntra/core";
import { getIdeLabel } from "@oryntra/core";
import type { ReviewFacilitator } from "./types.js";

export class IdeDelegatedFacilitator implements ReviewFacilitator {
  async processFeedback(
    input: import("./types.js").ProcessFeedbackInput,
  ): Promise<FacilitatorResponse> {
    const element =
      input.moment.spatial.lastClickedElement ??
      input.moment.spatial.lockedElement ??
      input.moment.spatial.elementUnderPointer;
    const label = element?.name || element?.text || "the UI";
    const ideLabel = getIdeLabel(
      input.session.preferredIde ?? input.session.ide ?? "cursor",
    );

    return {
      interpretation: "unclear",
      delegatedToIde: true,
      skipAgentReply: true,
      summary: `Captured feedback on ${label} — ${ideLabel} agent is responding.`,
      suggestedArtifacts: [],
    };
  }

  async clarify(): Promise<FacilitatorResponse> {
    return {
      interpretation: "unclear",
      delegatedToIde: true,
      skipAgentReply: true,
      summary: "Clarification captured — your IDE agent is responding.",
      suggestedArtifacts: [],
    };
  }

  async draftArtifacts(): Promise<import("@oryntra/core").ReviewArtifact[]> {
    return [];
  }
}
