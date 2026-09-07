const API_BASE = "http://127.0.0.1:4317";
const DEFAULT_WORKSPACE = "/Users/stevengerhart/workspace/github/sgerhart/clarion";

const metaEl = document.getElementById("session-meta");
const ideBar = document.getElementById("ide-bar");
const statusEl = document.getElementById("status");
const startBtn = document.getElementById("start-btn");
const refreshBtn = document.getElementById("refresh-btn");
const optionsBtn = document.getElementById("options-btn");
const openStudioBtn = document.getElementById("open-studio-btn");
const workspacePathEl = document.getElementById("workspace-path");
const chatStream = document.getElementById("chat-stream");
const composer = document.getElementById("composer");
const feedbackEl = document.getElementById("feedback");
const sendBtn = document.getElementById("send-btn");
const snapBtn = document.getElementById("snap-btn");
const micBtn = document.getElementById("mic-btn");
const snapPreview = document.getElementById("snap-preview");
const routeRow = document.getElementById("route-row");
const routePill = document.getElementById("route-pill");
const clickedPill = document.getElementById("clicked-pill");
const modeBar = document.getElementById("mode-bar");
const implementBanner = document.getElementById("implement-banner");
const factoryStrip = document.getElementById("factory-strip");
const factoryLabel = document.getElementById("factory-label");
const factoryUnbindBtn = document.getElementById("factory-unbind-btn");
const factoryBind = document.getElementById("factory-bind");
const factoryWoInput = document.getElementById("factory-wo");
const factoryBindBtn = document.getElementById("factory-bind-btn");
const factoryLive = document.getElementById("factory-live");

const state = {
  sessionId: null,
  messages: [],
  artifacts: [],
  reviewMode: "normal",
  stagedSnap: null,
  submitting: false,
  snapping: false,
  listening: false,
  ws: null,
  pollTimer: null,
  reconnectTimer: null,
  factoryWo: null,
  factoryAgent: null,
  factoryAddressedTo: null,
};

function isHttpAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalizeAppUrl(url) {
  return originOf(url) || url;
}

function isOryntraUi(url) {
  if (!url) return true;
  if (url.startsWith("chrome-extension://") || url.startsWith("chrome://")) {
    return true;
  }
  return url.startsWith(`${API_BASE}/`);
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMessageHtml(content) {
  const escaped = escapeHtml(content).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return escaped
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => `<p>${line}</p>`)
    .join("");
}

function shortRoute(route) {
  try {
    const u = new URL(route, "http://local");
    for (const key of ["oryntra_session", "oryntra_api", "_oryntra_reload"]) {
      u.searchParams.delete(key);
    }
    const path = u.pathname || "/";
    const qs = u.searchParams.toString();
    return qs ? `${path}?${qs}` : path;
  } catch {
    return (route || "/").split("?")[0] || "/";
  }
}

async function getActiveTabUrl() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.url ?? null;
}

async function loadSettings() {
  return chrome.storage.local.get([
    "workspacePath",
    "appUrl",
    "sessionId",
    "preferredIde",
  ]);
}

async function saveWorkspace(workspacePath, extra = {}) {
  const path = (workspacePath || "").trim();
  await chrome.storage.local.set({ workspacePath: path, ...extra });
  return path;
}

