const statusEl = document.getElementById("status");

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.className = isError ? "error" : "";
  setTimeout(() => { statusEl.textContent = ""; }, 3000);
}

// Load saved settings
chrome.storage.sync.get({ factoryUrl: "http://localhost:8099", activeWo: "", authorName: "human" }, (cfg) => {
  document.getElementById("factoryUrl").value = cfg.factoryUrl;
  document.getElementById("activeWo").value = cfg.activeWo;
  document.getElementById("authorName").value = cfg.authorName;
});

document.getElementById("save-btn").addEventListener("click", () => {
  const settings = {
    factoryUrl: document.getElementById("factoryUrl").value.trim().replace(/\/$/, ""),
    activeWo: document.getElementById("activeWo").value.trim(),
    authorName: document.getElementById("authorName").value.trim() || "human",
  };
  chrome.storage.sync.set(settings, () => showStatus("Saved!"));
});

document.getElementById("detect-btn").addEventListener("click", async () => {
  const factoryUrl = document.getElementById("factoryUrl").value.trim().replace(/\/$/, "");
  if (!factoryUrl) { showStatus("Enter Factory URL first", true); return; }

  statusEl.textContent = "Detecting…";
  statusEl.className = "";

  try {
    const resp = await fetch(`${factoryUrl}/api/factory/dispatch`, { signal: AbortSignal.timeout(4000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dispatch = await resp.json();
    const active = Object.entries(dispatch)
      .filter(([, state]) => ["claimed", "in_progress", "awaiting_human"].includes(state.status))
      .sort(([, a], [, b]) => (b.claimed_at || "").localeCompare(a.claimed_at || ""));
    const found = active.length ? active[0][0] : null;
    if (found) {
      document.getElementById("activeWo").value = found;
      showStatus(`Detected: ${found}`);
    } else {
      showStatus("No active WO found on factory", true);
    }
  } catch (err) {
    showStatus(`Error: ${err.message}`, true);
  }
});
