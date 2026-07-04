let annotating = false;

async function getConfig() {
  return new Promise(res =>
    chrome.storage.sync.get({ factoryUrl: "http://localhost:8099", activeWo: "", authorName: "human" }, res)
  );
}

async function tryAutoDetect(factoryUrl) {
  try {
    const resp = await fetch(`${factoryUrl}/api/status`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return null;
    const data = await resp.json();
    const dispatch = data.dispatch_state || {};
    for (const [woId, state] of Object.entries(dispatch)) {
      if (["claimed", "in_progress", "awaiting_human"].includes(state.status)) return woId;
    }
  } catch { /* ignore */ }
  return null;
}

async function init() {
  const cfg = await getConfig();
  const woDisplay = document.getElementById("wo-display");

  let activeWo = cfg.activeWo;
  if (!activeWo && cfg.factoryUrl) {
    activeWo = await tryAutoDetect(cfg.factoryUrl);
    if (activeWo) {
      chrome.storage.sync.set({ activeWo });
    }
  }

  if (activeWo) {
    woDisplay.textContent = activeWo;
    woDisplay.className = "wo-badge";
  } else {
    woDisplay.textContent = "Not set — configure in Settings";
    woDisplay.className = "wo-none";
  }
}

document.getElementById("annotate-btn").addEventListener("click", async () => {
  if (annotating) return;
  annotating = true;
  document.getElementById("annotate-btn").style.display = "none";
  document.getElementById("cancel-btn").style.display = "block";
  document.getElementById("status-text").textContent = "annotating…";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/content.js"] }).catch(() => {});
  chrome.tabs.sendMessage(tab.id, { type: "START_ANNOTATION" });
  window.close();
});

document.getElementById("cancel-btn").addEventListener("click", async () => {
  annotating = false;
  document.getElementById("cancel-btn").style.display = "none";
  document.getElementById("annotate-btn").style.display = "block";
  document.getElementById("status-text").textContent = "";

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: "CANCEL_ANNOTATION" }).catch(() => {});
});

document.getElementById("settings-link").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

init();
