import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveOryntraConfig } from "@oryntra/core";

test("lifts agent settings nested under review in yaml", () => {
  const config = resolveOryntraConfig({
    review: {
      author: "steve",
      facilitatorProvider: "ide",
      autoImplementOnApprove: false,
      cursorAgent: false,
    } as never,
  });
  assert.equal(config.review?.author, "steve");
  assert.equal(config.agent?.facilitatorProvider, "ide");
  assert.equal(config.agent?.autoImplementOnApprove, false);
  assert.equal(config.agent?.cursorAgent, false);
});

test("explicit agent block wins over misplaced review keys", () => {
  const config = resolveOryntraConfig({
    agent: { autoImplementOnApprove: true },
    review: { autoImplementOnApprove: false } as never,
  });
  assert.equal(config.agent?.autoImplementOnApprove, true);
});