async function pingFactoryHeartbeat(settings) {
  try {
    await fetch(`${API_BASE}/api/ide/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: settings.preferredIde || "other",
        clientId: "browser-extension",
        workspacePath: settings.workspacePath,
        source: "extension",
        label: "Oryntra Extension",
      }),
    });
  } catch {
    // Server may be down; the panel still works for starting a session later.
  }
}

async function resolveAppUrl(settings) {
  const saved = (settings.appUrl || "").trim();
  const active = await getActiveTabUrl();
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const appTabs = tabs.filter(
    (tab) => tab.url && isHttpAppUrl(tab.url) && !isOryntraUi(tab.url),
  );

  if (saved && isHttpAppUrl(saved) && !isOryntraUi(saved)) {
    const origin = originOf(saved);
    if (appTabs.some((tab) => tab.url.startsWith(origin))) {
      return saved;
    }
  }
  if (active && isHttpAppUrl(active) && !isOryntraUi(active)) {
    return active;
  }
  return appTabs[0]?.url ?? null;
}

async function findAppTab(appUrl) {
  const origin = originOf(appUrl);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const match = tabs.find((t) => t.url && origin && t.url.startsWith(origin));
  if (match) return match;
  return (
    tabs.find((t) => t.url && isHttpAppUrl(t.url) && !isOryntraUi(t.url)) ?? null
  );
}

async function bindAppTab(tab, sessionId, appUrl) {
  if (!tab?.id) return false;
  await chrome.storage.local.set({
    sessionId,
    appUrl: normalizeAppUrl(appUrl),
    boundTabId: tab.id,
  });
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return true;
  } catch {
    return false;
  }
}

async function checkServerHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return "offline";
    const probe = await fetch(`${API_BASE}/api/ide/available`);
    if (probe.status === 404) return "outdated";
    return "ok";
  } catch {
    return "offline";
  }
}

async function setPreferredIde(provider) {
  await chrome.storage.local.set({ preferredIde: provider });
  const settings = await loadSettings();
  if (settings.sessionId) {
    await fetch(`${API_BASE}/api/sessions/${settings.sessionId}/preferred-ide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferredIde: provider }),
    }).catch(() => {});
  }
}

async function refreshIdes(workspacePath) {
  const health = await checkServerHealth();
  if (health === "offline") {
    ideBar.innerHTML = '<span class="ide-chip">Server offline — is :4317 running?</span>';
    return [];
  }
  if (health === "outdated") {
    ideBar.innerHTML =
      '<span class="ide-chip">Server outdated — rebuild & restart Oryntra</span>';
    return [];
  }

  const settings = await loadSettings();
  const selected = settings.preferredIde ?? "cursor";
  const query = workspacePath
    ? `?workspacePath=${encodeURIComponent(workspacePath)}`
    : "";
  const res = await fetch(`${API_BASE}/api/ide/available${query}`);
  if (!res.ok) {
    ideBar.innerHTML = '<span class="ide-chip">Server error</span>';
    return [];
  }
  const data = await res.json();
  const ides = data.ides ?? [];
  ideBar.innerHTML = "";
  for (const ide of ides) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `ide-chip${ide.connected ? " connected" : ""}${ide.provider === selected ? " selected" : ""}`;
    chip.title = `${ide.source}${ide.provider === selected ? " · selected for handoff" : ""}`;
    chip.textContent = `${ide.label}${ide.connected ? " ●" : ""}`;
    chip.addEventListener("click", () => {
      void setPreferredIde(ide.provider);
      void refreshIdes(workspacePath);
    });
    ideBar.appendChild(chip);
  }
  if (ides.length === 0) {
    ideBar.innerHTML = '<span class="ide-chip">No IDEs detected</span>';
  }
  return ides;
}

async function showStudio(sessionId) {
  const studioUrl = `${API_BASE}/session/${sessionId}`;
  const existing = await chrome.tabs.query({ url: `${API_BASE}/session/*` });
  if (existing[0]?.id) {
    await chrome.tabs.update(existing[0].id, { url: studioUrl, active: true });
    return studioUrl;
  }
  await chrome.tabs.create({ url: studioUrl, active: true });
  return studioUrl;
}

function mergeMessages(prev, incoming) {
  const next = [...prev];
  for (const msg of incoming) {
    if (!next.some((m) => m.id === msg.id)) next.push(msg);
  }
  return next;
}

function pendingArtifactForMessage(message) {
  if (message.role !== "agent") return null;
  if (message.artifactId) {
    const hit = state.artifacts.find((a) => a.id === message.artifactId);
    if (hit && (hit.status === "draft" || hit.status === "needs-clarification")) {
      return hit;
    }
  }
  if (!message.feedbackMomentId) return null;
  return (
    state.artifacts.find(
      (a) =>
        (a.status === "draft" || a.status === "needs-clarification") &&
        Array.isArray(a.feedbackMomentIds) &&
        a.feedbackMomentIds.includes(message.feedbackMomentId),
    ) ?? null
  );
}

