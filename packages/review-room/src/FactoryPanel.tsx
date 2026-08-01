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

type Props = {
  sessionId: string;
  factoryWo: string | null | undefined;
  relayWarning: string | null;
  onBindingChanged: (wo: string | null) => void;
};

const POLL_MS = 5000;

export function FactoryPanel({
  sessionId,
  factoryWo,
  relayWarning,
  onBindingChanged,
}: Props) {
  const [manualWo, setManualWo] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [binding, setBinding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<FactoryThreadMessage[]>([]);
  const [expanded, setExpanded] = useState(false);
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
      onBindingChanged(wo);
      setManualWo("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bind failed");
    } finally {
      setBinding(false);
    }
  }

  async function autoDetect() {
    setDetecting(true);
    setError(null);
    try {
      const res = await fetch("/api/factory/detect-active-wo");
      const body = (await res.json()) as { wo: string | null };
      if (!body.wo) {
        setError("No active WO found on the factory right now.");
        return;
      }
      await bind(body.wo);
    } catch {
      setError("Could not reach the factory.");
    } finally {
      setDetecting(false);
    }
  }

  // Read path: poll the bound WO's thread for agent replies (WO-1047).
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
        setMessages((prev) => [...prev, ...fresh].slice(-50));
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

  const agentReplies = messages.filter((m) => m.role !== "human");

  return (
    <div className="factory-panel">
      <div className="factory-panel-header">
        <span className="factory-panel-title">Factory</span>
        {factoryWo ? (
          <span className="tag factory-wo-tag">{factoryWo}</span>
        ) : (
          <span className="muted">Not bound</span>
        )}
      </div>

      {relayWarning ? (
        <p className="factory-relay-warning" title={relayWarning}>
          ⚠ Feedback relay to factory failed — review continues locally.
        </p>
      ) : null}

      {error ? <p className="error-text">{error}</p> : null}

      {!factoryWo ? (
        <div className="factory-bind-form">
          <button
            type="button"
            className="secondary"
            disabled={detecting || binding}
            onClick={() => void autoDetect()}
          >
            {detecting ? "Detecting…" : "Auto-detect"}
          </button>
          <div className="factory-bind-manual">
            <input
              type="text"
              placeholder="WO-1047"
              value={manualWo}
              onChange={(e) => setManualWo(e.target.value)}
              disabled={binding}
            />
            <button
              type="button"
              disabled={!manualWo.trim() || binding}
              onClick={() => void bind(manualWo.trim())}
            >
              Bind
            </button>
          </div>
        </div>
      ) : (
        <div className="factory-bound">
          <button
            type="button"
            className="secondary factory-unbind-btn"
            disabled={binding}
            onClick={() => void bind(null)}
          >
            Unbind
          </button>

          {agentReplies.length > 0 ? (
            <div className="factory-agent-strip">
              <button
                type="button"
                className="factory-agent-strip-toggle"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded ? "▾" : "▸"} Agent replies ({agentReplies.length})
              </button>
              {expanded ? (
                <ul className="factory-agent-strip-list">
                  {agentReplies.slice(-10).map((m, i) => (
                    <li key={m.id ?? i}>
                      <span className="factory-agent-strip-author">{m.author}:</span>{" "}
                      {m.type === "image" && m.image_url ? (
                        <img src={m.image_url} alt="" className="factory-agent-strip-image" />
                      ) : (
                        m.content
                      )}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
