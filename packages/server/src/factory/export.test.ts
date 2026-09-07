import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChangeRequest, ReviewSession, WorkOrder } from "@oryntra/core";
import { artifactToFactoryDraft } from "./export.js";

const session: ReviewSession = {
  id: "sess_1",
  workspacePath: "/tmp/app",
  repoName: "app",
  branchName: "main",
  appUrl: "http://localhost:3000",
  status: "active",
  reviewMode: "normal",
  createdAt: "2026-08-17T00:00:00.000Z",
  updatedAt: "2026-08-17T00:00:00.000Z",
};

test("change_request maps to a factory draft with padded acceptance criteria", () => {
  const artifact: ChangeRequest = {
    kind: "change_request",
    id: "cr_1",
    sessionId: session.id,
    title: "Open details in a drawer",
    userIntent: "Keep filters when viewing a device",
    currentBehavior: "Full page navigation",
    expectedBehavior: "Side drawer, filters stay",
    affectedRoutes: ["/devices"],
    priority: "high",
    status: "approved",
    acceptanceCriteria: ["Drawer opens"],
    feedbackMomentIds: [],
    browserEvidence: [],
  };
  const draft = artifactToFactoryDraft(artifact, session);
  assert.ok(draft);
  assert.equal(draft?.priority, "P1");
  assert.equal(draft?.services, "frontend");
  assert.match(draft?.problem ?? "", /Keep filters/);
  assert.equal(draft?.whatToBuild, "Side drawer, filters stay");
  assert.ok((draft?.acceptanceCriteria.length ?? 0) >= 3);
  assert.match(draft?.notes ?? "", /sess_1/);
});

test("work_order maps tasks into what_to_build", () => {
  const artifact: WorkOrder = {
    kind: "work_order",
    id: "wo_1",
    sessionId: session.id,
    title: "Fix empty state",
    summary: "Empty device list is confusing",
    tasks: [
      { id: "t1", description: "Add empty illustration", type: "code", status: "pending" },
      { id: "t2", description: "Copy for zero results", type: "code", status: "pending" },
    ],
    acceptanceCriteria: [],
    feedbackMomentIds: [],
    status: "approved",
  };
  const draft = artifactToFactoryDraft(artifact, session);
  assert.ok(draft);
  assert.match(draft?.whatToBuild ?? "", /empty illustration/);
  assert.equal(draft?.priority, "P2");
});

test("doc_update cannot be exported as a factory WO", () => {
  const draft = artifactToFactoryDraft(
    {
      kind: "doc_update",
      id: "d1",
      sessionId: session.id,
      targetPath: "README.md",
      summary: "n/a",
      proposedContent: "",
      feedbackMomentIds: [],
      status: "approved",
    },
    session,
  );
  assert.equal(draft, null);
});
