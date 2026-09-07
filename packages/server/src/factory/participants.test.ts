import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAddressedFeedback,
  normalizeFactoryWoId,
  participantsFromThread,
} from "./participants.js";

test("normalizeFactoryWoId accepts WO- prefix or a bare number", () => {
  assert.equal(normalizeFactoryWoId("WO-1047"), "WO-1047");
  assert.equal(normalizeFactoryWoId("1047"), "WO-1047");
  assert.equal(normalizeFactoryWoId("  wo-12 "), "WO-12");
});

test("participantsFromThread puts the claiming agent first as implementer", () => {
  const roster = participantsFromThread(
    [
      { author: "security", role: "agent", type: "review", content: "ok" },
      { author: "cursor", role: "agent", type: "text", content: "working" },
      { author: "oryntra-reviewer", role: "human", type: "text", content: "fix drawer" },
    ],
    "cursor",
  );
  assert.equal(roster[0]?.name, "cursor");
  assert.equal(roster[0]?.role, "implementer");
  assert.equal(roster.find((p) => p.name === "security")?.role, "reviewer");
  assert.equal(
    roster.some((p) => p.name === "oryntra-reviewer"),
    false,
  );
});

test("participantsFromThread seeds the claiming agent when the thread is empty", () => {
  const roster = participantsFromThread([], "claude");
  assert.deepEqual(roster, [{ name: "claude", role: "implementer" }]);
});

test("formatAddressedFeedback prefixes once", () => {
  assert.equal(formatAddressedFeedback("drawer is wrong", "cursor"), "@cursor: drawer is wrong");
  assert.equal(
    formatAddressedFeedback("@cursor: already tagged", "cursor"),
    "@cursor: already tagged",
  );
});
