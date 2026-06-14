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

const moment: FeedbackMoment = {
  id: "fm_test",
  sessionId: session.id,
  timestamp: new Date().toISOString(),
  modality: "typed",
  transcript: "This button is wrong — should open a drawer",
  spatial: {
    route: "/devices",
    pageTitle: "Devices",
    mouse: { x: 100, y: 200 },
    elementUnderPointer: {
      selector: "[data-testid='details']",
      role: "button",
      name: "View Details",
      boundingBox: { x: 90, y: 190, width: 120, height: 32 },
    },
    viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
  },
  recentEventIds: [],
};

test("stub facilitator classifies negative UI feedback", async () => {
  const facilitator = new StubReviewFacilitator();
  const result = await facilitator.processFeedback({
    moment,
    transcript: moment.transcript!,
    session,
  });

  assert.equal(result.interpretation, "wrong");
  assert.equal(result.clarifyingQuestion, undefined);
  assert.ok(result.suggestedArtifacts?.some((a) => a.kind === "change_request"));
  assert.equal(result.clarifyingQuestion, undefined);
});
