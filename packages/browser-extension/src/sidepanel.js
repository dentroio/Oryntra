const API_BASE = "http://127.0.0.1:4317";

const metaEl = document.getElementById("session-meta");
const ideBar = document.getElementById("ide-bar");
const statusEl = document.getElementById("status");
const frame = document.getElementById("review-frame");
const startBtn = document.getElementById("start-btn");
const refreshBtn = document.getElementById("refresh-btn");
const optionsBtn = document.getElementById("options-btn");
const settingsFab = document.getElementById("settings-fab");

function normalizeAppUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

async function findAppTab(appUrl) {
  const origin = normalizeAppUrl(appUrl);
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const match = tabs.find((t) => t.url && t.url.startsWith(origin));
  if (match) return match;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function bindAppTab(tab, sessionId, appUrl) {
  if (!tab?.id) return;
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
  } catch {
    // manifest may already inject; refresh tab if binding still fails
  }
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: "oryntra_bind",
      sessionId,
      appUrl: normalizeAppUrl(appUrl),
    });
  } catch {
    await chrome.tabs.reload(tab.id);
    await new Promise((r) => setTimeout(r, 800));
    await chrome.tabs.sendMessage(tab.id, {
      type: "oryntra_bind",
      sessionId,
      appUrl: normalizeAppUrl(appUrl),
    });
  }
  chrome.runtime.sendMessage({ type: "oryntra_bind_tab", tabId: tab.id });
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
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
    "apiBase",
  ]);
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
    ideBar.innerHTML = '<span class="ide-chip">Server offline</span>';
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

async function ensureSession() {
  const settings = await loadSettings();
  const workspacePath = settings.workspacePath;
  const rawAppUrl = settings.appUrl || (await getActiveTabUrl());
  const appUrl = rawAppUrl ? normalizeAppUrl(rawAppUrl) : null;
  if (!workspacePath) {
    setStatus("Set workspace path in extension Settings.", true);
    metaEl.textContent = "Not configured";
    return null;
  }
  if (!appUrl) {
    setStatus("Open your app tab, then click Start review.", true);
    return null;
  }

  setStatus("Starting session…");
  const preferredIde =
    settings.preferredIde ||
    (await refreshIdes(workspacePath)).find((i) => i.connected)?.provider ||
    "cursor";

  let sessionId = settings.sessionId;
  try {
    const activeRes = await fetch(`${API_BASE}/api/sessions/active`);
    if (activeRes.ok) {
      const active = await activeRes.json();
      if (
        active.workspacePath === workspacePath &&
        active.appUrl === appUrl &&
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
  await bindAppTab(tab, sessionId, appUrl);

  document.body.classList.add("review-active");

  metaEl.textContent = `${appUrl} · extension mode`;
  frame.src = `${API_BASE}/session/${sessionId}?layout=sidepanel`;
  setStatus(
    tab?.id
      ? "Bound to Clarion. After reloading the extension, refresh the Clarion tab (Cmd+R)."
      : "Open your app tab, then Start review again.",
  );
  await refreshIdes(workspacePath);
  return sessionId;
}

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

settingsFab.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

void loadSettings().then(async (settings) => {
  if (settings.sessionId && settings.appUrl) {
    frame.src = `${API_BASE}/session/${settings.sessionId}?layout=sidepanel`;
    metaEl.textContent = `${normalizeAppUrl(settings.appUrl)} · extension mode`;
    document.body.classList.add("review-active");
    await refreshIdes(settings.workspacePath);
    const tab = await findAppTab(settings.appUrl);
    await bindAppTab(tab, settings.sessionId, settings.appUrl);
    setStatus("Session resumed. Click around Clarion to update route and events.");
  } else {
    await refreshIdes(settings.workspacePath);
    setStatus("Configure workspace in Settings, open your app tab, then Start review.");
  }
});