function renderChat() {
  const nearBottom =
    chatStream.scrollHeight - chatStream.scrollTop - chatStream.clientHeight < 80;

  if (state.messages.length === 0) {
    chatStream.innerHTML =
      '<p class="hint">Click Clarion, then describe what should change.</p>';
    return;
  }

  chatStream.innerHTML = state.messages
    .map((message) => {
      const proposal = pendingArtifactForMessage(message);
      let html = `<div class="msg msg-${message.role}">${formatMessageHtml(message.content)}</div>`;
      if (proposal) {
        const summary = escapeHtml(
          proposal.expectedBehavior || proposal.summary || proposal.title || "Proposed change",
        );
        html += `<div class="proposal">
          <div>${summary}</div>
          <div class="proposal-actions">
            <button type="button" class="primary" data-approve="${proposal.id}" data-status="approved" data-cursor="continue">Approve</button>
            <button type="button" data-approve="${proposal.id}" data-status="rejected">Not quite</button>
          </div>
        </div>`;
      } else if (
        message.role === "agent" &&
        message.artifactId
      ) {
        const artifact = state.artifacts.find((a) => a.id === message.artifactId);
        if (artifact?.status === "approved" && !artifact.factoryWoId) {
          html += `<div class="proposal">
            <div>Approved — queue this as a factory WO for idle runners.</div>
            <div class="proposal-actions">
              <button type="button" class="primary" data-export="${artifact.id}">Send to Factory</button>
            </div>
          </div>`;
        }
      }
      return html;
    })
    .join("");

  if (nearBottom) chatStream.scrollTop = chatStream.scrollHeight;
}

function updateComposerEnabled() {
  sendBtn.disabled = state.submitting || state.listening || !feedbackEl.value.trim();
  snapBtn.disabled = state.snapping || !state.sessionId;
  micBtn.disabled = state.listening || !state.sessionId;
}

function renderSnapPreview() {
  if (!state.stagedSnap?.previewUrl) {
    snapPreview.classList.remove("show");
    snapPreview.innerHTML = "";
    return;
  }
  const src = state.stagedSnap.previewUrl.startsWith("http")
    ? state.stagedSnap.previewUrl
    : `${API_BASE}${state.stagedSnap.previewUrl}`;
  snapPreview.innerHTML = `Snap ready — send to attach<img alt="" src="${escapeHtml(src)}">`;
  snapPreview.classList.add("show");
}

function setReviewModeUi(mode) {
  state.reviewMode = mode || "normal";
  for (const btn of modeBar.querySelectorAll("button[data-mode]")) {
    btn.classList.toggle("active", btn.dataset.mode === state.reviewMode);
  }
}

function showReviewUi(sessionId, appLabel) {
  state.sessionId = sessionId;
  composer.hidden = false;
  modeBar.hidden = false;
  routeRow.hidden = false;
  factoryStrip.hidden = false;
  metaEl.textContent = appLabel || "extension mode";
  updateComposerEnabled();
}

async function refreshBrowserState() {
  if (!state.sessionId) return;
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.sessionId}/browser-state`);
    if (!res.ok) return;
    applyBrowserState(await res.json());
  } catch {
    // ignore
  }
}

function applyBrowserState(browserState) {
  if (!browserState) return;
  routeRow.hidden = false;
  routePill.textContent = shortRoute(browserState.route || "/");
  const label =
    browserState.lockedElement?.name ||
    browserState.lastClickedElement?.name ||
    browserState.elementUnderPointer?.name;
  if (label) {
    clickedPill.hidden = false;
    clickedPill.textContent = label;
  } else {
    clickedPill.hidden = true;
  }
}

function upsertArtifact(artifact) {
  const idx = state.artifacts.findIndex((a) => a.id === artifact.id);
  if (idx >= 0) state.artifacts[idx] = artifact;
  else state.artifacts.push(artifact);
  renderChat();
}

async function loadChatSnapshot() {
  if (!state.sessionId) return;
  const [chatRes, artifactsRes] = await Promise.all([
    fetch(`${API_BASE}/api/sessions/${state.sessionId}/chat`),
    fetch(`${API_BASE}/api/sessions/${state.sessionId}/artifacts`),
  ]);
  if (chatRes.ok) {
    state.messages = mergeMessages([], await chatRes.json());
  }
  if (artifactsRes.ok) {
    state.artifacts = await artifactsRes.json();
  }
  renderChat();
}

function handleWsMessage(data) {
  switch (data.type) {
    case "chat_message":
      state.messages = mergeMessages(state.messages, [data.message]);
      renderChat();
      break;
    case "artifact":
      upsertArtifact(data.artifact);
      break;
    case "browser_state":
      applyBrowserState(data.state);
      break;
    case "session_status":
      if (data.reviewMode) setReviewModeUi(data.reviewMode);
      break;
    case "factory_binding":
      applyFactoryBinding(data);
      break;
    case "implement_status":
      if (data.message) {
        implementBanner.textContent = data.message;
        implementBanner.classList.add("show");
      }
      if (data.status === "completed" || data.status === "failed") {
        window.setTimeout(() => implementBanner.classList.remove("show"), 8000);
      }
      break;
    default:
      break;
  }
}

function stopChatSocket() {
  if (state.ws) {
    state.ws.onclose = null;
    state.ws.close();
    state.ws = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function connectSocket() {
  if (!state.sessionId) return;
  stopChatSocket();
  const ws = new WebSocket(`ws://127.0.0.1:4317/api/sessions/${state.sessionId}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    ws.send(JSON.stringify({ type: "ping" }));
  };
  ws.onmessage = (event) => {
    try {
      handleWsMessage(JSON.parse(event.data));
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    state.reconnectTimer = window.setTimeout(() => connectSocket(), 2000);
  };
  state.pollTimer = window.setInterval(() => {
    void loadChatSnapshot();
    void refreshBrowserState();
    void refreshFactory();
  }, 4000);
}

