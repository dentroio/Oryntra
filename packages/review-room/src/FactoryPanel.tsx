import { useEffect, useState } from "react";

type FactoryThreadMessage = {
  id?: string;
  author: string;
  role: string;
  type: "text" | "image";
  content: string;
  image_url?: string;
  timestamp?: string;
};

type FactoryParticipant = {
  name: string;
  role: "implementer" | "reviewer" | "agent" | "human" | "system";
};

type LiveWork = {
  wo: string;
  status: string;
  agent: string;
  backend: string;
  slug: string;
  step: string;
  prUrl: string;
  claimedAt: string | null;
};

type FactoryAgent = {
  name: string;
  domainFilter: string;
  daemonLoaded: boolean;
  cliDetected?: boolean;
};

type Props = {
  sessionId: string;
  factoryWo: string | null | undefined;
  factoryAgent?: string | null;
  factorySlug?: string | null;
  factoryAddressedTo?: string | null;
  relayWarning: string | null;
  onBindingChanged: (binding: {
    factoryWo: string | null;
    factoryAgent?: string | null;
    factoryBackend?: string | null;
    factorySlug?: string | null;
    factoryAddressedTo?: string | null;
  }) => void;
};

const POLL_MS = 5000;

function runnerName(name: string): string {
  return name.replace(/-runner$/i, "");
}

function statusPhrase(status: string | null | undefined): string {
  const raw = (status || "").replace(/_/g, " ");
  if (raw === "in progress") return "in progress";
  if (raw === "awaiting human") return "awaiting review";
  if (raw === "awaiting commit") return "awaiting commit";
  if (raw === "claimed") return "claimed";
  return raw || "queued";
}

function labelForWork(item: LiveWork): string {
  const agent = item.agent || "unclaimed";
  const slug = item.slug ? ` · ${item.slug}` : "";
  return `${agent} · ${item.wo}${slug}`;
}

