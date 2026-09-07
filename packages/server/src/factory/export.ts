import type { ChangeRequest, ReviewArtifact, ReviewSession, WorkOrder } from "@oryntra/core";
import { createFactoryWo, type CreateFactoryWoInput, type CreateFactoryWoResult } from "./client.js";

const PRIORITY_MAP = {
  high: "P1",
  medium: "P2",
  low: "P3",
} as const;

function padCriteria(items: string[], fallbacks: string[]): string[] {
  const cleaned = items.map((s) => s.trim()).filter(Boolean);
  for (const extra of fallbacks) {
    if (cleaned.length >= 3) break;
    const t = extra.trim();
    if (t && !cleaned.includes(t)) cleaned.push(t);
  }
  while (cleaned.length < 3) {
    cleaned.push(`Verify the reported UI behavior after the change (${cleaned.length + 1}).`);
  }
  return cleaned.slice(0, 12);
}

export function artifactToFactoryDraft(
  artifact: ReviewArtifact,
  session: ReviewSession,
): CreateFactoryWoInput | null {
  if (artifact.kind === "change_request") {
    return changeRequestDraft(artifact, session);
  }
  if (artifact.kind === "work_order") {
    return workOrderDraft(artifact, session);
  }
  return null;
}

function changeRequestDraft(
  artifact: ChangeRequest,
  session: ReviewSession,
): CreateFactoryWoInput {
  const routes = artifact.affectedRoutes.filter(Boolean).join(", ");
  return {
    title: artifact.title,
    priority: PRIORITY_MAP[artifact.priority] ?? "P2",
    services: "frontend",
    problem: [
      artifact.userIntent,
      artifact.currentBehavior ? `Current: ${artifact.currentBehavior}` : "",
      routes ? `Routes: ${routes}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    whatToBuild: artifact.expectedBehavior,
    acceptanceCriteria: padCriteria(artifact.acceptanceCriteria, [
      artifact.expectedBehavior,
      "UI matches the attached Oryntra evidence",
    ]),
    notes: evidenceNotes(session, artifact.id),
  };
}

function workOrderDraft(artifact: WorkOrder, session: ReviewSession): CreateFactoryWoInput {
  const tasks = artifact.tasks.map((t) => `- ${t.description}`).join("\n");
  return {
    title: artifact.title,
    priority: "P2",
    services: "frontend",
    problem: artifact.summary,
    whatToBuild: tasks || artifact.summary,
    acceptanceCriteria: padCriteria(artifact.acceptanceCriteria, [
      artifact.summary,
      "All listed tasks are complete",
    ]),
    notes: evidenceNotes(session, artifact.id),
  };
}

function evidenceNotes(session: ReviewSession, artifactId: string): string {
  const parts = [
    `Exported from Oryntra session ${session.id}`,
    `artifact ${artifactId}`,
    session.appUrl ? `app ${session.appUrl}` : "",
  ];
  if (session.factoryWo) {
    parts.push(`related review thread ${session.factoryWo}`);
  }
  return parts.filter(Boolean).join(" · ");
}

export async function exportArtifactToFactory(
  artifact: ReviewArtifact,
  session: ReviewSession,
): Promise<CreateFactoryWoResult & { alreadyExported?: boolean }> {
  if ("factoryWoId" in artifact && artifact.factoryWoId) {
    return {
      ok: true,
      woId: artifact.factoryWoId,
      alreadyExported: true,
    };
  }
  const draft = artifactToFactoryDraft(artifact, session);
  if (!draft) {
    return { ok: false, error: "Only change requests and work orders can be sent to the factory" };
  }
  return createFactoryWo(draft);
}
