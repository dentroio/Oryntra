import { createId, type FacilitatorResponse } from "@oryntra/core";

export type CursorReviewJson = {
  interpretation?: FacilitatorResponse["interpretation"];
  changeRequest?: {
    title: string;
    currentBehavior?: string;
    expectedBehavior: string;
    acceptanceCriteria?: string[];
  };
};

export function parseCursorReviewResponse(text: string): {
  summary: string;
  payload?: CursorReviewJson;
} {
  const marker = "ORYNTRA_JSON=";
  const idx = text.lastIndexOf(marker);
  if (idx < 0) {
    return { summary: text.trim() };
  }

  const summary = text.slice(0, idx).trim();
  const jsonPart = text.slice(idx + marker.length).trim();
  try {
    const payload = JSON.parse(jsonPart) as CursorReviewJson;
    return { summary: summary || text.trim(), payload };
  } catch {
    return { summary: text.trim() };
  }
}

export function artifactsFromCursorPayload(input: {
  payload: CursorReviewJson | undefined;
  sessionId: string;
  momentId: string;
  transcript: string;
  route: string;
}): import("@oryntra/core").ReviewArtifact[] {
  const cr = input.payload?.changeRequest;
  if (!cr?.expectedBehavior) return [];

  return [
    {
      kind: "change_request",
      id: createId("cr"),
      sessionId: input.sessionId,
      title: cr.title || input.transcript.slice(0, 60),
      userIntent: input.transcript,
      currentBehavior:
        cr.currentBehavior ?? "Current UI does not match reviewer expectations.",
      expectedBehavior: cr.expectedBehavior,
      affectedRoutes: [input.route],
      priority: "medium",
      status: "draft",
      acceptanceCriteria:
        cr.acceptanceCriteria?.length
          ? cr.acceptanceCriteria
          : ["Expected behavior matches reviewer description"],
      feedbackMomentIds: [input.momentId],
      browserEvidence: [],
    },
  ];
}
