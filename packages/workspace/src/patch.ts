import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createId } from "@oryntra/core";
import type { ChangeRequest, ProposedPatch, PatchResult } from "@oryntra/core";
import { resolveWorktreePath } from "./apply.js";

export function proposePatch(
  changeRequest: ChangeRequest,
  worktreePath: string,
): ProposedPatch {
  const hunks: ProposedPatch["hunks"] = [];

  for (const ref of changeRequest.affectedComponents ?? []) {
    if (!ref.filePath) continue;
    hunks.push({
      filePath: ref.filePath,
      startLine: ref.lineStart ?? 1,
      endLine: ref.lineEnd ?? ref.lineStart ?? 1,
      replacement: [
        `// Oryntra change request: ${changeRequest.title}`,
        `// Expected: ${changeRequest.expectedBehavior}`,
        `// TODO: implement — ${changeRequest.userIntent}`,
      ].join("\n"),
    });
  }

  if (hunks.length === 0) {
    const notesPath = `.oryntra/patches/${changeRequest.id}.md`;
    hunks.push({
      filePath: notesPath,
      startLine: 1,
      endLine: 1,
      replacement: [
        `# ${changeRequest.title}`,
        "",
        `**Current:** ${changeRequest.currentBehavior}`,
        "",
        `**Expected:** ${changeRequest.expectedBehavior}`,
        "",
        `**Intent:** ${changeRequest.userIntent}`,
        "",
        "## Acceptance criteria",
        ...changeRequest.acceptanceCriteria.map((c) => `- ${c}`),
        "",
        "## Affected routes",
        ...changeRequest.affectedRoutes.map((r) => `- ${r}`),
      ].join("\n"),
    });
  }

  return {
    id: createId("patch"),
    sessionId: changeRequest.sessionId,
    artifactId: changeRequest.id,
    title: changeRequest.title,
    hunks,
    status: "draft",
  };
}

export async function applyPatch(
  worktreePath: string,
  patch: ProposedPatch,
): Promise<PatchResult> {
  const appliedFiles: string[] = [];
  const failedFiles: Array<{ filePath: string; error: string }> = [];

  for (const hunk of patch.hunks) {
    try {
      const targetPath = resolveWorktreePath(worktreePath, hunk.filePath);
      await mkdir(dirname(targetPath), { recursive: true });

      let lines: string[] = [];
      try {
        lines = (await readFile(targetPath, "utf8")).split("\n");
      } catch {
        lines = [];
      }

      const start = Math.max(1, hunk.startLine);
      const end = Math.max(start, hunk.endLine);
      const before = lines.slice(0, start - 1);
      const after = lines.slice(end);
      const next = [...before, ...hunk.replacement.split("\n"), ...after].join(
        "\n",
      );
      await writeFile(targetPath, next.endsWith("\n") ? next : `${next}\n`, "utf8");
      appliedFiles.push(hunk.filePath);
    } catch (error) {
      failedFiles.push({
        filePath: hunk.filePath,
        error: error instanceof Error ? error.message : "Apply failed",
      });
    }
  }

  return {
    patchId: patch.id,
    appliedFiles,
    failedFiles: failedFiles.length ? failedFiles : undefined,
  };
}
