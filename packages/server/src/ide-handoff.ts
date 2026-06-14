import type { IdeProvider, OryntraConfig, ReviewSession } from "@oryntra/core";
import { getIdeLabel, parseIdeProvider } from "@oryntra/core";
import type { IdeRegistry } from "./ide-registry.js";

export function resolveTargetIde(
  session: ReviewSession,
  config?: OryntraConfig,
): IdeProvider {
  return (
    session.preferredIde ??
    session.ide ??
    parseIdeProvider(config?.ide?.preferred) ??
    "cursor"
  );
}

export function isTargetConnected(
  registry: IdeRegistry | undefined,
  workspacePath: string,
  provider: IdeProvider,
): boolean {
  if (!registry) return false;
  return registry.isConnected(workspacePath, provider);
}

export function buildImplementPrompt(input: {
  codeRoot: string;
  implementInWorkspace: boolean;
  worktreePath?: string;
  targetIde: IdeProvider;
}): string {
  const label = getIdeLabel(input.targetIde);
  const location = input.implementInWorkspace
    ? "This is the live dev app — changes must hot-reload in the review iframe."
    : `Use worktree: ${input.worktreePath ?? input.codeRoot}`;
  return [
    `Implement the approved Oryntra change requests (${label}).`,
    `Edit code ONLY under: ${input.codeRoot}`,
    location,
    "Read .oryntra/implement-request.json for details.",
    "When finished, set status to completed in that JSON file.",
  ].join(" ");
}

export function buildIdeHandoffHint(
  targetIde: IdeProvider,
  connected: boolean,
): string {
  const label = getIdeLabel(targetIde);
  if (connected) {
    return `Approved — ${label} should read .oryntra/implement-request.json and implement the approved changes.`;
  }
  return `Approved — connect ${label} MCP (ORYNTRA_IDE=${targetIde}) then read .oryntra/implement-request.json.`;
}

export function buildIdeFeedbackHint(targetIde: IdeProvider): string {
  const label = getIdeLabel(targetIde);
  return (
    `That command runs in ${label} chat — not here. ` +
    `Describe what you see in the app, then switch to ${label} and process Oryntra review feedback via MCP.`
  );
}
