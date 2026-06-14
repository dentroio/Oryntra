import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage, FeedbackMoment, ReviewSession } from "@oryntra/core";
import { InstantReviewFacilitator } from "./instant.js";

const session: ReviewSession = {
  id: "sess_test",
  workspacePath: "/tmp/app",
  repoName: "app",
  branchName: "main",
  appUrl: "http://localhost:4318",
  status: "active",
  reviewMode: "normal",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

test("filter feedback gets a conversational reply, not an echo", async () => {
  const facilitator = new InstantReviewFacilitator();
  const transcript =
    "I want to make sure that you can navigate back to the original filter. I was filtering NYC, but if I click devices, I go to all the devices. You need another breadcrumb with NYC. Or what do you suggest?";

  const moment: FeedbackMoment = {
    id: "fm_filter",
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    modality: "typed",
    transcript,
    spatial: {
      route: "http://127.0.0.1:4318/devices/d1",
      pageTitle: "Core Switch A",
      mouse: { x: 100, y: 200 },
      lastClickedElement: {
        selector: "[data-testid='device-details-button']",
        role: "link",
        name: "View Details",
        boundingBox: { x: 90, y: 190, width: 120, height: 32 },
      },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    },
    recentEventIds: [],
  };

  const result = await facilitator.processFeedback({ moment, transcript, session });

  assert.match(result.summary, /NYC/i);
  assert.match(result.summary, /drawer|URL|filter/i);
  assert.doesNotMatch(result.summary, /Expected fix:/i);
  assert.notEqual(result.summary.trim(), transcript);

  const cr = result.suggestedArtifacts?.find((a) => a.kind === "change_request");
  assert.ok(cr && cr.kind === "change_request");
  assert.notEqual(cr.expectedBehavior, transcript);
  assert.match(cr.expectedBehavior, /drawer|URL|site=NYC/i);
});

test("dark mode feedback gets a plain-language reply", async () => {
  const facilitator = new InstantReviewFacilitator();
  const transcript = "can you implement a dark mode";

  const moment: FeedbackMoment = {
    id: "fm_dark",
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    modality: "typed",
    transcript,
    spatial: {
      route: "http://127.0.0.1:4318/?oryntra_session=sess_test",
      pageTitle: "Clarion Demo — Oryntra Test App",
      mouse: { x: 0, y: 0 },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    },
    recentEventIds: [],
  };

  const result = await facilitator.processFeedback({ moment, transcript, session });

  assert.match(result.summary, /dark/i);
  assert.doesNotMatch(result.summary, /oryntra_session/i);
  assert.doesNotMatch(result.summary, /Behavior matches the reviewer/i);
  const cr = result.suggestedArtifacts?.find((a) => a.kind === "change_request");
  assert.ok(cr && cr.kind === "change_request");
  assert.match(cr.expectedBehavior, /dark|theme/i);
});

test("devices dark mode polish is not treated as add-dark-mode-from-scratch", async () => {
  const facilitator = new InstantReviewFacilitator();
  const transcript =
    "the devices page looks really bad in dark mode and we should add a toggle switch to change from dark to light mode";

  const moment: FeedbackMoment = {
    id: "fm_devices_dark",
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    modality: "typed",
    transcript,
    spatial: {
      route: "http://127.0.0.1:4318/devices",
      pageTitle: "Clarion Demo",
      mouse: { x: 0, y: 0 },
      lastClickedElement: {
        selector: "a",
        role: "link",
        name: "Devices",
        boundingBox: { x: 0, y: 0, width: 60, height: 20 },
      },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    },
    recentEventIds: [],
  };

  const result = await facilitator.processFeedback({ moment, transcript, session });

  assert.match(result.summary, /Devices/i);
  assert.match(result.summary, /toggle|top bar/i);
  assert.doesNotMatch(result.summary, /Today:/i);
  assert.doesNotMatch(result.summary, /I'd change it to/i);
  assert.match(result.summary, /dark|theme|toggle/i);
  const cr = result.suggestedArtifacts?.find((a) => a.kind === "change_request");
  assert.ok(cr && cr.kind === "change_request");
  assert.match(cr.expectedBehavior, /Devices|toggle|dark/i);
});

test("follow-up correction uses prior chat context", async () => {
  const facilitator = new InstantReviewFacilitator();
  const chatHistory: ChatMessage[] = [
    {
      id: "chat_prior",
      sessionId: session.id,
      role: "user",
      content:
        "I would like to add another badge to the main page, called locations",
      timestamp: new Date().toISOString(),
    },
    {
      id: "chat_agent",
      sessionId: session.id,
      role: "agent",
      content: "I'll add that badge to the home page.",
      timestamp: new Date().toISOString(),
    },
  ];

  const transcript =
    "make it match the Devices and Settings tiles — same size, same link style";

  const moment: FeedbackMoment = {
    id: "fm_followup",
    sessionId: session.id,
    timestamp: new Date().toISOString(),
    modality: "typed",
    transcript,
    spatial: {
      route: "http://127.0.0.1:4318/",
      pageTitle: "Clarion Demo",
      mouse: { x: 0, y: 0 },
      viewport: { width: 1280, height: 800, scrollX: 0, scrollY: 0 },
    },
    recentEventIds: [],
  };

  const result = await facilitator.processFeedback({
    moment,
    transcript,
    session,
    chatHistory,
    artifacts: [],
  });

  assert.match(result.summary, /devices|settings|tiles|locations/i);
  const cr = result.suggestedArtifacts?.find((a) => a.kind === "change_request");
  assert.ok(cr && cr.kind === "change_request");
  assert.match(cr.userIntent, /Conversation so far/i);
  assert.match(cr.userIntent, /locations/i);
  assert.match(cr.userIntent, /Devices and Settings tiles/i);
});
