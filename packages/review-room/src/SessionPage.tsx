import {
  type CSSProperties,
  FormEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ChatMessage as ChatBubble } from "./ChatMessage.js";
import { FeedbackEvidenceCard } from "./FeedbackEvidence.js";
import type {
  AgentThread,
  ArtifactStatus,
  BrowserEvent,
  BrowserState,
  ChatMessage,
  FeedbackMoment,
  ReviewArtifact,
  ReviewMode,
  ReviewSession,
  ServerMessage,
} from "@oryntra/core";
import { getIdeLabel } from "@oryntra/core/ide-labels";

function buildIframeSrc(
  appUrl: string,
  sessionId: string,
  reloadEpoch = 0,
): string {
  const url = new URL(appUrl);
  url.searchParams.set("oryntra_session", sessionId);
  url.searchParams.set("oryntra_api", window.location.origin);
  if (reloadEpoch > 0) {
    url.searchParams.set("_oryntra_reload", String(reloadEpoch));
  }
  return url.toString();
}

function mergeChatMessages(
  prev: ChatMessage[],
  incoming: ChatMessage[],
): ChatMessage[] {
  const next = [...prev];
  for (const msg of incoming) {
    if (!next.some((m) => m.id === msg.id)) {
      next.push(msg);
    }
  }
  return next;
}

const CHAT_WIDTH_KEY = "oryntra-chat-panel-width";
const DEFAULT_CHAT_WIDTH = 480;
const MIN_CHAT_WIDTH = 320;
const MAX_CHAT_WIDTH = 720;

function clampChatWidth(width: number): number {
  return Math.min(MAX_CHAT_WIDTH, Math.max(MIN_CHAT_WIDTH, width));
}

function readStoredChatWidth(): number {
  try {
    const raw = localStorage.getItem(CHAT_WIDTH_KEY);
    if (!raw) return DEFAULT_CHAT_WIDTH;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? clampChatWidth(parsed) : DEFAULT_CHAT_WIDTH;
  } catch {
    return DEFAULT_CHAT_WIDTH;
  }
}

