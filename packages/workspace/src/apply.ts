import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { ChangeRequest, DocUpdate, WorkOrder } from "@oryntra/core";

export function resolveWorktreePath(
  worktreePath: string,
  relativePath: string,
): string {
  const full = resolve(worktreePath, relativePath);
  const root = resolve(worktreePath);
  if (!full.startsWith(root)) {
    throw new Error(`Path escapes worktree: ${relativePath}`);
  }
  return full;
}

export async function applyDocUpdate(
  worktreePath: string,
  update: DocUpdate,
): Promise<{ targetPath: string; mode: "created" | "appended" }> {
  if (!update.targetPath) {
    throw new Error("Doc update missing targetPath");
  }
  const targetPath = resolveWorktreePath(worktreePath, update.targetPath);
  await mkdir(dirname(targetPath), { recursive: true });

  try {
    const existing = await readFile(targetPath, "utf8");
    await appendFile(
      targetPath,
      `\n\n${update.proposedContent.trim()}\n`,
      "utf8",
    );
    return { targetPath: update.targetPath, mode: "appended" };
  } catch {
    await writeFile(targetPath, `${update.proposedContent.trim()}\n`, "utf8");
    return { targetPath: update.targetPath, mode: "created" };
  }
}

export type ExecutionPlan = {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  tasks: Array<{
    artifactId: string;
    type: string;
    description: string;
    targetPath?: string;
    status: "pending";
  }>;
};

export function buildExecutionPlan(input: {
  sessionId: string;
  worktreePath: string;
  branchName: string;
  workOrders: WorkOrder[];
  docUpdates: DocUpdate[];
  changeRequests?: ChangeRequest[];
}): ExecutionPlan {
  const tasks: ExecutionPlan["tasks"] = [];

  for (const order of input.workOrders) {
    for (const task of order.tasks) {
      tasks.push({
        artifactId: order.id,
        type: task.type,
        description: task.description,
        targetPath: task.targetPath,
        status: "pending",
      });
    }
  }

  for (const doc of input.docUpdates) {
    tasks.push({
      artifactId: doc.id,
      type: "doc",
      description: doc.summary,
      targetPath: doc.targetPath,
      status: "pending",
    });
  }

  for (const change of input.changeRequests ?? []) {
    tasks.push({
      artifactId: change.id,
      type: "code",
      description: `${change.title}: ${change.expectedBehavior}`,
      targetPath: change.affectedComponents?.[0]?.filePath,
      status: "pending",
    });
  }

  return {
    sessionId: input.sessionId,
    worktreePath: input.worktreePath,
    branchName: input.branchName,
    tasks,
  };
}
