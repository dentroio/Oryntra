import type { FeedbackDestination, OryntraConfig } from "@oryntra/core";

export type { FeedbackDestination };

/** Send talks to Oryntra. A factory note is explicit and requires a bound WO. */
export function resolveFeedbackDestination(
  requested: string | undefined,
  factoryWo: string | null | undefined,
): FeedbackDestination {
  if (requested === "factory_note") {
    if (!factoryWo) {
      throw new Error(
        "Bind a factory WO before posting a note to the implementer.",
      );
    }
    return "factory_note";
  }
  return "review";
}

export function factoryNoteAck(
  wo: string,
  agent?: string | null,
): string {
  const who = agent?.trim();
  const target = who ? `${who} on ${wo}` : wo;
  return `Posted to ${target}. They will see it after this pass — the current run is not interrupted.`;
}

/** Factory `decided_by` — never the proxy default `"human"`. */
export function factoryReviewerName(config?: OryntraConfig | null): string {
  return (
    process.env.ORYNTRA_REVIEWER?.trim() ||
    config?.review?.author?.trim() ||
    "oryntra-reviewer"
  );
}

/**
 * Approve queues a factory WO; local Cursor implement is opt-in.
 * Extension reviews stay factory-first unless yaml sets autoImplementOnApprove: true.
 */
export function shouldAutoImplementOnApprove(
  config: Pick<OryntraConfig, "agent"> | null | undefined,
  captureMode?: string | null,
): boolean {
  const flag = config?.agent?.autoImplementOnApprove;
  if (flag === false) return false;
  if (captureMode === "extension") return flag === true;
  return true;
}
