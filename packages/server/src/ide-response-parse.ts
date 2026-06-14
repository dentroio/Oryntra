import {
  artifactsFromCursorPayload,
  parseCursorReviewResponse,
  type CursorReviewJson,
} from "@oryntra/facilitator";

export function normalizeIdeAgentReply(raw: string): {
  summary: string;
  payload?: CursorReviewJson;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { summary: "Got it — reviewing your feedback." };
  }

  const oryntra = parseCursorReviewResponse(trimmed);
  if (oryntra.payload?.changeRequest) {
    return oryntra;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as {
        interpretation?: string;
        summary?: string;
        chatMessage?: string;
        changeRequest?: CursorReviewJson["changeRequest"];
      };
      const cr = parsed.changeRequest;
      if (cr?.expectedBehavior) {
        const summary =
          parsed.summary?.trim() ||
          parsed.chatMessage?.trim() ||
          `I'll update the app so ${cr.expectedBehavior}`;
        return {
          summary,
          payload: {
            interpretation: parsed.interpretation as
              | CursorReviewJson["interpretation"]
              | undefined,
            changeRequest: cr,
          },
        };
      }
    } catch {
      // not JSON — fall through
    }
  }

  return { summary: trimmed };
}

export { artifactsFromCursorPayload };
