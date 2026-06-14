import type { OryntraConfig } from "@oryntra/core";
import { CursorReviewFacilitator } from "./cursor.js";
import { IdeDelegatedFacilitator } from "./ide-delegated.js";
import { InstantReviewFacilitator } from "./instant.js";
import { OpenAiReviewFacilitator } from "./openai.js";
import { StubReviewFacilitator } from "./stub.js";
import type { FacilitatorFactoryDeps, ReviewFacilitator } from "./types.js";

export function createFacilitator(
  config?: OryntraConfig,
  deps?: FacilitatorFactoryDeps,
): ReviewFacilitator {
  const provider =
    process.env.ORYNTRA_FACILITATOR ??
    config?.agent?.facilitatorProvider ??
    "instant";

  // Headless CLI only — separate auth from Cursor IDE. Prefer instant + MCP in IDE.
  if (provider === "cursor" && deps?.cursorAgent && deps?.buildReviewPrompt) {
    return new CursorReviewFacilitator(deps.cursorAgent, deps.buildReviewPrompt);
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    return new OpenAiReviewFacilitator({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.ORYNTRA_LLM_MODEL ?? "gpt-4o-mini",
      baseUrl: process.env.OPENAI_BASE_URL,
    });
  }

  if (provider === "stub") {
    return new StubReviewFacilitator();
  }

  if (provider === "ide") {
    return new IdeDelegatedFacilitator();
  }

  return new InstantReviewFacilitator();
}
