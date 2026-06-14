import type { ChatMessage, ReviewArtifact } from "@oryntra/core";

export const MAX_CHAT_HISTORY = 30;

export type FeedbackContext = {
  /** Full context for facilitator + implementation (conversation + artifacts + latest). */
  effectiveTranscript: string;
  latestMessage: string;
  hasConversationContext: boolean;
};

export function formatChatHistoryForPrompt(
  chatHistory: ChatMessage[],
): string {
  if (chatHistory.length === 0) return "";
  return chatHistory
    .slice(-MAX_CHAT_HISTORY)
    .map((msg) => {
      const who = msg.role === "user" ? "Reviewer" : "Agent";
      return `${who}: ${msg.content}`;
    })
    .join("\n");
}

function formatRecentArtifacts(artifacts: ReviewArtifact[]): string {
  const changes = artifacts.filter((a) => a.kind === "change_request").slice(-5);
  if (changes.length === 0) return "";

  const lines = changes.map((artifact) => {
    if (artifact.kind !== "change_request") return "";
    return `- [${artifact.status}] ${artifact.title}\n  Expected: ${artifact.expectedBehavior}`;
  });

  return lines.filter(Boolean).join("\n");
}

/**
 * Build facilitator context from prior chat + artifacts + the new message.
 * No phrase matching — every message gets prior context when history exists.
 */
export function buildEffectiveTranscript(input: {
  transcript: string;
  chatHistory?: ChatMessage[];
  artifacts?: ReviewArtifact[];
}): FeedbackContext {
  const chatHistory = input.chatHistory ?? [];
  const artifacts = input.artifacts ?? [];
  const latestMessage = input.transcript.trim();

  const chatBlock = formatChatHistoryForPrompt(chatHistory);
  const artifactBlock = formatRecentArtifacts(artifacts);
  const hasConversationContext =
    chatBlock.length > 0 || artifactBlock.length > 0;

  if (!hasConversationContext) {
    return {
      effectiveTranscript: latestMessage,
      latestMessage,
      hasConversationContext: false,
    };
  }

  const parts: string[] = [];
  if (chatBlock) {
    parts.push("Conversation so far:", chatBlock, "");
  }
  if (artifactBlock) {
    parts.push("Related change requests:", artifactBlock, "");
  }
  parts.push(`Latest message: ${latestMessage}`);

  return {
    effectiveTranscript: parts.join("\n"),
    latestMessage,
    hasConversationContext: true,
  };
}
