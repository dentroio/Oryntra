import { useState } from "react";
import type { ReviewArtifact, ArtifactStatus } from "@oryntra/core";

type Props = {
  sessionId: string;
  artifacts: ReviewArtifact[];
  onArtifactUpdated: (artifact: ReviewArtifact) => void;
  onImplementStarted?: () => void;
};

type ApproveResult = {
  artifact: ReviewArtifact;
  autoImplement?: { started: boolean; reason?: string };
};

export function ArtifactsPanel({
  sessionId,
  artifacts,
  onArtifactUpdated,
  onImplementStarted,
}: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function updateStatus(artifact: ReviewArtifact, status: ArtifactStatus) {
    setBusyId(artifact.id);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/artifacts/${artifact.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Update failed");
      }
      const data = (await res.json()) as ApproveResult;
      onArtifactUpdated(data.artifact);
      if (status === "approved" && data.autoImplement?.started) {
        onImplementStarted?.();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  }

  if (artifacts.length === 0) {
    return (
      <p className="muted">
        Send feedback in the Chat tab — you'll get a summary here, then a change
        request to approve.
      </p>
    );
  }

  const draftCount = artifacts.filter(
    (a) => a.status === "draft" || a.status === "needs-clarification",
  ).length;

  return (
    <div>
      {draftCount > 0 ? (
        <p className="muted artifact-hint">
          Approve when the understanding looks right — Cursor implements and the
          live app updates.
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {artifacts.map((artifact) => (
        <div key={artifact.id} className="artifact-card">
          <div className="artifact-header">
            <span className="tag">{artifact.kind}</span>
            <span className={`tag status-${artifact.status}`}>
              {artifact.status}
            </span>
          </div>
          <div>
            <strong>
              {"title" in artifact
                ? artifact.title
                : "summary" in artifact
                  ? artifact.summary
                  : artifact.kind}
            </strong>
          </div>
          <div className="muted artifact-body">
            {"userIntent" in artifact ? artifact.userIntent : null}
            {"expectedBehavior" in artifact && artifact.kind === "change_request"
              ? `Expected: ${artifact.expectedBehavior}`
              : null}
          </div>
          {artifact.status === "draft" ||
          artifact.status === "needs-clarification" ? (
            <div className="artifact-buttons">
              <button
                type="button"
                disabled={busyId === artifact.id}
                onClick={() => void updateStatus(artifact, "approved")}
              >
                Approve & implement
              </button>
              <button
                type="button"
                className="danger"
                disabled={busyId === artifact.id}
                onClick={() => void updateStatus(artifact, "rejected")}
              >
                Reject
              </button>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
