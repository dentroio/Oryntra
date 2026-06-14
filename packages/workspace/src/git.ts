import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type WorktreeInfo = {
  branchName: string;
  worktreePath: string;
  baseBranch: string;
};

export type WorktreeStatus = {
  branchName: string;
  worktreePath: string;
  exists: boolean;
  clean: boolean;
  ahead: number;
  behind: number;
};

export async function isGitRepository(workspacePath: string): Promise<boolean> {
  try {
    await exec("git", ["-C", workspacePath, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

export async function getGitRoot(workspacePath: string): Promise<string> {
  const { stdout } = await exec("git", [
    "-C",
    workspacePath,
    "rev-parse",
    "--show-toplevel",
  ]);
  return stdout.trim();
}

export async function getCurrentBranch(workspacePath: string): Promise<string> {
  const { stdout } = await exec("git", [
    "-C",
    workspacePath,
    "rev-parse",
    "--abbrev-ref",
    "HEAD",
  ]);
  return stdout.trim();
}

export async function createSessionWorktree(options: {
  workspacePath: string;
  sessionId: string;
}): Promise<WorktreeInfo> {
  const { workspacePath, sessionId } = options;
  const baseBranch = await getCurrentBranch(workspacePath);
  const branchName = `oryntra/${sessionId}`;
  const worktreeRoot = join(workspacePath, ".oryntra", "worktrees");
  const worktreePath = join(worktreeRoot, sessionId);

  await mkdir(worktreeRoot, { recursive: true });

  try {
    await exec("git", [
      "-C",
      workspacePath,
      "worktree",
      "add",
      "-B",
      branchName,
      worktreePath,
      baseBranch,
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("already exists")) {
      throw error;
    }
  }

  return { branchName, worktreePath, baseBranch };
}

export async function getWorktreeStatus(
  workspacePath: string,
  worktreePath: string,
  branchName: string,
): Promise<WorktreeStatus> {
  const exists = await isGitRepository(worktreePath).catch(() => false);
  if (!exists) {
    return {
      branchName,
      worktreePath,
      exists: false,
      clean: true,
      ahead: 0,
      behind: 0,
    };
  }

  const { stdout: statusOut } = await exec("git", [
    "-C",
    worktreePath,
    "status",
    "--porcelain",
  ]);
  const clean = statusOut.trim().length === 0;

  let ahead = 0;
  let behind = 0;
  try {
    const baseBranch = await getCurrentBranch(workspacePath);
    const { stdout: countOut } = await exec("git", [
      "-C",
      worktreePath,
      "rev-list",
      "--left-right",
      "--count",
      `${baseBranch}...${branchName}`,
    ]);
    const [behindStr, aheadStr] = countOut.trim().split(/\s+/);
    behind = Number(behindStr ?? 0);
    ahead = Number(aheadStr ?? 0);
  } catch {
    // branch may not have upstream yet
  }

  return {
    branchName,
    worktreePath,
    exists: true,
    clean,
    ahead,
    behind,
  };
}