function shortRoute(route: string): string {
  try {
    const u = new URL(route, "http://local");
    for (const key of ["oryntra_session", "oryntra_api", "_oryntra_reload"]) {
      u.searchParams.delete(key);
    }
    const path = u.pathname || "/";
    const qs = u.searchParams.toString();
    return qs ? `${path}?${qs}` : path;
  } catch {
    return route.split("?")[0] ?? route;
  }
}

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const [searchParams] = useSearchParams();
  const sidePanelLayout = searchParams.get("layout") === "sidepanel";
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [browserState, setBrowserState] = useState<BrowserState | null>(null);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [artifacts, setArtifacts] = useState<ReviewArtifact[]>([]);
  const [feedbackMoments, setFeedbackMoments] = useState<FeedbackMoment[]>([]);
  const [reviewMode, setReviewMode] = useState<ReviewMode>("normal");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showActivity, setShowActivity] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [iframeEpoch, setIframeEpoch] = useState(0);
  const [implementBanner, setImplementBanner] = useState<{
    status: "implementing" | "completed" | "failed";
    message: string;
  } | null>(null);
  const [implementLog, setImplementLog] = useState<string[]>([]);
  const [implementLogOpen, setImplementLogOpen] = useState(false);
  const [implementPanelDismissed, setImplementPanelDismissed] =
    useState(false);
  const [chatPanelWidth, setChatPanelWidth] = useState(readStoredChatWidth);
  const [resizingChat, setResizingChat] = useState(false);
  const [awaitingMomentId, setAwaitingMomentId] = useState<string | null>(
    null,
  );
  const [agentThreads, setAgentThreads] = useState<AgentThread[]>([]);
  const [activeThread, setActiveThread] = useState<AgentThread | null>(null);
  const [viewingThreadId, setViewingThreadId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [agentBusy, setAgentBusy] = useState(false);
  const [stagedSnap, setStagedSnap] = useState<{
    screenshotId?: string;
    accessibilitySnapshotId?: string;
    previewUrl?: string;
  } | null>(null);
  const [snapping, setSnapping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const activeThreadIdRef = useRef<string | null>(null);
  const viewingThreadIdRef = useRef<string | null>(null);

  const viewingHistory =
    viewingThreadId !== null && viewingThreadId !== activeThread?.id;
  const displayThread =
    agentThreads.find((t) => t.id === (viewingThreadId ?? activeThread?.id)) ??
    activeThread;

  function appendImplementLog(message: string) {
    setImplementLog((prev) =>
      prev[prev.length - 1] === message ? prev : [...prev, message],
    );
  }

  const refreshImplementStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/implement-status`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        status: string;
        message?: string;
        steps?: string[];
      };
      if (data.steps?.length) {
        setImplementLog(data.steps);
      }
      if (data.status === "implementing" || data.status === "pending") {
        const message = data.message ?? "Applying your approved change…";
        setImplementPanelDismissed(false);
        setImplementLogOpen(true);
        setImplementBanner({
          status: "implementing",
          message,
        });
      } else if (data.status === "completed") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.steps?.length) setImplementLog(data.steps);
        setImplementLogOpen(false);
        setImplementBanner({
          status: "completed",
          message: data.message ?? "Implementation completed.",
        });
        setIframeEpoch((n) => n + 1);
      } else if (data.status === "failed") {
        if (pollRef.current) clearInterval(pollRef.current);
        if (data.steps?.length) setImplementLog(data.steps);
        setImplementLogOpen(false);
        setImplementBanner({
          status: "failed",
          message: data.message ?? "Implementation failed.",
        });
      }
    } catch {
      // retry on next poll
    }
  }, [sessionId]);

  const startImplementPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    setImplementPanelDismissed(false);
    setImplementLogOpen(true);
    setImplementBanner({
      status: "implementing",
      message: "Applying your approved change…",
    });
    void refreshImplementStatus();
    pollRef.current = setInterval(() => {
      void refreshImplementStatus();
    }, 2000);
  }, [refreshImplementStatus]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(CHAT_WIDTH_KEY, String(chatPanelWidth));
    } catch {
      // ignore storage errors
    }
  }, [chatPanelWidth]);

  useEffect(() => {
    if (!resizingChat) return;

    function onMove(event: MouseEvent) {
      const start = resizeRef.current;
      if (!start) return;
      const delta = start.startX - event.clientX;
      setChatPanelWidth(clampChatWidth(start.startWidth + delta));
    }

    function onUp() {
      setResizingChat(false);
      resizeRef.current = null;
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [resizingChat]);

  useEffect(() => {
    if (!awaitingMomentId) return;
    const moment = feedbackMoments.find((m) => m.id === awaitingMomentId);
    const hasAgentReply = chat.some(
      (m) =>
        m.role === "agent" && m.feedbackMomentId === awaitingMomentId,
    );
    if (moment?.ideStatus === "processed" || hasAgentReply) {
      setAwaitingMomentId(null);
      setSubmitting(false);
    }
  }, [awaitingMomentId, feedbackMoments, chat]);

  useEffect(() => {
    if (!awaitingMomentId) return;
    const timeout = window.setTimeout(() => {
      setAwaitingMomentId(null);
      setSubmitting(false);
      setError(
        `No reply yet — keep ${ideLabel} Agent open, or wait a moment and send again.`,
      );
    }, 45_000);
    return () => window.clearTimeout(timeout);
  }, [awaitingMomentId, ideLabel]);

  const usesIdeFacilitator = session?.facilitatorProvider === "ide";
  const ideLabel = getIdeLabel(session?.preferredIde ?? session?.ide ?? "cursor");
  const waitingForIde =
    usesIdeFacilitator &&
    (submitting ||
      (awaitingMomentId !== null &&
        !chat.some(
          (m) =>
            m.role === "agent" && m.feedbackMomentId === awaitingMomentId,
        )));

  const momentById = useMemo(
    () => new Map(feedbackMoments.map((m) => [m.id, m])),
    [feedbackMoments],
  );

  useEffect(() => {
    if (!sessionId || loading) return;
    void (async () => {
      const res = await fetch(`/api/sessions/${sessionId}/implement-status`);
      if (!res.ok) return;
      const data = (await res.json()) as { status: string; message?: string };
      if (data.status === "implementing" || data.status === "pending") {
        if (!pollRef.current) startImplementPolling();
      } else if (data.status === "completed") {
        if (data.steps?.length) setImplementLog(data.steps);
        setImplementBanner({
          status: "completed",
          message: data.message ?? "Implementation completed.",
        });
      }
    })();
  }, [sessionId, loading, startImplementPolling]);

  const apiBase = useMemo(() => "", []);
  const embedded = session?.captureMode === "embedded";
  const extensionMode = session?.captureMode === "extension";

  useEffect(() => {
    activeThreadIdRef.current = activeThread?.id ?? null;
  }, [activeThread?.id]);

  useEffect(() => {
    viewingThreadIdRef.current = viewingThreadId;
  }, [viewingThreadId]);

  const loadChatForThread = useCallback(
    async (threadId?: string | null) => {
      if (!sessionId) return;
      const query =
        threadId && threadId.length > 0
          ? `?threadId=${encodeURIComponent(threadId)}`
          : "";
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/chat${query}`);
      if (res.ok) setChat((await res.json()) as ChatMessage[]);
    },
    [apiBase, sessionId],
  );

  async function startNewAgentThread() {
    if (!sessionId || agentBusy) return;
    setAgentBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/sessions/${sessionId}/agent-threads/new`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not start new agent");
      }
      const data = (await res.json()) as {
        activeThread: AgentThread;
        threads: AgentThread[];
      };
      setAgentThreads(data.threads);
      setActiveThread(data.activeThread);
      setViewingThreadId(null);
      setHistoryOpen(false);
      setChat([]);
      setAwaitingMomentId(null);
      setSubmitting(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "New agent failed");
    } finally {
      setAgentBusy(false);
    }
  }

  async function openHistoryThread(threadId: string) {
    setViewingThreadId(threadId);
    setHistoryOpen(false);
    await loadChatForThread(threadId);
  }

  async function resumeHistoryThread(threadId: string) {
    if (!sessionId || agentBusy) return;
    setAgentBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `${apiBase}/api/sessions/${sessionId}/agent-threads/${threadId}/activate`,
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not resume agent");
      }
      const data = (await res.json()) as {
        activeThread: AgentThread;
        threads: AgentThread[];
      };
      setAgentThreads(data.threads);
      setActiveThread(data.activeThread);
      setViewingThreadId(null);
      await loadChatForThread(data.activeThread.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Resume agent failed");
    } finally {
      setAgentBusy(false);
    }
  }
  const iframeSrc =
    session && sessionId && embedded
      ? buildIframeSrc(session.appUrl, sessionId, iframeEpoch)
      : null;

  useEffect(() => {
    if (!sessionId) return;

    void (async () => {
      try {
        const [sessionRes, eventsRes, chatRes, artifactsRes, momentsRes, stateRes, threadsRes] =
          await Promise.all([
            fetch(`${apiBase}/api/sessions/${sessionId}`),
            fetch(`${apiBase}/api/sessions/${sessionId}/events`),
            fetch(`${apiBase}/api/sessions/${sessionId}/chat`),
            fetch(`${apiBase}/api/sessions/${sessionId}/artifacts`),
            fetch(`${apiBase}/api/sessions/${sessionId}/feedback-moments`),
            fetch(`${apiBase}/api/sessions/${sessionId}/browser-state`),
            fetch(`${apiBase}/api/sessions/${sessionId}/agent-threads`),
          ]);

        if (!sessionRes.ok) {
          const body = (await sessionRes.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            sessionRes.status === 0 || sessionRes.status >= 500
              ? "Oryntra server is not running. In Cursor, say: Open the Oryntra collaboration room"
              : body.error ?? `Session unavailable (${sessionRes.status})`,
          );
        }
        setSession((await sessionRes.json()) as ReviewSession);
        if (eventsRes.ok) setEvents((await eventsRes.json()) as BrowserEvent[]);
        if (chatRes.ok) setChat((await chatRes.json()) as ChatMessage[]);
        if (artifactsRes.ok) {
          setArtifacts((await artifactsRes.json()) as ReviewArtifact[]);
        }
        if (momentsRes.ok) {
          setFeedbackMoments((await momentsRes.json()) as FeedbackMoment[]);
        }
        if (stateRes.ok) setBrowserState((await stateRes.json()) as BrowserState);
        if (threadsRes.ok) {
          const threads = (await threadsRes.json()) as AgentThread[];
          setAgentThreads(threads);
          setActiveThread(threads.find((t) => t.status === "active") ?? null);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load session");
      } finally {
        setLoading(false);
      }
    })();

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(
      `${protocol}://${window.location.host}/api/sessions/${sessionId}/ws`,
    );

    ws.onmessage = (message) => {
      const data = JSON.parse(message.data) as ServerMessage;
      switch (data.type) {
        case "browser_event":
          setEvents((prev) => [...prev.slice(-199), data.event]);
          break;
        case "browser_state":
          setBrowserState(data.state);
          break;
        case "chat_message": {
          const activeId = activeThreadIdRef.current;
          const msgThread = data.message.agentThreadId;
          if (viewingThreadIdRef.current !== null) break;
          if (msgThread && activeId && msgThread !== activeId) break;
          setChat((prev) => mergeChatMessages(prev, [data.message]));
          break;
        }
        case "agent_thread_changed":
          setAgentThreads(data.threads);
          setActiveThread(data.activeThread);
          if (viewingThreadIdRef.current === null) {
            void loadChatForThread(data.activeThread.id);
          }
          break;
        case "feedback_moment":
          setFeedbackMoments((prev) => {
            const idx = prev.findIndex((m) => m.id === data.moment.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data.moment;
              return next;
            }
            return [...prev, data.moment];
          });
          break;
        case "artifact":
          setArtifacts((prev) => {
            const idx = prev.findIndex((a) => a.id === data.artifact.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = data.artifact;
              return next;
            }
            return [...prev, data.artifact];
          });
          break;
        case "session_status":
          setReviewMode(data.reviewMode ?? "normal");
          setSession((prev) =>
            prev
              ? {
                  ...prev,
                  status: data.status,
                  reviewMode: data.reviewMode ?? prev.reviewMode,
                }
              : prev,
          );
          break;
        case "implement_status":
          if (data.status === "completed") {
            if (pollRef.current) clearInterval(pollRef.current);
            setImplementLog((prev) =>
              prev[prev.length - 1]?.startsWith("Done")
                ? prev
                : [...prev, "Done — change is live in the preview."],
            );
            setImplementLogOpen(false);
            setImplementBanner({
              status: "completed",
              message:
                data.message ??
                "Done — the change is live in the app on the left.",
            });
            setIframeEpoch((n) => n + 1);
          } else if (data.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (data.message) appendImplementLog(data.message);
            setImplementLogOpen(false);
            setImplementBanner({
              status: "failed",
              message: data.message ?? "Implementation failed.",
            });
          } else if (data.message) {
            setImplementPanelDismissed(false);
            setImplementLogOpen(true);
            appendImplementLog(data.message);
            setImplementBanner({
              status: "implementing",
              message: data.message,
            });
          }
          break;
        default:
          break;
      }
    };

    ws.onopen = () => ws.send(JSON.stringify({ type: "ping" }));

    return () => ws.close();
  }, [apiBase, sessionId]);

  async function setMode(mode: ReviewMode) {
    if (!sessionId) return;
    const res = await fetch(`${apiBase}/api/sessions/${sessionId}/review-mode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    if (res.ok) {
      const updated = (await res.json()) as ReviewSession;
      setSession(updated);
      setReviewMode(updated.reviewMode);
    }
  }

  function pendingArtifactForMessage(message: ChatMessage): ReviewArtifact | undefined {
    if (message.role !== "agent") return undefined;
    if (message.artifactId) {
      const hit = artifacts.find((a) => a.id === message.artifactId);
      if (hit && (hit.status === "draft" || hit.status === "needs-clarification")) {
        return hit;
      }
    }
    if (!message.feedbackMomentId) return undefined;
    return artifacts.find(
      (a) =>
        (a.status === "draft" || a.status === "needs-clarification") &&
        "feedbackMomentIds" in a &&
        a.feedbackMomentIds.includes(message.feedbackMomentId!),
    );
  }

  async function setArtifactStatus(
    artifactId: string,
    status: ArtifactStatus,
    cursorAgent?: "continue" | "new",
  ) {
    if (!sessionId) return;
    setApprovingId(artifactId);
    setError(null);
    try {
      const res = await fetch(
        `/api/sessions/${sessionId}/artifacts/${artifactId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status, cursorAgent }),
        },
      );
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Update failed");
      }
      const data = (await res.json()) as {
        artifact: ReviewArtifact;
        autoImplement?: { started: boolean };
      };
      setArtifacts((prev) => {
        const idx = prev.findIndex((a) => a.id === data.artifact.id);
        if (idx < 0) return [...prev, data.artifact];
        const next = [...prev];
        next[idx] = data.artifact;
        return next;
      });
      if (status === "approved" && data.autoImplement?.started) {
        startImplementPolling();
        void refreshImplementStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  }

  function startSpeechInput() {
    type SpeechRecognitionLike = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((event: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void) | null;
      onerror: (() => void) | null;
      onend: (() => void) | null;
      start: () => void;
    };
    const win = window as Window & {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechCtor = win.SpeechRecognition ?? win.webkitSpeechRecognition;

    if (!SpeechCtor) {
      setError("Speech input is not supported in this browser.");
      return;
    }

    const recognition = new SpeechCtor();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setListening(true);
    setError(null);

    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) {
        setFeedback((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
      setListening(false);
    };
    recognition.onerror = () => {
      setListening(false);
      setError("Could not capture speech — try typing instead.");
    };
    recognition.onend = () => setListening(false);
    recognition.start();
  }

  function nudgeEmbeddedBridgeCapture() {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "oryntra_check_capture" },
      "*",
    );
  }

  async function captureSnapPreview() {
    if (!sessionId || snapping) return;
    setSnapping(true);
    setError(null);
    try {
      if (embedded) {
        nudgeEmbeddedBridgeCapture();
      }
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/snap`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Snap failed");
      }
      const snap = (await res.json()) as {
        screenshotId?: string;
        accessibilitySnapshotId?: string;
        previewUrl?: string;
      };
      setStagedSnap(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snap failed");
    } finally {
      setSnapping(false);
    }
  }

  async function onSubmitFeedback(e: FormEvent) {
    e.preventDefault();
    if (!sessionId || !feedback.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      if (embedded) {
        nudgeEmbeddedBridgeCapture();
      }
      const res = await fetch(`${apiBase}/api/sessions/${sessionId}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: feedback.trim(),
          modality: "typed",
          reviewMode,
          screenshotId: stagedSnap?.screenshotId,
          accessibilitySnapshotId: stagedSnap?.accessibilitySnapshotId,
        }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Feedback failed");
      }
      const result = (await res.json()) as {
        chatMessages?: ChatMessage[];
        feedbackMoment?: FeedbackMoment;
        facilitatorResponse?: { delegatedToIde?: boolean; skipAgentReply?: boolean };
      };
      if (result.chatMessages?.length) {
        setChat((prev) => mergeChatMessages(prev, result.chatMessages!));
      }
      if (result.feedbackMoment) {
        setFeedbackMoments((prev) => {
          const idx = prev.findIndex((m) => m.id === result.feedbackMoment!.id);
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = result.feedbackMoment!;
            return next;
          }
          return [...prev, result.feedbackMoment!];
        });
      }
      setFeedback("");
      setStagedSnap(null);
      if (
        result.facilitatorResponse?.delegatedToIde &&
        result.facilitatorResponse.skipAgentReply &&
        result.feedbackMoment?.id
      ) {
        setAwaitingMomentId(result.feedbackMoment.id);
      } else {
        setSubmitting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Feedback failed");
      setSubmitting(false);
      setAwaitingMomentId(null);
    }
  }

  function startChatResize(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    resizeRef.current = {
      startX: event.clientX,
      startWidth: chatPanelWidth,
    };
    setResizingChat(true);
  }

  const visibleEvents = events.filter((e) => e.type !== "mouse_sample").slice(-8);
  const elementLabel =
    browserState?.lockedElement?.name ||
    browserState?.lastClickedElement?.name ||
    browserState?.elementUnderPointer?.name;

  if (loading) {
    return (
      <div className="studio studio-loading">
        <p>Connecting to review session…</p>
      </div>
    );
  }

  if (error && !session) {
    return (
      <div className="studio studio-error">
        <h1>Review room unavailable</h1>
        <p className="error-text">{error}</p>
        <p className="hint">
          Run <code>npm run open:demo</code> or ask Cursor to open the
          collaboration room.
        </p>
      </div>
    );
  }

  return (
    <div className={`studio${sidePanelLayout ? " sidepanel-mode" : ""}`}>
      {!sidePanelLayout ? (
      <header className="studio-header">
        <div className="studio-brand">
          <span className="studio-logo">Oryntra</span>
          <span className="studio-sub">Review Studio</span>
        </div>
        <div className="studio-status">
          <span className="status-pill">
            {shortRoute(browserState?.route ?? session?.appUrl ?? "/")}
          </span>
          {elementLabel ? (
            <span className="status-pill accent">{elementLabel}</span>
          ) : null}
        </div>
      </header>
      ) : (
        <header className="studio-header studio-header-compact">
          <div className="compact-status-row">
            <span className="compact-label">Page</span>
            <span className="status-pill" title={browserState?.route ?? session?.appUrl}>
              {shortRoute(browserState?.route ?? session?.appUrl ?? "/")}
            </span>
          </div>
          {elementLabel ? (
            <div className="compact-status-row">
              <span className="compact-label">Clicked</span>
              <span className="status-pill accent" title={elementLabel}>
                {elementLabel}
              </span>
            </div>
          ) : null}
        </header>
      )}

      {!sidePanelLayout ? (
      <div className="studio-collab-hint">
        {extensionMode
          ? "Click your app tab, send feedback here — Cursor Agent replies below."
          : "Click the app, send feedback in chat — your "}
        {!extensionMode ? (
          <>
            <strong>Cursor Agent</strong> replies here. Hit <strong>Approve</strong>{" "}
            when ready.
          </>
        ) : (
          <> Hit <strong>Approve</strong> when ready.</>
        )}
      </div>
      ) : null}

      {implementBanner && !implementPanelDismissed ? (
        <div className="implement-panel">
          <div
            className={`implement-banner implement-banner-${implementBanner.status}`}
            role="status"
          >
            <div className="implement-banner-main">
              {implementBanner.status === "implementing" ? (
                <span className="implement-spinner" aria-hidden />
              ) : null}
              <span>{implementBanner.message}</span>
            </div>
            <div className="implement-panel-actions">
              {implementLog.length > 0 ? (
                <button
                  type="button"
                  className="implement-panel-btn"
                  onClick={() => setImplementLogOpen((open) => !open)}
                  aria-expanded={implementLogOpen}
                >
                  {implementLogOpen ? "Hide activity" : "Show activity"}
                </button>
              ) : null}
              <button
                type="button"
                className="implement-panel-btn"
                onClick={() => setImplementPanelDismissed(true)}
              >
                Dismiss
              </button>
            </div>
          </div>
          {implementLogOpen ? (
            <div className="implement-log" aria-label="Implementation activity">
              <div className="implement-log-title">Implementation activity</div>
              {implementLog.length > 0 ? (
                <ol>
                  {implementLog.map((line, i) => (
                    <li
                      key={`${line}-${i}`}
                      className={
                        i === implementLog.length - 1 &&
                        implementBanner.status === "implementing"
                          ? "active"
                          : implementBanner.status === "completed" &&
                              line.startsWith("Done")
                            ? "done"
                            : ""
                      }
                    >
                      {line}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="implement-log-wait">Starting…</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={`studio-body${sidePanelLayout ? " sidepanel-layout" : ""}`}
        style={
          {
            "--chat-panel-width": sidePanelLayout
              ? "100%"
              : `${chatPanelWidth}px`,
          } as CSSProperties
        }
      >
        {!sidePanelLayout ? (
        <section className="studio-app">
          <div className="studio-app-label">
            {embedded
              ? "App under review"
              : extensionMode
                ? "App in your browser tab"
                : "App (separate window)"}
          </div>
          {iframeSrc ? (
            <iframe
              ref={iframeRef}
              key={`app-preview-${iframeEpoch}`}
              className="studio-iframe"
              src={iframeSrc}
              title="App"
            />
          ) : extensionMode ? (
            <div className="studio-iframe empty">
              Navigate your app in the main browser tab. Oryntra extension
              captures clicks, routes, and screenshots from that tab.
            </div>
          ) : session?.captureMode === "playwright" ? (
            <div className="studio-iframe empty">
              Legacy Playwright mode — the app opens in a separate Chromium window.
              Use extension or embedded mode in oryntra.yaml for single-screen review.
            </div>
          ) : (
            <div className="studio-iframe empty">
              App preview unavailable. Is the dev server running at{" "}
              {session?.appUrl ?? "your app URL"}?
            </div>
          )}
        </section>
        ) : null}

        {!sidePanelLayout ? (
        <div
          className={`studio-resizer${resizingChat ? " dragging" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize review chat panel"
          onMouseDown={startChatResize}
        />
        ) : null}

        <aside className="studio-side">
            <div className="side-chat">
              <div className="side-chat-header">
                <div className="agent-thread-bar">
                  <span className="agent-thread-title" title={displayThread?.title}>
                    {displayThread?.title ?? "Review agent"}
                  </span>
                  <div className="agent-thread-actions">
                    <button
                      type="button"
                      className="secondary agent-thread-btn"
                      onClick={() => setHistoryOpen((open) => !open)}
                      aria-expanded={historyOpen}
                    >
                      History
                      {agentThreads.filter((t) => t.status === "archived").length > 0
                        ? ` (${agentThreads.filter((t) => t.status === "archived").length})`
                        : ""}
                    </button>
                    {!viewingHistory ? (
                      <button
                        type="button"
                        className="agent-thread-btn agent-thread-new"
                        onClick={() => void startNewAgentThread()}
                        disabled={agentBusy}
                        title="Start a fresh agent chat (current agent moves to history)"
                      >
                        + New agent
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              {historyOpen ? (
                <div className="agent-history-panel" aria-label="Agent history">
                  {agentThreads.filter((t) => t.status === "archived").length === 0 ? (
                    <p className="hint">No archived agents yet. Use + New agent to start fresh.</p>
                  ) : (
                    <ul className="agent-history-list">
                      {agentThreads
                        .filter((t) => t.status === "archived")
                        .slice()
                        .reverse()
                        .map((thread) => (
                          <li key={thread.id}>
                            <button
                              type="button"
                              className="agent-history-item"
                              onClick={() => void openHistoryThread(thread.id)}
                            >
                              <span className="agent-history-item-title">{thread.title}</span>
                              <span className="agent-history-item-date">
                                {thread.archivedAt
                                  ? new Date(thread.archivedAt).toLocaleString()
                                  : ""}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {viewingHistory ? (
                <div className="agent-history-banner" role="status">
                  <span>Viewing archived agent</span>
                  <div className="agent-history-banner-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setViewingThreadId(null);
                        void loadChatForThread(activeThread?.id);
                      }}
                    >
                      Back to current
                    </button>
                    <button
                      type="button"
                      onClick={() => void resumeHistoryThread(viewingThreadId!)}
                      disabled={agentBusy}
                    >
                      Resume this agent
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="mode-row">
                <button
                  type="button"
                  className={reviewMode === "normal" ? "active" : ""}
                  onClick={() => void setMode("normal")}
                >
                  Normal
                </button>
                <button
                  type="button"
                  className={reviewMode === "explain_this" ? "active" : ""}
                  onClick={() => void setMode("explain_this")}
                  title="Binds feedback to your last click"
                >
                  Explain click
                </button>
                <button
                  type="button"
                  className={reviewMode === "element_picker" ? "active" : ""}
                  onClick={() => void setMode("element_picker")}
                  title="Next click in app picks the element"
                >
                  Pick element
                </button>
              </div>

              <div className="chat-stream">
                {chat.length === 0 ? (
                  <p className="hint">
                    {extensionMode || sidePanelLayout
                      ? "Click your Clarion tab — the route above updates. Then describe what should change."
                      : "Click around the app on the left, then type or tap the mic to describe what should change."}
                  </p>
                ) : (
                  chat.map((message) => {
                    const proposal = pendingArtifactForMessage(message);
                    const moment = message.feedbackMomentId
                      ? momentById.get(message.feedbackMomentId)
                      : undefined;
                    return (
                      <div
                        key={message.id}
                        className={`chat-turn chat-turn-${message.role}`}
                      >
                        <ChatBubble
                          role={message.role}
                          content={message.content}
                          variant={
                            message.role === "agent" &&
                            message.content.startsWith("Done —")
                              ? "done"
                              : "default"
                          }
                        />
                        {message.role === "user" && moment && sessionId ? (
                          <FeedbackEvidenceCard
                            sessionId={sessionId}
                            moment={moment}
                          />
                        ) : null}
                        {proposal && !viewingHistory ? (
                          <div className="chat-proposal">
                            {proposal.kind === "change_request" ? (
                              <p className="chat-proposal-summary">
                                {proposal.expectedBehavior}
                              </p>
                            ) : null}
                            <div className="chat-proposal-actions">
                              <button
                                type="button"
                                disabled={approvingId === proposal.id}
                                onClick={() =>
                                  void setArtifactStatus(
                                    proposal.id,
                                    "approved",
                                    "continue",
                                  )
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={approvingId === proposal.id}
                                onClick={() =>
                                  void setArtifactStatus(
                                    proposal.id,
                                    "approved",
                                    "new",
                                  )
                                }
                                title={
                                  session?.preferredIde === "cursor" ||
                                  !session?.preferredIde
                                    ? "Start a fresh Cursor agent for this change"
                                    : "Start a fresh agent thread for this change"
                                }
                              >
                                New agent
                              </button>
                              <button
                                type="button"
                                className="secondary"
                                disabled={approvingId === proposal.id}
                                onClick={() =>
                                  void setArtifactStatus(proposal.id, "rejected")
                                }
                              >
                                Not quite
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
                {waitingForIde ? (
                  <div className="chat-turn chat-turn-agent">
                    <div className="chat-typing" aria-live="polite">
                      <span className="chat-typing-dots" aria-hidden>
                        <span />
                        <span />
                        <span />
                      </span>
                      <span>{ideLabel} Agent is thinking…</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <form className="chat-input" onSubmit={onSubmitFeedback}>
                {stagedSnap?.previewUrl ? (
                  <div className="snap-preview">
                    <img src={stagedSnap.previewUrl} alt="Captured preview" />
                    <span className="muted">Snap ready — send feedback to attach</span>
                  </div>
                ) : null}
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Click the app, then describe what should change…"
                  title={`Replies come from your ${ideLabel} Agent via MCP`}
                  rows={3}
                  disabled={submitting || listening || viewingHistory}
                />
                <div className="chat-input-actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void captureSnapPreview()}
                    disabled={submitting || snapping || viewingHistory}
                    title="Capture screenshot without sending"
                  >
                    {snapping ? "Snapping…" : "Snap"}
                  </button>
                  <button
                    type="button"
                    className={`secondary mic-btn${listening ? " listening" : ""}`}
                    onClick={startSpeechInput}
                    disabled={submitting || listening}
                    title="Speak your feedback"
                  >
                    {listening ? "Listening…" : "Mic"}
                  </button>
                  <button
                    type="submit"
                    disabled={
                      submitting ||
                      listening ||
                      viewingHistory ||
                      !feedback.trim()
                    }
                    title={
                      waitingForIde
                        ? `Waiting for ${ideLabel} Agent response…`
                        : undefined
                    }
                  >
                    {waitingForIde ? "Waiting…" : "Send"}
                  </button>
                </div>
              </form>
              {error ? <p className="error-text">{error}</p> : null}
            </div>
        </aside>
      </div>

      <footer className="studio-footer">
        <button
          type="button"
          className="footer-toggle"
          onClick={() => setShowActivity((v) => !v)}
        >
          {showActivity ? "Hide" : "Show"} app clicks ({visibleEvents.length}{" "}
          events · {feedbackMoments.length} feedback)
        </button>
        {showActivity ? (
          <div className="activity-list">
            {visibleEvents
              .slice()
              .reverse()
              .map((event) => (
                <span key={event.id} className="activity-item">
                  {event.type}
                  {event.type === "click" && event.element?.name
                    ? ` · ${event.element.name}`
                    : ""}
                  {" · "}
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              ))}
          </div>
        ) : null}
      </footer>
    </div>
  );
}
