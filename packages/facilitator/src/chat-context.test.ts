import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatMessage } from "@oryntra/core";
import { buildEffectiveTranscript } from "./chat-context.js";

const prior: ChatMessage[] = [
  {
    id: "chat_1",
    sessionId: "sess_test",
    role: "user",
    content:
      "I would like to add another badge to the main page, called locations",
    timestamp: "2026-06-11T20:00:00.000Z",
  },
  {
    id: "chat_2",
    sessionId: "sess_test",
    role: "agent",
    content: "I'll add that badge to the home page.",
    timestamp: "2026-06-11T20:00:01.000Z",
  },
];

test("buildEffectiveTranscript always includes prior chat when present", () => {
  const ctx = buildEffectiveTranscript({
    transcript: "make it match the other two tiles on the home screen",
    chatHistory: prior,
    artifacts: [],
  });

  assert.equal(ctx.hasConversationContext, true);
  assert.match(ctx.effectiveTranscript, /Conversation so far/i);
  assert.match(ctx.effectiveTranscript, /locations/i);
  assert.match(ctx.effectiveTranscript, /Latest message:/i);
  assert.match(ctx.effectiveTranscript, /other two tiles/i);
});

test("first message has no conversation wrapper", () => {
  const ctx = buildEffectiveTranscript({
    transcript: "Add a locations section to the home page",
    chatHistory: [],
    artifacts: [],
  });

  assert.equal(ctx.hasConversationContext, false);
  assert.equal(ctx.effectiveTranscript, "Add a locations section to the home page");
});
