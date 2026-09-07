import { useEffect, useRef, useState } from "react";

type FactoryThreadMessage = {
  id?: string;
  author: string;
  role: string;
  type: "text" | "image";
  content: string;
  image_url?: string;
  timestamp?: string;
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
  relayWarning: string | null;
  onBindingChanged: (binding: {
    factoryWo: string | null;
    factoryAgent?: string | null;
    factoryBackend?: string | null;
    factorySlug?: string | null;
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
  relayWarning,
  onBindingChanged,
}: Props) {
  const [manualWo, setManualWo] = useState("");
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [liveWork, setLiveWork] = useState<LiveWork[]>([]);
  const [agents, setAgents] = useState<FactoryAgent[]>([]);
  const [messages, setMessages] = useState<FactoryThreadMessage[]>([]);
  const [threadOpen, setThreadOpen] = useState(true);
  const sinceRef = useRef<string | undefined>(undefined);

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
      };
      onBindingChanged({
        factoryWo: session.factoryWo ?? wo,
        factoryAgent: session.factoryAgent ?? null,
        factoryBackend: session.factoryBackend ?? null,
        factorySlug: session.factorySlug ?? null,
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

  useEffect(() => {
    sinceRef.current = undefined;
    setMessages([]);
    if (!factoryWo) return;

    let cancelled = false;
    async function poll() {
      try {
        const url = new URL(
          `/api/sessions/${sessionId}/factory-thread`,
          window.location.origin,
        );
        if (sinceRef.current) url.searchParams.set("since", sinceRef.current);
        const res = await fetch(url);
        if (!res.ok || cancelled) return;
        const fresh = (await res.json()) as FactoryThreadMessage[];
        if (fresh.length === 0 || cancelled) return;
        sinceRef.current = fresh[fresh.length - 1]?.id ?? sinceRef.current;
        setMessages((prev) => [...prev, ...fresh].slice(-80));
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

  return (
    <div className="factory-panel">
      <div className="factory-panel-header">
        <span className="factory-panel-title">Factory</span>
        {factoryWo ? (
          <span className="tag factory-wo-tag">
            {factoryAgent ? `${factoryAgent} · ${factoryWo}` : factoryWo}
          </span>
        ) : (
          <span className="muted">Scratch review</span>
        )}
      </div>

      {factoryWo ? (
        <p className="factory-mode-hint">
          Talking to {factoryAgent || "the claiming agent"} on {factoryWo}
          {factorySlug ? ` (${factorySlug})` : ""}. Feedback and screenshots go
          into that thread — existing memory stays.
        </p>
      ) : (
        <p className="factory-mode-hint">
          Not bound to a factory agent. Describe or correct anything. Approve a
          change, then Send to Factory to queue a new WO.
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
        <p className="muted factory-empty-live">
          {loadedAgents.map((a) => a.name).join(", ")} online, none currently
          claimed on a WO.
        </p>
      ) : null}

      {factoryWo ? (
        <div className="factory-bound">
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
