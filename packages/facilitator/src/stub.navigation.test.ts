import assert from "node:assert/strict";
import { test } from "node:test";
import type { FeedbackMoment, ReviewSession } from "@oryntra/core";
import { StubReviewFacilitator } from "./stub.js";

const session: ReviewSession = {
  id: "sess_test",
  workspacePath: "/tmp/app",
  repoName: "app",
  branchName: "main",
  appUrl: "http://localhost:3000",
  status: "active",
  reviewMode: "normal",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("navigation feedback is understood without clarification", async () => {
  const facilitator = new StubReviewFacilitator();
  const moment: FeedbackMoment = {
    id: "fm_nav",
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    modality: "typed",
    transcript:
      "I lost my filter when I navigated back to Devices after clicking View Details",
    spatial: {
      route: "http://localhost:3000/devices/d1",
      pageTitle: "Core Switch A",
      mouse: { x: 100, y: 200 },
      lastClickedElement: {
        selector: "[data-testid='device-details-button']",
        role: "button",
        name: "View Details",
        boundingBox: { x: 90, y: 190, width: 120, height: 32 },
      },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    },
    recentEventIds: [],
  };

  const result = await facilitator.processFeedback({
    moment,
    transcript: moment.transcript!,
    session,
  });

  assert.equal(result.interpretation, "wrong");
  assert.equal(result.clarifyingQuestion, undefined);
  assert.match(result.summary, /drafted a change request/i);
  assert.equal(result.suggestedArtifacts?.length, 1);
});