function applyFactoryBinding(binding) {
  state.factoryWo = binding.factoryWo ?? null;
  state.factoryAgent = binding.factoryAgent ?? null;
  state.factoryAddressedTo = binding.factoryAddressedTo ?? null;
  if (state.factoryWo) {
    const who = state.factoryAddressedTo || state.factoryAgent;
    factoryLabel.textContent = who
      ? `${who} · ${state.factoryWo}`
      : state.factoryWo;
    factoryUnbindBtn.hidden = false;
    factoryBind.hidden = true;
  } else {
    factoryLabel.textContent = "Scratch review — bind a WO to relay into factory";
    factoryUnbindBtn.hidden = true;
    factoryBind.hidden = false;
  }
}

async function refreshFactory() {
  if (!state.sessionId) return;
  try {
    const [sessionRes, liveRes] = await Promise.all([
      fetch(`${API_BASE}/api/sessions/${state.sessionId}`),
      fetch(`${API_BASE}/api/factory/live-work`),
    ]);
    if (sessionRes.ok) {
      const session = await sessionRes.json();
      applyFactoryBinding(session);
    }
    if (!liveRes.ok) return;
    const live = await liveRes.json();
    factoryLive.innerHTML = "";
    for (const item of live) {
      if (item.wo && item.wo === state.factoryWo) continue;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${item.agent || "unclaimed"} · ${item.wo}`;
      btn.title = item.status || "";
      btn.addEventListener("click", () => void bindFactoryWo(item.wo));
      factoryLive.appendChild(btn);
    }
  } catch {
    // Factory optional — scratch review still works.
  }
}

async function bindFactoryWo(wo) {
  if (!state.sessionId) return;
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.sessionId}/factory-wo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wo }),
    });
    if (!res.ok) throw new Error("Bind failed");
    applyFactoryBinding(await res.json());
    factoryWoInput.value = "";
    setStatus(
      wo
        ? `Bound to ${wo}. Clicks and feedback relay to that factory thread.`
        : "Unbound — scratch review. Approve then Send to Factory to queue a new WO.",
    );
    await refreshFactory();
  } catch (err) {
    setStatus(err.message || "Could not bind factory WO", true);
  }
}

async function exportToFactory(artifactId) {
  if (!state.sessionId) return;
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${state.sessionId}/artifacts/${artifactId}/export-factory`,
      { method: "POST" },
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Send to Factory failed");
    if (body.artifact) upsertArtifact(body.artifact);
    if (body.woId) applyFactoryBinding({ factoryWo: body.woId, ...body });
    setStatus(body.woId ? `Queued ${body.woId} on the factory.` : "Sent to Factory.");
    await refreshFactory();
  } catch (err) {
    setStatus(err.message || "Send to Factory failed", true);
  }
}

async function connectChat(sessionId, appLabel) {
  showReviewUi(sessionId, appLabel);
  await loadChatSnapshot();
  await refreshBrowserState();
  await refreshFactory();
  connectSocket();
}

async function setReviewMode(mode) {
  if (!state.sessionId) return;
  setReviewModeUi(mode);
  await fetch(`${API_BASE}/api/sessions/${state.sessionId}/review-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  }).catch(() => {});
}

async function captureSnap() {
  if (!state.sessionId || state.snapping) return;
  state.snapping = true;
  snapBtn.textContent = "Snapping…";
  updateComposerEnabled();
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.sessionId}/snap`, {
      method: "POST",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Snap failed");
    }
    state.stagedSnap = await res.json();
    renderSnapPreview();
    setStatus("Snap attached. Send feedback to include it.");
  } catch (err) {
    setStatus(err.message || "Snap failed", true);
  } finally {
    state.snapping = false;
    snapBtn.textContent = "Snap";
    updateComposerEnabled();
  }
}

async function sendFeedback() {
  const transcript = feedbackEl.value.trim();
  if (!state.sessionId || !transcript || state.submitting) return;
  state.submitting = true;
  updateComposerEnabled();
  setStatus("Sending…");
  try {
    const res = await fetch(`${API_BASE}/api/sessions/${state.sessionId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transcript,
        modality: "typed",
        reviewMode: state.reviewMode,
        screenshotId: state.stagedSnap?.screenshotId,
        accessibilitySnapshotId: state.stagedSnap?.accessibilitySnapshotId,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Feedback failed");
    }
    const result = await res.json();
    if (result.chatMessages?.length) {
      state.messages = mergeMessages(state.messages, result.chatMessages);
      renderChat();
    }
    feedbackEl.value = "";
    state.stagedSnap = null;
    renderSnapPreview();
    setStatus("Sent. Stay on Clarion — Cursor replies here.");
  } catch (err) {
    setStatus(err.message || "Feedback failed", true);
  } finally {
    state.submitting = false;
    updateComposerEnabled();
  }
}

async function setArtifactStatus(artifactId, status) {
  if (!state.sessionId) return;
  try {
    const res = await fetch(
      `${API_BASE}/api/sessions/${state.sessionId}/artifacts/${artifactId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, cursorAgent: "continue" }),
      },
    );
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Update failed");
    }
    const data = await res.json();
    if (data.artifact) upsertArtifact(data.artifact);
    setStatus(status === "approved" ? "Approved — Cursor can implement." : "Rejected.");
  } catch (err) {
    setStatus(err.message || "Update failed", true);
  }
}

