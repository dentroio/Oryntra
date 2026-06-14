import { createId, type FacilitatorResponse, type ReviewArtifact } from "@oryntra/core";
import { buildEffectiveTranscript } from "./chat-context.js";
import {
  buildArtifactCopy,
  detectScenario,
  elementLabel,
} from "./feedback-analysis.js";
import type { ProcessFeedbackInput, ReviewFacilitator } from "./types.js";

const POSITIVE = /\b(correct|good|works|looks right|fine|perfect|great)\b/i;
const NEGATIVE =
  /\b(wrong|broken|bug|missing|should(n't| not)|doesn't|don't|fail|error|bad|incorrect|not work|lost|lose|need|want|expected|instead)\b/i;
const NAVIGATION =
  /\b(navigate|navigation|back|filter|drawer|full page|page|route|preserve|state)\b/i;
const DOC = /\b(doc|documentation|spec|architecture|readme)\b/i;

export class StubReviewFacilitator implements ReviewFacilitator {
  async processFeedback(input: ProcessFeedbackInput): Promise<FacilitatorResponse> {
    const { moment, transcript, session } = input;
    const context = buildEffectiveTranscript({
      transcript,
      chatHistory: input.chatHistory,
      artifacts: input.artifacts,
    });
    const effectiveTranscript = context.effectiveTranscript;
    const element =
      moment.spatial.lockedElement ??
      moment.spatial.lastClickedElement ??
      moment.spatial.elementUnderPointer;
    const label = elementLabel(element) ?? "this element";
    const route = moment.spatial.route;
    const substantive = transcript.trim().length >= 20;
    const hasStrongElement =
      Boolean(element?.selector?.includes("data-testid")) ||
      element?.role === "button";

    let interpretation: FacilitatorResponse["interpretation"] = "wrong";

    if (POSITIVE.test(transcript) && !NEGATIVE.test(transcript)) {
      interpretation = "correct";
    } else if (transcript.toLowerCase().includes("missing")) {
      interpretation = "missing";
    } else if (NEGATIVE.test(transcript) || NAVIGATION.test(transcript)) {
      interpretation = "wrong";
    } else if (substantive || hasStrongElement) {
      interpretation = "wrong";
    } else {
      interpretation = "unclear";
    }

    const summary =
      interpretation === "correct"
        ? `Looks good on ${route} — noted for ${label}.`
        : interpretation === "missing"
          ? `Missing behavior on ${route} near ${label}. I drafted a fix.`
          : interpretation === "wrong"
            ? `Understood — issue on ${route} involving ${label}. I drafted a change request.`
            : `Tell me a bit more about what should change on ${route}.`;

    const suggestedArtifacts: ReviewArtifact[] = [];

    if (interpretation !== "correct") {
      const latestMessage = context.latestMessage;
      const scenario = detectScenario({
        transcript: latestMessage,
        element,
        route,
      });
      const copy = buildArtifactCopy({
        transcript: latestMessage,
        latestMessage,
        hasConversationContext: context.hasConversationContext,
        moment,
        scenario,
      });

      suggestedArtifacts.push({
        kind: "change_request",
        id: createId("cr"),
        sessionId: session.id,
        title: copy.title,
        userIntent: effectiveTranscript,
        currentBehavior: copy.currentBehavior,
        expectedBehavior: copy.expectedBehavior,
        affectedRoutes: [route],
        affectedElements: element ? [element] : undefined,
        priority: "medium",
        status: "draft",
        acceptanceCriteria: [
          "Reviewer scenario passes on the affected route",
          element
            ? `${label} behaves as described in feedback`
            : "Expected behavior matches reviewer description",
        ],
        feedbackMomentIds: [moment.id],
        browserEvidence: [],
      });
    }

    if (DOC.test(transcript)) {
      suggestedArtifacts.push({
        kind: "doc_update",
        id: createId("doc"),
        sessionId: session.id,
        targetPath: "docs/ARCHITECTURE.md",
        summary: `Document review finding: ${transcript.slice(0, 120)}`,
        proposedContent: `## Review finding (${route})\n\n${transcript}\n\nElement: ${label}`,
        feedbackMomentIds: [moment.id],
        status: "draft",
      });
    }

    return {
      interpretation,
      summary,
      clarifyingQuestion:
        interpretation === "unclear"
          ? "What should happen instead? One sentence is enough."
          : undefined,
      candidateElements: element ? [element] : undefined,
      suggestedArtifacts,
    };
  }

  async clarify(_input: {
    moment: import("@oryntra/core").FeedbackMoment;
    question: string;
    candidateElements: import("@oryntra/core").ElementRef[];
  }): Promise<FacilitatorResponse> {
    return {
      interpretation: "wrong",
      summary: "Thanks — I updated the draft with your clarification.",
    };
  }

  async draftArtifacts(input: {
    moments: import("@oryntra/core").FeedbackMoment[];
    session: import("@oryntra/core").ReviewSession;
  }): Promise<ReviewArtifact[]> {
    const artifacts: ReviewArtifact[] = [];
    for (const moment of input.moments) {
      if (!moment.transcript) continue;
      const result = await this.processFeedback({
        moment,
        transcript: moment.transcript,
        session: input.session,
      });
      if (result.suggestedArtifacts) {
        artifacts.push(...result.suggestedArtifacts);
      }
    }
    return artifacts;
  }
}
