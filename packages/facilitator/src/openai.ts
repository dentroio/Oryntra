import { createId, type FacilitatorResponse, type ReviewArtifact } from "@oryntra/core";
import {
  buildEffectiveTranscript,
  formatChatHistoryForPrompt,
} from "./chat-context.js";
import { StubReviewFacilitator } from "./stub.js";
import type { ReviewFacilitator } from "./types.js";

type OpenAiOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
};

type LlmPayload = {
  interpretation: FacilitatorResponse["interpretation"];
  summary: string;
  clarifyingQuestion?: string;
  changeRequest?: {
    title: string;
    currentBehavior: string;
    expectedBehavior: string;
    acceptanceCriteria: string[];
  };
  workOrder?: {
    title: string;
    summary: string;
    tasks: Array<{ description: string; type: string; targetPath?: string }>;
  };
  docUpdate?: {
    targetPath: string;
    summary: string;
    proposedContent: string;
  };
};

export class OpenAiReviewFacilitator implements ReviewFacilitator {
  private readonly stub = new StubReviewFacilitator();
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(options: OpenAiOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async processFeedback(
    input: import("./types.js").ProcessFeedbackInput,
  ): Promise<FacilitatorResponse> {
    try {
      const element =
        input.moment.spatial.lockedElement ??
        input.moment.spatial.lastClickedElement ??
        input.moment.spatial.elementUnderPointer;
      const context = buildEffectiveTranscript({
        transcript: input.transcript,
        chatHistory: input.chatHistory,
        artifacts: input.artifacts,
      });

      const prompt = `You are Oryntra, an AI product review facilitator.
Analyze reviewer feedback about a live web UI session.

Session app URL: ${input.session.appUrl}
Route: ${input.moment.spatial.route}
Page title: ${input.moment.spatial.pageTitle}
Mouse: ${input.moment.spatial.mouse.x}, ${input.moment.spatial.mouse.y}
Element: ${JSON.stringify(element ?? null)}

Prior Review Room conversation:
${formatChatHistoryForPrompt(input.chatHistory ?? [])}

Latest reviewer message: ${input.transcript}
Effective interpretation (with prior context): ${context.effectiveTranscript}

Respond with JSON only:
{
  "interpretation": "correct" | "missing" | "wrong" | "unclear",
  "summary": "one paragraph",
  "clarifyingQuestion": "optional question if unclear",
  "changeRequest": { "title", "currentBehavior", "expectedBehavior", "acceptanceCriteria": [] },
  "workOrder": { "title", "summary", "tasks": [{ "description", "type": "doc|architecture|code|test|config", "targetPath" }] },
  "docUpdate": { "targetPath", "summary", "proposedContent" }
}

Include changeRequest when behavior is wrong/missing. Include workOrder when implementation is needed.
Include docUpdate when docs/architecture should change.`;

      const payload = await this.completeJson<LlmPayload>(prompt);
      const suggestedArtifacts: ReviewArtifact[] = [];

      if (payload.changeRequest) {
        suggestedArtifacts.push({
          kind: "change_request",
          id: createId("cr"),
          sessionId: input.session.id,
          title: payload.changeRequest.title,
          userIntent: input.transcript,
          currentBehavior: payload.changeRequest.currentBehavior,
          expectedBehavior: payload.changeRequest.expectedBehavior,
          affectedRoutes: [input.moment.spatial.route],
          affectedElements: element ? [element] : undefined,
          priority: "medium",
          status: "draft",
          acceptanceCriteria: payload.changeRequest.acceptanceCriteria,
          feedbackMomentIds: [input.moment.id],
          browserEvidence: [],
        });
      }

      if (payload.workOrder) {
        suggestedArtifacts.push({
          kind: "work_order",
          id: createId("wo"),
          sessionId: input.session.id,
          title: payload.workOrder.title,
          summary: payload.workOrder.summary,
          tasks: payload.workOrder.tasks.map((t) => ({
            id: createId("task"),
            description: t.description,
            type: (t.type as "doc" | "architecture" | "code" | "test" | "config") ?? "code",
            targetPath: t.targetPath,
            status: "pending" as const,
          })),
          acceptanceCriteria: [],
          feedbackMomentIds: [input.moment.id],
          status: "draft",
        });
      }

      if (payload.docUpdate) {
        suggestedArtifacts.push({
          kind: "doc_update",
          id: createId("doc"),
          sessionId: input.session.id,
          targetPath: payload.docUpdate.targetPath,
          summary: payload.docUpdate.summary,
          proposedContent: payload.docUpdate.proposedContent,
          feedbackMomentIds: [input.moment.id],
          status: "draft",
        });
      }

      return {
        interpretation: payload.interpretation,
        summary: payload.summary,
        clarifyingQuestion: payload.clarifyingQuestion,
        candidateElements: element ? [element] : undefined,
        suggestedArtifacts,
      };
    } catch {
      return this.stub.processFeedback(input);
    }
  }

  async clarify(input: {
    moment: import("@oryntra/core").FeedbackMoment;
    question: string;
    candidateElements: import("@oryntra/core").ElementRef[];
  }): Promise<FacilitatorResponse> {
    return this.stub.clarify(input);
  }

  async draftArtifacts(input: {
    moments: import("@oryntra/core").FeedbackMoment[];
    session: import("@oryntra/core").ReviewSession;
  }): Promise<ReviewArtifact[]> {
    return this.stub.draftArtifacts(input);
  }

  private async completeJson<T>(prompt: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "You produce strict JSON for product review facilitation." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`OpenAI request failed: ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty LLM response");
    return JSON.parse(content) as T;
  }
}
