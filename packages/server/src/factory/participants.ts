import type { FactoryThreadMessage } from "./client.js";

export type FactoryParticipantRole =
  | "implementer"
  | "reviewer"
  | "agent"
  | "human"
  | "system";

export type FactoryParticipant = {
  name: string;
  role: FactoryParticipantRole;
};

const SKIP_AUTHORS = new Set(["oryntra-reviewer", "system", ""]);

export function normalizeFactoryWoId(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(?:WO-)?(\d+)$/i);
  if (match?.[1]) return `WO-${match[1]}`;
  return trimmed;
}

function classifyAuthor(
  name: string,
  role: string | undefined,
  type: string | undefined,
  claimingAgent?: string | null,
): FactoryParticipantRole {
  if (claimingAgent && name === claimingAgent) return "implementer";
  if (role === "human") return "human";
  if (role === "system") return "system";
  if (type === "review" || /review/i.test(name)) return "reviewer";
  return "agent";
}

/** Unique agents (and humans) on a WO thread, claiming runner first. */
export function participantsFromThread(
  messages: FactoryThreadMessage[],
  claimingAgent?: string | null,
): FactoryParticipant[] {
  const byName = new Map<string, FactoryParticipant>();
  if (claimingAgent?.trim()) {
    byName.set(claimingAgent, { name: claimingAgent, role: "implementer" });
  }
  for (const message of messages) {
    const name = (message.author ?? "").trim();
    if (!name || SKIP_AUTHORS.has(name)) continue;
    if (byName.has(name)) continue;
    byName.set(name, {
      name,
      role: classifyAuthor(name, message.role, message.type, claimingAgent),
    });
  }
  return [...byName.values()];
}

export function formatAddressedFeedback(
  transcript: string,
  addressedTo?: string | null,
): string {
  const text = transcript.trim();
  if (!addressedTo) return text;
  if (text.toLowerCase().startsWith(`@${addressedTo.toLowerCase()}`)) return text;
  return `@${addressedTo}: ${text}`;
}
