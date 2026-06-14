#!/usr/bin/env node
/**
 * When Review Studio has pending feedback, auto-continue the Cursor agent
 * to process it via Oryntra MCP (uses IDE login — not headless CLI).
 */
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
if (input.status !== "completed") {
  console.log("{}");
  process.exit(0);
}

const loopCount = input.loop_count ?? 0;
if (loopCount >= 8) {
  console.log("{}");
  process.exit(0);
}

const baseUrl = process.env.ORYNTRA_URL ?? "http://127.0.0.1:4317";

try {
  const activeRes = await fetch(`${baseUrl}/api/sessions/active`);
  if (!activeRes.ok) {
    console.log("{}");
    process.exit(0);
  }
  const session = await activeRes.json();
  const pendingRes = await fetch(
    `${baseUrl}/api/sessions/${session.id}/pending-feedback`,
  );
  if (!pendingRes.ok) {
    console.log("{}");
    process.exit(0);
  }
  const pending = await pendingRes.json();
  if (!Array.isArray(pending) || pending.length === 0) {
    console.log("{}");
    process.exit(0);
  }

  const latest = pending[pending.length - 1];
  const preview = (latest.transcript ?? "new feedback").slice(0, 140);
  console.log(
    JSON.stringify({
      followup_message: `Review Studio feedback is waiting: "${preview}". Use Oryntra MCP process_pending_review (session ${session.id}), then submit_review_response with a short conversational reply and a change_request draft when appropriate.`,
    }),
  );
} catch {
  console.log("{}");
}
