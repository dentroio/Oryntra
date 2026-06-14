export {
  createSessionWorktree,
  getCurrentBranch,
  getGitRoot,
  getWorktreeStatus,
  isGitRepository,
  type WorktreeInfo,
  type WorktreeStatus,
} from "./git.js";
export {
  applyDocUpdate,
  buildExecutionPlan,
  resolveWorktreePath,
  type ExecutionPlan,
} from "./apply.js";
export { applyPatch, proposePatch } from "./patch.js";
