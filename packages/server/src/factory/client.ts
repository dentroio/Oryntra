/**
 * Factory API client — talks to the agentic-factory status site.
 * Reads are unauthenticated. Writes send Bearer API_SECRET (ORYNTRA_FACTORY_SECRET,
 * API_SECRET, or the dentroio-factory Keychain item).
 * See docs/FACTORY.md (this repo) and docs/ORYNTRA_FACTORY_INTEGRATION.md (agentic-factory repo) / WO-1047.
 */

import { execFileSync } from "node:child_process";
import { formatAddressedFeedback } from "./participants.js";

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
  agent?: string;
  backend?: string;
  slug?: string;
  step?: string;
  pr_url?: string;
  workstation?: string;
  last_seen?: string;
  [key: string]: unknown;
};

export const LIVE_DISPATCH_STATUSES: ReadonlySet<FactoryDispatchStatus> = new Set([
  "claimed",
  "in_progress",
  "awaiting_human",
  "awaiting_commit",
]);

export type FactoryLiveWork = {
  wo: string;
  status: FactoryDispatchStatus;
  agent: string;
  backend: string;
  slug: string;
  step: string;
  prUrl: string;
  claimedAt: string | null;
};

export type FactoryAgentInfo = {
  name: string;
  domainFilter: string;
  daemonLoaded: boolean;
  daemonPid: number | null;
  cliDetected: boolean;
};

export type CreateFactoryWoInput = {
  title: string;
  priority?: "P0" | "P1" | "P2" | "P3";
  services?: string;
  problem: string;
  whatToBuild: string;
  acceptanceCriteria: string[];
  notes?: string;
};

export type CreateFactoryWoResult = {
  ok: boolean;
  woId?: string;
  url?: string;
  error?: string;
};

/** Flat map { wo_id: entry } — there is no `dispatch_state` wrapper. That
 *  shape existed in an earlier factory version and is dead; do not reference it. */
export type FactoryDispatchMap = Record<string, FactoryDispatchEntry>;

export type FactoryThreadMessage = {
  id?: string;
  author: string;
  role: string;
  type: "text" | "image" | "review" | string;
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
  addressedTo?: string | null;
};

function factoryUrl(override?: string | null): string {
  return override || process.env.ORYNTRA_FACTORY_URL || DEFAULT_FACTORY_URL;
}

let cachedFactorySecret: string | undefined;

/** Test hook — do not use in production code. */
export function resetFactoryAuthCache(): void {
  cachedFactorySecret = undefined;
}

function factoryApiSecret(): string {
  if (cachedFactorySecret !== undefined) return cachedFactorySecret;
  const fromEnv =
    process.env.ORYNTRA_FACTORY_SECRET?.trim() ||
    process.env.API_SECRET?.trim() ||
    "";
  if (fromEnv) {
    cachedFactorySecret = fromEnv;
    return cachedFactorySecret;
  }
  if (process.platform === "darwin") {
    try {
      cachedFactorySecret = execFileSync(
        "security",
        [
          "find-generic-password",
          "-s",
          "dentroio-factory",
          "-a",
          "API_SECRET",
          "-w",
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return cachedFactorySecret;
    } catch {
      cachedFactorySecret = "";
    }
  } else {
    cachedFactorySecret = "";
  }
  return cachedFactorySecret;
}

function factoryWriteHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = factoryApiSecret();
  if (secret) headers.Authorization = `Bearer ${secret}`;
  return headers;
}

function factoryErrorMessage(
  res: Response,
  body: { detail?: string; error?: string },
): string {
  if (res.status === 401) {
    return (
      body.detail ||
      body.error ||
      "Factory write unauthorized — set ORYNTRA_FACTORY_SECRET to the factory API_SECRET"
    );
  }
  return body.detail ?? body.error ?? `factory responded ${res.status}`;
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

function liveWorkFromEntry(wo: string, entry: FactoryDispatchEntry): FactoryLiveWork {
  return {
    wo: entry.wo || wo,
    status: entry.status,
    agent: typeof entry.agent === "string" ? entry.agent : "",
    backend: typeof entry.backend === "string" ? entry.backend : "",
    slug: typeof entry.slug === "string" ? entry.slug : "",
    step: typeof entry.step === "string" ? entry.step : "",
    prUrl: typeof entry.pr_url === "string" ? entry.pr_url : "",
    claimedAt: entry.claimed_at ?? null,
  };
}

const LIVE_STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  claimed: 1,
  awaiting_human: 2,
  awaiting_commit: 3,
};

/** All currently live factory WOs, with the agent that claimed each one. */
export async function listLiveWork(
  factoryUrlOverride?: string | null,
): Promise<FactoryLiveWork[]> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/dispatch`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const dispatch = (await res.json()) as FactoryDispatchMap;
    return Object.entries(dispatch)
      .filter(([, entry]) => LIVE_DISPATCH_STATUSES.has(entry.status))
      .map(([wo, entry]) => liveWorkFromEntry(wo, entry))
      .sort((a, b) => {
        const rank = (LIVE_STATUS_RANK[a.status] ?? 9) - (LIVE_STATUS_RANK[b.status] ?? 9);
        if (rank !== 0) return rank;
        return (b.claimedAt ?? "").localeCompare(a.claimedAt ?? "");
      });
  } catch {
    return [];
  }
}

export type FactoryValidationQueue = {
  factoryOk: boolean;
  items: FactoryLiveWork[];
};

/** WOs waiting on a human verdict (`awaiting_human`). Distinguishes factory-offline. */
export async function listValidationQueue(
  factoryUrlOverride?: string | null,
): Promise<FactoryValidationQueue> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/dispatch`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { factoryOk: false, items: [] };
    const dispatch = (await res.json()) as FactoryDispatchMap;
    const items = Object.entries(dispatch)
      .filter(([, entry]) => entry.status === "awaiting_human")
      .map(([wo, entry]) => liveWorkFromEntry(wo, entry))
      .sort((a, b) => (b.claimedAt ?? "").localeCompare(a.claimedAt ?? ""));
    return { factoryOk: true, items };
  } catch {
    return { factoryOk: false, items: [] };
  }
}

