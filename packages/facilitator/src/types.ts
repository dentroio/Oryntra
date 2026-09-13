import type {
  ChatMessage,
  ElementRef,
  FacilitatorResponse,
  FeedbackMoment,
  ReviewArtifact,
  ReviewSession,
} from "@oryntra/core";

export type CursorAgentRunner = (input: {
  workspacePath: string;
  cursorChatId: string;
  prompt: string;
}) => Promise<{ ok: boolean; text?: string; reason?: string }>;

export type ProcessFeedbackInput = {
  moment: FeedbackMoment;
  transcript: string;
  session: ReviewSession;
  /** Prior Review Room messages (excludes the message being processed). */
  chatHistory?: ChatMessage[];
  /** Session artifacts — used to connect follow-ups to earlier change requests. */
  artifacts?: ReviewArtifact[];
  /** Cursor agent chat id from .oryntra/agent-session.json */
  cursorChatId?: string;
  reviewRoomUrl?: string;
  /** Factory WO thread (system of record when the session is bound to an agent). */
  factoryThread?: { role: "user" | "agent"; content: string }[];
  factoryBinding?: { wo: string; agent?: string | null; addressedTo?: string | null };
};

export type FacilitatorFactoryDeps = {
  cursorAgent?: CursorAgentRunner;
  buildReviewPrompt?: import("./cursor.js").BuildReviewPrompt;
};

export interface ReviewFacilitator {
  processFeedback(input: ProcessFeedbackInput): Promise<FacilitatorResponse>;

  clarify(input: {
    moment: FeedbackMoment;
    question: string;
    candidateElements: ElementRef[];
  }): Promise<FacilitatorResponse>;

  draftArtifacts(input: {
    moments: FeedbackMoment[];
    session: ReviewSession;
  }): Promise<ReviewArtifact[]>;
}
