import assert from "node:assert/strict";
import { test } from "node:test";
import {
  factoryNoteAck,
  factoryReviewerName,
  resolveFeedbackDestination,
  shouldAutoImplementOnApprove,
} from "./lanes.js";

test("Send defaults to the review agent even when a WO is bound", () => {
  assert.equal(resolveFeedbackDestination(undefined, "WO-1080"), "review");
  assert.equal(resolveFeedbackDestination("review", "WO-1080"), "review");
  assert.equal(resolveFeedbackDestination(undefined, null), "review");
});

test("factory notes require a bound WO", () => {
  assert.equal(
    resolveFeedbackDestination("factory_note", "WO-1080"),
    "factory_note",
  );
  assert.throws(
    () => resolveFeedbackDestination("factory_note", null),
    /Bind a factory WO/,
  );
});

test("factory note ack says the run is not interrupted", () => {
  assert.match(
    factoryNoteAck("WO-1080", "cursor"),
    /cursor on WO-1080/,
  );
  assert.match(factoryNoteAck("WO-1080", "cursor"), /not interrupted/);
  assert.match(factoryNoteAck("WO-1080"), /Posted to WO-1080/);
});

test("factoryReviewerName prefers env, then config, never human", () => {
  const prev = process.env.ORYNTRA_REVIEWER;
  delete process.env.ORYNTRA_REVIEWER;
  assert.equal(factoryReviewerName(), "oryntra-reviewer");
  assert.equal(
    factoryReviewerName({
      project: { name: "app", root: "." },
      app: { url: "http://localhost:3000" },
      review: { author: "steve" },
    }),
    "steve",
  );
  process.env.ORYNTRA_REVIEWER = "  steve-env  ";
  assert.equal(
    factoryReviewerName({
      project: { name: "app", root: "." },
      app: { url: "http://localhost:3000" },
      review: { author: "steve" },
    }),
    "steve-env",
  );
  if (prev === undefined) delete process.env.ORYNTRA_REVIEWER;
  else process.env.ORYNTRA_REVIEWER = prev;
});

test("extension reviews do not auto-implement unless yaml opts in", () => {
  assert.equal(shouldAutoImplementOnApprove({}, "extension"), false);
  assert.equal(
    shouldAutoImplementOnApprove(
      { agent: { autoImplementOnApprove: false } },
      "extension",
    ),
    false,
  );
  assert.equal(
    shouldAutoImplementOnApprove(
      { agent: { autoImplementOnApprove: true } },
      "extension",
    ),
    true,
  );
});

test("embedded reviews still auto-implement by default", () => {
  assert.equal(shouldAutoImplementOnApprove({}, "embedded"), true);
  assert.equal(
    shouldAutoImplementOnApprove(
      { agent: { autoImplementOnApprove: false } },
      "embedded",
    ),
    false,
  );
});
