const API_BASE = "http://127.0.0.1:4317";
const CAPTURE_POLL_MS = 300;

let activeSessionId = null;
let activeTabId = null;

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.sessionId) {
    activeSessionId = changes.sessionId.newValue ?? null;
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "oryntra_bridge_event" && message.sessionId && message.payload) {
    void fetch(`${API_BASE}/api/sessions/${message.sessionId}/bridge-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    }).catch(() => {});
    return false;
  }
  if (message.type === "oryntra_bind_tab") {
    activeTabId = message.tabId ?? sender.tab?.id ?? null;
    sendResponse({ ok: true });
    return false;
  }
  if (message.type === "oryntra_get_binding") {
    sendResponse({ sessionId: activeSessionId, tabId: activeTabId });
    return false;
  }
  return false;
});

async function loadBinding() {
  const data = await chrome.storage.local.get(["sessionId", "boundTabId"]);
  activeSessionId = data.sessionId ?? null;
  activeTabId = data.boundTabId ?? null;
}

async function pollPendingCapture() {
  await loadBinding();
  if (!activeSessionId || activeTabId == null) return;

  const pendingRes = await fetch(
    `${API_BASE}/api/sessions/${activeSessionId}/bridge-capture/pending`,
  );
  if (!pendingRes.ok) return;
  const pending = await pendingRes.json();
  if (!pending.screenshotId && !pending.snapshotId) return;

  const body = {};
  if (pending.screenshotId) {
    const pngBase64 = await captureTab(activeTabId);
    if (pngBase64) {
      body.screenshotId = pending.screenshotId;
      body.pngBase64 = pngBase64;
    }
  }
  if (pending.snapshotId) {
    body.snapshotId = pending.snapshotId;
    body.snapshotText = await requestSnapshotFromTab(activeTabId);
  }
  if (!body.screenshotId && !body.snapshotId) return;

  await fetch(`${API_BASE}/api/sessions/${activeSessionId}/bridge-capture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function captureTab(tabId) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
    });
    return dataUrl.split(",")[1] ?? null;
  } catch {
    return null;
  }
}

async function requestSnapshotFromTab(tabId) {
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const lines = [];
        function walk(el, depth) {
          if (!el || el.nodeType !== 1 || depth > 10 || lines.length > 300) return;
          const tag = el.tagName.toLowerCase();
          if (tag === "script" || tag === "style") return;
          const role = el.getAttribute("role") || tag;
          const name =
            el.getAttribute("aria-label") ||
            el.getAttribute("title") ||
            (el.textContent || "").trim().slice(0, 80);
          if (name) lines.push("  ".repeat(depth) + role + ': "' + name + '"');
          for (const child of el.children) walk(child, depth + 1);
        }
        walk(document.body, 0);
        return (
          "url: " +
          location.href +
          "\ntitle: " +
          document.title +
          "\n\n" +
          lines.join("\n")
        );
      },
    });
    return result?.result ?? "";
  } catch {
    return "";
  }
}

async function extensionHeartbeat() {
  const data = await chrome.storage.local.get([
    "workspacePath",
    "preferredIde",
  ]);
  await fetch(`${API_BASE}/api/ide/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: data.preferredIde || "other",
      clientId: "browser-extension",
      workspacePath: data.workspacePath,
      source: "extension",
      label: "Oryntra Extension",
    }),
  }).catch(() => {});
}

setInterval(() => {
  void pollPendingCapture();
}, CAPTURE_POLL_MS);

setInterval(() => {
  void extensionHeartbeat();
}, 30_000);

void extensionHeartbeat();
