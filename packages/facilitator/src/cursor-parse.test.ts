import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artifactsFromCursorPayload,
  parseCursorReviewResponse,
} from "./cursor-parse.js";

test("parseCursorReviewResponse splits chat text and JSON trailer", () => {
  const text = [
    "I'll make Locations a card like the other two.",
    'ORYNTRA_JSON={"interpretation":"wrong","changeRequest":{"title":"Locations card","expectedBehavior":"Locations matches Devices and Settings cards"}}',
  ].join("\n");

  const parsed = parseCursorReviewResponse(text);
  assert.match(parsed.summary, /Locations a card/i);
  assert.equal(parsed.payload?.interpretation, "wrong");
  assert.equal(parsed.payload?.changeRequest?.title, "Locations card");
});

test("artifactsFromCursorPayload builds draft change request", () => {
  const artifacts = artifactsFromCursorPayload({
    payload: {
      interpretation: "wrong",
      changeRequest: {
        title: "Fix Locations",
        expectedBehavior: "Locations is a full card with a link.",
      },
    },
    sessionId: "sess_x",
    momentId: "fm_x",
    transcript: "make locations a card",
    route: "http://127.0.0.1:4318/",
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0]?.kind, "change_request");
  if (artifacts[0]?.kind === "change_request") {
    assert.equal(artifacts[0].status, "draft");
    assert.match(artifacts[0].expectedBehavior, /full card/i);
  }
});