function startSpeechInput() {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) {
    setStatus("Speech is not available in this browser. Type instead.", true);
    return;
  }
  const recognition = new Speech();
  recognition.lang = "en-US";
  recognition.interimResults = false;
  state.listening = true;
  micBtn.textContent = "Listening…";
  updateComposerEnabled();
  recognition.onresult = (event) => {
    const spoken = event.results?.[0]?.[0]?.transcript;
    if (spoken) {
      feedbackEl.value = feedbackEl.value
        ? `${feedbackEl.value.trim()} ${spoken}`
        : spoken;
      updateComposerEnabled();
    }
  };
  recognition.onerror = () => {
    setStatus("Could not capture speech — try typing instead.", true);
  };
  recognition.onend = () => {
    state.listening = false;
    micBtn.textContent = "Mic";
    updateComposerEnabled();
  };
  recognition.start();
}

async function ensureSession() {
  const settings = await loadSettings();
  const workspacePath = await saveWorkspace(
    workspacePathEl.value || settings.workspacePath || DEFAULT_WORKSPACE,
    { preferredIde: settings.preferredIde || "cursor" },
  );
  workspacePathEl.value = workspacePath;
  const rawAppUrl = await resolveAppUrl(settings);
  const appUrl = rawAppUrl ? originOf(rawAppUrl) : null;
  if (!workspacePath) {
    setStatus("Set workspace path in Settings.", true);
    metaEl.textContent = "Workspace path missing";
    return null;
  }
  if (!appUrl) {
    setStatus("Open the Clarion tab, then click Start review.", true);
    return null;
  }

  setStatus("Starting session…");
  const preferredIde =
    settings.preferredIde ||
    (await refreshIdes(workspacePath)).find((i) => i.connected)?.provider ||
    "cursor";

  let sessionId = null;
  try {
    const activeRes = await fetch(`${API_BASE}/api/sessions/active`);
    if (activeRes.ok) {
      const active = await activeRes.json();
      if (
        active.workspacePath === workspacePath &&
        originOf(active.appUrl) === appUrl &&
        active.captureMode === "extension"
      ) {
        sessionId = active.id;
      }
    }
  } catch {
    // server may be down
  }

  if (!sessionId) {
    const createRes = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspacePath,
        appUrl,
        captureMode: "extension",
        preferredIde,
        ide: preferredIde,
      }),
    });
    if (!createRes.ok) {
      const body = await createRes.json().catch(() => ({}));
      throw new Error(body.error || "Could not create session");
    }
    const created = await createRes.json();
    sessionId = created.sessionId;
  }

  const tab = await findAppTab(appUrl);
  await chrome.storage.local.set({ preferredIde });
  const injected = await bindAppTab(tab, sessionId, appUrl);
  await pingFactoryHeartbeat({ ...settings, preferredIde, workspacePath });
  if (tab?.id) {
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
  }

  await connectChat(sessionId, `${appUrl} · extension mode`);
  await refreshIdes(workspacePath);
  setStatus(
    injected
      ? "Stay on Clarion. Click the UI, then type here."
      : "Refresh Clarion once (Cmd+R), then click the UI and type here.",
  );
  return sessionId;
}