export function FactoryPanel({
  sessionId,
  factoryWo,
  factoryAgent,
  factorySlug,
  factoryAddressedTo,
  relayWarning,
  onBindingChanged,
}: Props) {
  const [manualWo, setManualWo] = useState("");
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveWork, setLiveWork] = useState<LiveWork[]>([]);
  const [agents, setAgents] = useState<FactoryAgent[]>([]);
  const [messages, setMessages] = useState<FactoryThreadMessage[]>([]);
  const [participants, setParticipants] = useState<FactoryParticipant[]>([]);
  const [threadOpen, setThreadOpen] = useState(true);
  const [factoryOk, setFactoryOk] = useState(true);
  const [validationQueue, setValidationQueue] = useState<LiveWork[]>([]);
  const [rejectNotes, setRejectNotes] = useState("");
  const [verdictBusy, setVerdictBusy] = useState(false);

  async function bind(wo: string | null) {
    setBinding(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/factory-wo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wo }),
      });
      if (!res.ok) throw new Error("Bind failed");
      const session = (await res.json()) as {
        factoryWo?: string | null;
        factoryAgent?: string | null;
        factoryBackend?: string | null;
        factorySlug?: string | null;
        factoryAddressedTo?: string | null;
      };
      onBindingChanged({
        factoryWo: session.factoryWo ?? wo,
        factoryAgent: session.factoryAgent ?? null,
        factoryBackend: session.factoryBackend ?? null,
        factorySlug: session.factorySlug ?? null,
        factoryAddressedTo: session.factoryAddressedTo ?? null,
      });
      setManualWo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bind failed");
    } finally {
      setBinding(false);
    }
  }

  async function submitVerdict(verdict: "approve" | "reject") {
    if (!factoryWo) return;
    if (verdict === "reject" && !rejectNotes.trim()) {
      setError("A reject note is required.");
      return;
    }
    setVerdictBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/factory-validations/${encodeURIComponent(factoryWo)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verdict,
            notes: rejectNotes.trim(),
          }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || "Verdict failed");
      setRejectNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verdict failed");
    } finally {
      setVerdictBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function refreshRoster() {
      try {
        const [workRes, agentRes, queueRes] = await Promise.all([
          fetch("/api/factory/live-work"),
          fetch("/api/factory/agents"),
          fetch("/api/factory/validations"),
        ]);
        if (cancelled) return;
        if (workRes.ok) {
          setLiveWork((await workRes.json()) as LiveWork[]);
        }
        if (agentRes.ok) {
          setAgents((await agentRes.json()) as FactoryAgent[]);
        }
        if (queueRes.ok) {
          const body = (await queueRes.json()) as {
            factoryOk?: boolean;
            items?: LiveWork[];
          };
          setFactoryOk(body.factoryOk !== false);
          setValidationQueue(body.items ?? []);
        } else {
          setFactoryOk(false);
        }
      } catch {
        if (!cancelled) setFactoryOk(false);
      }
    }
    void refreshRoster();
    const interval = setInterval(() => void refreshRoster(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  async function address(agent: string) {
    try {
      const res = await fetch(`/api/sessions/${sessionId}/factory-address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agent }),
      });
      if (!res.ok) return;
      const session = (await res.json()) as { factoryAddressedTo?: string | null };
      onBindingChanged({
        factoryWo: factoryWo ?? null,
        factoryAgent,
        factorySlug,
        factoryAddressedTo: session.factoryAddressedTo ?? agent,
      });
    } catch {
      // Keep local review usable if the factory address call fails.
    }
  }

  useEffect(() => {
    setMessages([]);
    setParticipants([]);
    if (!factoryWo || !sessionId) return;

    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/factory-context`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          thread?: FactoryThreadMessage[];
          participants?: FactoryParticipant[];
        };
        if (cancelled) return;
        setMessages((body.thread ?? []).slice(-80));
        setParticipants(body.participants ?? []);
      } catch {
        // Transient — next poll tick will retry.
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId, factoryWo]);

  const boundLive = liveWork.find((item) => item.wo === factoryWo);
  const otherLive = liveWork.filter(
    (item) => item.wo !== factoryWo && item.status !== "awaiting_human",
  );
  const loadedAgents = agents.filter((a) => a.daemonLoaded || a.cliDetected);
  const runnerList =
    loadedAgents.map((a) => a.name).join(", ") ||
    "claude, cursor, codex, or gemini";
  const talkingTo = factoryAddressedTo || factoryAgent;
  const claimed = Boolean(boundLive?.status && boundLive.status !== "queued");
  const roster = (() => {
    const byName = new Map<string, FactoryParticipant>();
    for (const person of participants) byName.set(person.name, person);
    if (factoryAgent && !byName.has(factoryAgent)) {
      byName.set(factoryAgent, { name: factoryAgent, role: "implementer" });
    }
    if (factoryAddressedTo && !byName.has(factoryAddressedTo)) {
      byName.set(factoryAddressedTo, { name: factoryAddressedTo, role: "agent" });
    }
    for (const agent of loadedAgents) {
      if (!byName.has(agent.name)) {
        byName.set(agent.name, { name: agent.name, role: "agent" });
      }
    }
    return [...byName.values()];
  })();

  return (
    <div className="factory-panel">
      <div className="factory-panel-header">
        <span className="factory-panel-title">Factory</span>
        {factoryWo ? (
          <span className="tag factory-wo-tag">
            {claimed && talkingTo
              ? `${runnerName(talkingTo)} · ${factoryWo}`
              : `${factoryWo} · queued`}
          </span>
        ) : (
          <span className="muted">Scratch review</span>
        )}
      </div>

      {factoryWo ? (
        <>
        <p className="factory-mode-hint">
          Bound to {factoryWo}
          {factorySlug ? ` (${factorySlug})` : ""}. Send talks to Oryntra
          (thread is memory only). Post note steers{" "}
          {talkingTo ? runnerName(talkingTo) : "whoever claims it"} without
          interrupting this pass.
        </p>
        <p className="factory-progress">
          {claimed && boundLive ? (
            <>
              {statusPhrase(boundLive.status)}
              {boundLive.step ? ` · ${boundLive.step}` : ""}
              {boundLive.prUrl ? (
                <>
                  {" · "}
                  <a
                    href={boundLive.prUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    PR
                  </a>
                </>
              ) : null}
              . Notes won&apos;t interrupt.
            </>
          ) : (
            <>Waiting for an idle runner ({runnerList}).</>
          )}
        </p>
        </>
      ) : (
        <p className="factory-mode-hint">
          {loadedAgents.length > 0
            ? `${loadedAgents.map((a) => a.name).join(" and ")} can claim new work. Describe a change, approve it, then Send to Factory.`
            : "No factory runner is online. You can still review locally; Send to Factory queues a WO when a runner is back."}
        </p>
      )}

      {relayWarning ? (
        <p className="factory-relay-warning" title={relayWarning}>
          Feedback note failed to reach the factory thread — review continues locally.
        </p>
      ) : null}

      {!factoryOk ? (
        <p className="factory-offline">Factory is offline — validation queue unavailable.</p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {validationQueue.length > 0 ? (
        <div className="factory-live-list">
          <div className="factory-live-heading">Awaiting your review</div>
          {validationQueue.map((item) => (
            <button
              key={item.wo}
              type="button"
              className={`factory-live-item${
                item.wo === factoryWo ? " factory-live-item-bound" : ""
              }`}
              disabled={binding}
              onClick={() => void bind(item.wo)}
            >
              <span className="factory-live-label">{labelForWork(item)}</span>
              <span className="muted">awaiting_human</span>
            </button>
          ))}
        </div>
      ) : null}

      {otherLive.length > 0 ? (
        <div className="factory-live-list">
          <div className="factory-live-heading">Live agents</div>
          {otherLive.map((item) => (
            <button
              key={item.wo}
              type="button"
              className="factory-live-item"
              disabled={binding}
              onClick={() => void bind(item.wo)}
            >
              <span className="factory-live-label">{labelForWork(item)}</span>
              <span className="muted">{item.status}</span>
            </button>
          ))}
        </div>
      ) : loadedAgents.length > 0 && !factoryWo ? (
        <div className="factory-roster">
          <div className="factory-live-heading">Available for new updates</div>
          <div className="factory-roster-chips">
            {loadedAgents.map((agent) => (
              <span key={agent.name} className="factory-roster-chip idle">
                {agent.name}
                <span className="muted"> idle</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {factoryWo ? (
        <div className="factory-bound">
          {roster.length > 0 ? (
            <div className="factory-roster">
              <div className="factory-live-heading">Agents on this change</div>
              <div className="factory-roster-chips">
                {roster.map((person) => (
                  <button
                    key={person.name}
                    type="button"
                    className={`factory-roster-chip${
                      talkingTo === person.name ? " active" : ""
                    }`}
                    disabled={binding}
                    onClick={() => void address(person.name)}
                  >
                    {person.name}
                    <span className="muted"> {person.role}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <button
            type="button"
            className="secondary factory-unbind-btn"
            disabled={binding}
            onClick={() => void bind(null)}
          >
            Unbind — scratch review
          </button>

          {validationQueue.some((item) => item.wo === factoryWo) ? (
            <div className="factory-verdict">
              <p className="factory-mode-hint">
                Inspect with Send. Post note to add evidence, then approve or
                reject. Reject requires a note on the WO thread.
              </p>
              <textarea
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                rows={2}
                placeholder="Reject note (required to reject)"
                disabled={verdictBusy}
              />
              <div className="factory-verdict-actions">
                <button
                  type="button"
                  className="primary"
                  disabled={verdictBusy}
                  onClick={() => void submitVerdict("approve")}
                >
                  Approve WO
                </button>
                <button
                  type="button"
                  disabled={verdictBusy}
                  onClick={() => void submitVerdict("reject")}
                >
                  Reject
                </button>
              </div>
            </div>
          ) : null}

          {messages.length > 0 ? (
            <div className="factory-agent-strip">
              <button
                type="button"
                className="factory-agent-strip-toggle"
                onClick={() => setThreadOpen((v) => !v)}
                aria-expanded={threadOpen}
              >
                {threadOpen ? "▾" : "▸"} Agent memory ({messages.length})
              </button>
              {threadOpen ? (
                <ul className="factory-agent-strip-list">
                  {messages.slice(-20).map((m, i) => (
                    <li key={m.id ?? i}>
                      <span className="factory-agent-strip-author">
                        {m.author || m.role}:
                      </span>{" "}
                      {m.type === "image" && m.image_url ? (
                        <img
                          src={m.image_url}
                          alt=""
                          className="factory-agent-strip-image"
                        />
                      ) : (
                        m.content
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="muted">
              No factory thread yet — Post note to steer whoever claims this WO
              (claude, cursor, codex, or gemini).
            </p>
          )}
        </div>
      ) : (
        <div className="factory-bind-form">
          <div className="factory-bind-manual">
            <input
              type="text"
              placeholder="WO-1080"
              value={manualWo}
              onChange={(e) => setManualWo(e.target.value)}
              disabled={binding}
            />
            <button
              type="button"
              disabled={!manualWo.trim() || binding}
              onClick={() => void bind(manualWo.trim())}
            >
              Bind WO
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
