import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  detectActiveWo,
  getThreadMessages,
  postThreadMessage,
} from "./client.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    return handler(String(input), init);
  }) as typeof fetch;
}

test("detectActiveWo picks the most recently claimed active-status WO", async () => {
  mockFetch(() =>
    Response.json({
      "WO-1": { wo: "WO-1", status: "complete", claimed_at: "2026-08-01T00:00:00Z" },
      "WO-2": { wo: "WO-2", status: "in_progress", claimed_at: "2026-08-01T00:10:00Z" },
      "WO-3": { wo: "WO-3", status: "claimed", claimed_at: "2026-08-01T00:05:00Z" },
    }),
  );
  const wo = await detectActiveWo();
  assert.equal(wo, "WO-2");
});

test("detectActiveWo returns null when nothing is active", async () => {
  mockFetch(() =>
    Response.json({
      "WO-1": { wo: "WO-1", status: "complete", claimed_at: "2026-08-01T00:00:00Z" },
    }),
  );
  const wo = await detectActiveWo();
  assert.equal(wo, null);
});

test("detectActiveWo returns null (not throws) when the factory is unreachable", async () => {
  mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const wo = await detectActiveWo();
  assert.equal(wo, null);
});

test("postThreadMessage rewrites orchestrator-relative image_url to the status-site proxy route", async () => {
  mockFetch((url) => {
    assert.match(url, /\/api\/proxy\/thread\/WO-9\/messages$/);
    return Response.json({
      id: "msg_1",
      image_url: "/api/thread/WO-9/images/20260101.png",
    });
  });
  const result = await postThreadMessage("WO-9", {
    content: "test",
    author: "oryntra-reviewer",
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.imageUrl,
    "http://localhost:8099/api/proxy/thread/WO-9/images/20260101.png",
  );
});

test("postThreadMessage never throws on network failure — returns ok:false", async () => {
  mockFetch(() => {
    throw new TypeError("fetch failed");
  });
  const result = await postThreadMessage("WO-9", {
    content: "test",
    author: "oryntra-reviewer",
  });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test("postThreadMessage surfaces non-2xx responses as ok:false, not a thrown error", async () => {
  mockFetch(() => new Response("server error", { status: 500 }));
  const result = await postThreadMessage("WO-9", {
    content: "test",
    author: "oryntra-reviewer",
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /500/);
});

test("getThreadMessages rewrites image_url on every message and never throws", async () => {
  mockFetch(() =>
    Response.json([
      { id: "m1", author: "agent", role: "agent", type: "text", content: "hi" },
      {
        id: "m2",
        author: "agent",
        role: "agent",
        type: "image",
        content: "",
        image_url: "/api/thread/WO-9/images/x.png",
      },
    ]),
  );
  const messages = await getThreadMessages("WO-9");
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.image_url, undefined);
  assert.equal(
    messages[1]?.image_url,
    "http://localhost:8099/api/proxy/thread/WO-9/images/x.png",
  );
});

test("getThreadMessages returns [] (not throws) on failure", async () => {
  mockFetch(() => new Response("nope", { status: 503 }));
  const messages = await getThreadMessages("WO-9");
  assert.deepEqual(messages, []);
});