workspacePathEl.addEventListener("change", () => {
  void saveWorkspace(workspacePathEl.value);
});

startBtn.addEventListener("click", () => {
  void ensureSession().catch((err) =>
    setStatus(err.message || "Start failed", true),
  );
});

refreshBtn.addEventListener("click", () => {
  void loadSettings().then((s) => refreshIdes(s.workspacePath));
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

openStudioBtn.addEventListener("click", () => {
  void (async () => {
    const settings = await loadSettings();
    const sessionId = settings.sessionId || state.sessionId;
    if (!sessionId) {
      setStatus("Start review first. Full studio is optional.", true);
      return;
    }
    await showStudio(sessionId);
  })();
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendFeedback();
});

feedbackEl.addEventListener("input", updateComposerEnabled);
feedbackEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    void sendFeedback();
  }
});

snapBtn.addEventListener("click", () => {
  void captureSnap();
});

micBtn.addEventListener("click", startSpeechInput);

modeBar.addEventListener("click", (event) => {
  const btn = event.target.closest("button[data-mode]");
  if (!btn) return;
  void setReviewMode(btn.dataset.mode);
});

chatStream.addEventListener("click", (event) => {
  const exportBtn = event.target.closest("[data-export]");
  if (exportBtn) {
    void exportToFactory(exportBtn.dataset.export);
    return;
  }
  const btn = event.target.closest("[data-approve]");
  if (!btn) return;
  void setArtifactStatus(btn.dataset.approve, btn.dataset.status);
});

factoryBindBtn.addEventListener("click", () => {
  const wo = factoryWoInput.value.trim();
  if (!wo) {
    setStatus("Enter a WO id such as WO-1080.", true);
    return;
  }
  void bindFactoryWo(wo);
});

factoryWoInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    factoryBindBtn.click();
  }
});

factoryUnbindBtn.addEventListener("click", () => {
  void bindFactoryWo(null);
});

void loadSettings().then(async (settings) => {
  const workspacePath = settings.workspacePath?.trim() || DEFAULT_WORKSPACE;
  workspacePathEl.value = workspacePath;
  if (!settings.workspacePath) {
    await saveWorkspace(workspacePath, {
      preferredIde: settings.preferredIde || "cursor",
    });
  }
  await pingFactoryHeartbeat({ ...settings, workspacePath });
  await refreshIdes(workspacePath);
  if (settings.sessionId) {
    const appLabel = settings.appUrl
      ? `${originOf(settings.appUrl)} · saved session`
      : "Saved session";
    await connectChat(settings.sessionId, appLabel);
    const tab = settings.appUrl ? await findAppTab(settings.appUrl) : null;
    if (tab) await bindAppTab(tab, settings.sessionId, settings.appUrl);
    setStatus("Stay on Clarion. Click the UI, then type here.");
    return;
  }
  setStatus("Stay on Clarion, then Start review. Chat stays in this panel.");
});
