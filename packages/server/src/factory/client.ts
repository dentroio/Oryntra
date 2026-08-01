/**
 * Factory API client — talks to the agentic-factory status site, which proxies
 * auth to the orchestrator so Oryntra needs no factory credentials of its own.
 * See docs/ORYNTRA_FACTORY_INTEGRATION.md (agentic-factory repo) / WO-1047.
 */

const DEFAULT_FACTORY_URL = "http://localhost:8099";

export type FactoryDispatchStatus =
  | "claimed"
  | "in_progress"
  | "awaiting_human"
  | "awaiting_commit"
  | "complete"
  | string;

export type FactoryDispatchEntry = {
  wo: string;
  status: FactoryDispatchStatus;
  claimed_at?: string | null;
  [key: string]: unknown;
};

/** Flat map { wo_id: entry } — there is no `dispatch_state` wrapper. That
 *  shape existed in an earlier factory version and is dead; do not reference it. */
export type FactoryDispatchMap = Record<string, FactoryDispatchEntry>;

export type FactoryThreadMessage = {
  id?: string;
  author: string;
  role: string;
  type: "text" | "image";
  content: string;
  image_url?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  [key: string]: unknown;
};

export type PostThreadMessageInput = {
  content: string;
  author: string;
  imageBase64?: string;
  sourceUrl?: string;
};

function factoryUrl(override?: string | null): string {
  return override || process.env.ORYNTRA_FACTORY_URL || DEFAULT_FACTORY_URL;
}

const ACTIVE_STATUSES: ReadonlySet<FactoryDispatchStatus> = new Set([
  "claimed",
  "in_progress",
  "awaiting_human",
]);

/**
 * Best-effort detection of the WO currently being worked, for the
 * session-binding "Auto-detect" action. Returns null on any failure — callers
 * fall back to manual entry, never block on this.
 */
export async function detectActiveWo(
  factoryUrlOverride?: string | null,
): Promise<string | null> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/dispatch`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const dispatch = (await res.json()) as FactoryDispatchMap;

    let best: { wo: string; claimedAt: number } | null = null;
    for (const [wo, entry] of Object.entries(dispatch)) {
      if (!ACTIVE_STATUSES.has(entry.status)) continue;
      const claimedAt = entry.claimed_at ? Date.parse(entry.claimed_at) : 0;
      if (!best || claimedAt > best.claimedAt) {
        best = { wo, claimedAt };
      }
    }
    return best?.wo ?? null;
  } catch {
    return null;
  }
}

export type PostThreadMessageResult = {
  ok: boolean;
  imageUrl?: string;
  error?: string;
};

/**
 * Relay a feedback moment to the factory WO thread. Never throws — evidence
 * relay failures must not break the local review flow (WO-1047 AC). Callers
 * are responsible for the retry-once-then-warn policy; this is a single
 * best-effort attempt.
 */
export async function postThreadMessage(
  wo: string,
  input: PostThreadMessageInput,
  factoryUrlOverride?: string | null,
): Promise<PostThreadMessageResult> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/proxy/thread/${encodeURIComponent(wo)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: input.author,
        role: "human",
        type: input.imageBase64 ? "image" : "text",
        content: input.content,
        image_data: input.imageBase64,
        metadata: { source_url: input.sourceUrl, tool: "oryntra" },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return { ok: false, error: `factory responded ${res.status}` };
    }
    // Response is the stored message object (orchestrator's raw shape), not a
    // wrapper — its image_url is orchestrator-relative
    // ("/api/thread/{wo}/images/{filename}"). Rewrite to the status-site's
    // same-origin proxy route (Oryntra must never talk to the orchestrator
    // directly — no factory credentials here) and make it absolute.
    const body = (await res.json()) as { image_url?: string };
    const imageUrl = body.image_url
      ? `${factoryUrl(factoryUrlOverride)}${body.image_url.replace(
          "/api/thread/",
          "/api/proxy/thread/",
        )}`
      : undefined;
    return { ok: true, imageUrl };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "relay failed",
    };
  }
}

/** Read path — thread messages for the agent-reply strip. Empty array on failure. */
export async function getThreadMessages(
  wo: string,
  since?: string,
  factoryUrlOverride?: string | null,
): Promise<FactoryThreadMessage[]> {
  try {
    const base = factoryUrl(factoryUrlOverride);
    const url = new URL(`${base}/api/thread/${encodeURIComponent(wo)}/messages`);
    if (since) url.searchParams.set("since", since);
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const body = (await res.json()) as FactoryThreadMessage[] | { messages?: FactoryThreadMessage[] };
    const messages = Array.isArray(body) ? body : (body.messages ?? []);
    // Same orchestrator-relative -> status-site-proxy rewrite as postThreadMessage.
    return messages.map((m) =>
      m.image_url
        ? { ...m, image_url: `${base}${m.image_url.replace("/api/thread/", "/api/proxy/thread/")}` }
        : m,
    );
  } catch {
    return [];
  }
}
