import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DocUpdate } from "@oryntra/core";
import { applyDocUpdate } from "./apply.js";

test("applyDocUpdate creates and appends doc files in worktree", async () => {
  const worktree = await mkdtemp(join(tmpdir(), "oryntra-wt-"));
  try {
    const update: DocUpdate = {
      kind: "doc_update",
      id: "doc_1",
      sessionId: "sess_1",
      targetPath: "docs/note.md",
      summary: "Add note",
      proposedContent: "## Finding\n\nDrawer should overlay.",
      feedbackMomentIds: [],
      status: "approved",
    };

    const created = await applyDocUpdate(worktree, update);
    assert.equal(created.mode, "created");
    const first = await readFile(join(worktree, "docs/note.md"), "utf8");
    assert.match(first, /Drawer should overlay/);

    const appended = await applyDocUpdate(worktree, {
      ...update,
      proposedContent: "## Follow-up\n\nAdd test.",
    });
    assert.equal(appended.mode, "appended");
    const second = await readFile(join(worktree, "docs/note.md"), "utf8");
    assert.match(second, /Add test/);
  } finally {
    await rm(worktree, { recursive: true, force: true });
  }
});
