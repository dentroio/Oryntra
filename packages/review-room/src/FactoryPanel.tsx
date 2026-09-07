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

  useEffect(() => {
    let cancelled = false;
    async function refreshRoster() {
      try {
        const [workRes, agentRes] = await Promise.all([
          fetch("/api/factory/live-work"),
          fetch("/api/factory/agents"),
        ]);
        if (cancelled) return;
        if (workRes.ok) {
          setLiveWork((await workRes.json()) as LiveWork[]);
        }
        if (agentRes.ok) {
          setAgents((await agentRes.json()) as FactoryAgent[]);
        }
      } catch {
        // Factory optional — scratch review still works.
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

  const otherLive = liveWork.filter((item) => item.wo !== factoryWo);
  const loadedAgents = agents.filter((a) => a.daemonLoaded);
  const talkingTo = factoryAddressedTo || factoryAgent;

  return (
    <div className="factory-panel">
      <div className="factory-panel-header">
        <span className="factory-panel-title">Factory</span>
        {factoryWo ? (
          <span className="tag factory-wo-tag">
            {talkingTo ? `${talkingTo} · ${factoryWo}` : factoryWo}
          </span>
        ) : (
          <span className="muted">Scratch review</span>
        )}
      </div>

      {factoryWo ? (
        <p className="factory-mode-hint">
          Correcting {talkingTo || "the claiming agent"} on {factoryWo}
          {factorySlug ? ` (${factorySlug})` : ""}. Pick a participant to
          address; feedback stays on this WO thread.
        </p>
      ) : (
        <p className="factory-mode-hint">
          {loadedAgents.length > 0
            ? `${loadedAgents.map((a) => a.name).join(" and ")} can claim new work. Describe a change, approve it, then Send to Factory.`
            : "No factory runner is online. You can still review locally; Send to Factory queues a WO when a runner is back."}
        </p>
      )}

      {relayWarning ? (
        <p className="factory-relay-warning" title={relayWarning}>
          Feedback relay to factory failed — review continues locally.
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

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
          {participants.length > 0 ? (
            <div className="factory-roster">
              <div className="factory-live-heading">Agents on this change</div>
              <div className="factory-roster-chips">
                {participants.map((person) => (
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
            <p className="muted">No factory thread yet — first feedback will start it.</p>
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