export type FactoryValidationVerdict = "approve" | "reject";

export type FactoryValidationResult = {
  ok: boolean;
  error?: string;
};

/**
 * Approve or reject a factory WO. Never throws — Studio must stay usable if
 * the factory is down. Reject notes are stored by the orchestrator and posted
 * to the WO thread.
 */
export async function submitFactoryValidation(
  wo: string,
  verdict: FactoryValidationVerdict,
  input: { decidedBy: string; notes?: string },
  factoryUrlOverride?: string | null,
): Promise<FactoryValidationResult> {
  try {
    const path = verdict === "reject" ? "reject" : "approve";
    const res = await fetch(
      `${factoryUrl(factoryUrlOverride)}/api/validations/${encodeURIComponent(wo)}/${path}`,
      {
        method: "POST",
        headers: factoryWriteHeaders(),
        body: JSON.stringify({
          decided_by: input.decidedBy,
          notes: input.notes ?? "",
        }),
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as {
        detail?: string;
        error?: string;
      };
      return {
        ok: false,
        error: factoryErrorMessage(res, body),
      };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "validation failed",
    };
  }
}

export async function getDispatchEntry(
  wo: string,
  factoryUrlOverride?: string | null,
): Promise<FactoryLiveWork | null> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/dispatch`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const dispatch = (await res.json()) as FactoryDispatchMap;
    const entry = dispatch[wo];
    if (!entry) return null;
    return liveWorkFromEntry(wo, entry);
  } catch {
    return null;
  }
}

/** Installed factory runners (cursor/claude/codex/gemini) and their domain filters. */
export async function listFactoryAgents(
  factoryUrlOverride?: string | null,
): Promise<FactoryAgentInfo[]> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/agents`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      agents?: Record<
        string,
        {
          domain_filter?: string;
          daemon_loaded?: boolean;
          daemon_pid?: number | null;
          cli_detected?: boolean;
        }
      >;
    };
    return Object.entries(body.agents ?? {}).map(([name, info]) => ({
      name,
      domainFilter: info.domain_filter ?? "",
      daemonLoaded: Boolean(info.daemon_loaded),
      daemonPid: info.daemon_pid ?? null,
      cliDetected: Boolean(info.cli_detected),
    }));
  } catch {
    return [];
  }
}

export async function createFactoryWo(
  input: CreateFactoryWoInput,
  factoryUrlOverride?: string | null,
): Promise<CreateFactoryWoResult> {
  try {
    const res = await fetch(`${factoryUrl(factoryUrlOverride)}/api/factory/wos`, {
      method: "POST",
      headers: factoryWriteHeaders(),
      body: JSON.stringify({
        title: input.title,
        priority: input.priority ?? "P2",
        services: input.services ?? "frontend",
        problem: input.problem,
        what_to_build: input.whatToBuild,
        acceptance_criteria: input.acceptanceCriteria,
        notes: input.notes ?? "",
      }),
      signal: AbortSignal.timeout(20000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      wo_number?: number | string;
      url?: string;
      error?: string;
      detail?: string;
    };
    if (!res.ok) {
      return { ok: false, error: factoryErrorMessage(res, body) };
    }
    const number = body.wo_number;
    const woId =
      typeof number === "number" || typeof number === "string"
        ? `WO-${number}`
        : undefined;
    if (!woId) {
      return { ok: false, error: "Factory did not return a WO number" };
    }
    return { ok: true, woId, url: body.url };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "create WO failed",
    };
  }
}

/** Turn factory thread messages into facilitator/MCP context (does not mutate local chat). */
export function factoryThreadAsContext(
  messages: FactoryThreadMessage[],
): { role: "user" | "agent"; content: string }[] {
  return messages
    .filter((m) => (m.content ?? "").trim().length > 0 || m.type === "image")
    .map((m) => {
      const role: "user" | "agent" = m.role === "human" ? "user" : "agent";
      const who = m.author ? `${m.author}` : role;
      const body =
        m.type === "image" && !m.content
          ? `(screenshot ${m.image_url ?? "attached"})`
          : m.content;
      return { role, content: `[${who}] ${body}` };
    });
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
      headers: factoryWriteHeaders(),
      body: JSON.stringify({
        author: input.author,
        role: "human",
        type: input.imageBase64 ? "image" : "text",
        content: formatAddressedFeedback(input.content, input.addressedTo),
        image_data: input.imageBase64,
        metadata: {
          source_url: input.sourceUrl,
          tool: "oryntra",
          addressed_to: input.addressedTo ?? undefined,
        },
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
