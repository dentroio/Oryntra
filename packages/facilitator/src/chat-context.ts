import type { ChatMessage, ReviewArtifact } from "@oryntra/core";
import type { ProcessFeedbackInput } from "./types.js";

export type FactoryContextLine = { role: "user" | "agent"; content: string };

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

export function formatFactoryThreadForPrompt(
  factoryThread?: FactoryContextLine[],
): string {
  if (!factoryThread || factoryThread.length === 0) return "";
  return factoryThread
    .slice(-40)
    .map((msg) => {
      const who = msg.role === "user" ? "Reviewer" : "Factory agent";
      return `${who}: ${msg.content}`;
    })
    .join("\n");
}

export function transcriptFromFeedback(input: ProcessFeedbackInput) {
  return {
    transcript: input.transcript,
    chatHistory: input.chatHistory,
    artifacts: input.artifacts,
    factoryThread: input.factoryThread,
    factoryBinding: input.factoryBinding,
  };
}

/**
 * Build facilitator context from prior chat + artifacts + the new message.
 * No phrase matching — every message gets prior context when history exists.
 */
export function buildEffectiveTranscript(input: {
  transcript: string;
  chatHistory?: ChatMessage[];
  artifacts?: ReviewArtifact[];
  factoryThread?: FactoryContextLine[];
  factoryBinding?: { wo: string; agent?: string | null; addressedTo?: string | null };
}): FeedbackContext {
  const chatHistory = input.chatHistory ?? [];
  const artifacts = input.artifacts ?? [];
  const latestMessage = input.transcript.trim();

  const chatBlock = formatChatHistoryForPrompt(chatHistory);
  const factoryBlock = formatFactoryThreadForPrompt(input.factoryThread);
  const artifactBlock = formatRecentArtifacts(artifacts);
  const hasConversationContext =
    chatBlock.length > 0 || factoryBlock.length > 0 || artifactBlock.length > 0;

  if (!hasConversationContext) {
    return {
      effectiveTranscript: latestMessage,
      latestMessage,
      hasConversationContext: false,
    };
  }

  const parts: string[] = [];
  if (input.factoryBinding?.wo) {
    const agent = input.factoryBinding.agent
      ? ` (implementer ${input.factoryBinding.agent})`
      : "";
    parts.push(
      `This review continues factory work ${input.factoryBinding.wo}${agent}. You are Oryntra's review facilitator, not the factory implementer. Use the factory thread below as memory only — do not speak as that agent. The human is talking to you. Do not start over.`,
      "",
    );
  }
  if (factoryBlock) {
    parts.push("Factory agent thread so far:", factoryBlock, "");
  }
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
