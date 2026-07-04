/**
 * Oryntra content script — annotation UI injected into every page.
 *
 * Workflow:
 * 1. User clicks the extension icon → popup.js sends "START_ANNOTATION"
 * 2. content.js shows a floating toolbar with annotation tools
 * 3. User draws on a canvas overlay (arrows, circles, text)
 * 4. User clicks "Send to Factory" → captures tab screenshot via background,
 *    overlays annotations, then posts to the factory proxy
 */

let _annotationActive = false;
let _overlay = null;
let _canvas = null;
let _ctx = null;
let _tool = "circle"; // circle | arrow | text
let _drawing = false;
let _startX = 0;
let _startY = 0;
let _snapshots = []; // for undo

const COLORS = { stroke: "#FF4136", fill: "rgba(255,65,54,0.15)", text: "#FF4136" };

// ── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "START_ANNOTATION") {
    startAnnotation();
    sendResponse({ ok: true });
  }
  if (msg.type === "CANCEL_ANNOTATION") {
    cancelAnnotation();
    sendResponse({ ok: true });
  }
});

// ── Annotation session ────────────────────────────────────────────────────────

function startAnnotation() {
  if (_annotationActive) return;
  _annotationActive = true;

  // Full-page overlay
  _overlay = document.createElement("div");
  _overlay.id = "oryntra-overlay";
  Object.assign(_overlay.style, {
    position: "fixed", inset: "0", zIndex: "2147483647",
    cursor: "crosshair", background: "transparent",
  });

  // Drawing canvas
  _canvas = document.createElement("canvas");
  _canvas.width = window.innerWidth;
  _canvas.height = window.innerHeight;
  Object.assign(_canvas.style, { position: "absolute", inset: "0", pointerEvents: "none" });
  _ctx = _canvas.getContext("2d");

  _overlay.appendChild(_canvas);
  _overlay.appendChild(buildToolbar());
  document.body.appendChild(_overlay);

  // Drawing events
  _overlay.addEventListener("mousedown", onMouseDown);
  _overlay.addEventListener("mousemove", onMouseMove);
  _overlay.addEventListener("mouseup", onMouseUp);
}

function cancelAnnotation() {
  if (!_annotationActive) return;
  _overlay?.remove();
  _annotationActive = false;
  _snapshots = [];
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function buildToolbar() {
  const bar = document.createElement("div");
  bar.id = "oryntra-toolbar";
  Object.assign(bar.style, {
    position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
    display: "flex", gap: "8px", alignItems: "center",
    background: "#1e293b", border: "1px solid #334155", borderRadius: "12px",
    padding: "8px 12px", boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
    zIndex: "2147483648",
  });

  const tools = [
    { id: "circle", label: "⭕ Circle" },
    { id: "arrow", label: "↗ Arrow" },
    { id: "text", label: "T Text" },
  ];

  tools.forEach(({ id, label }) => {
    const btn = makeBtn(label, () => {
      _tool = id;
      bar.querySelectorAll("[data-tool]").forEach(b => b.style.background = "#1e293b");
      btn.style.background = "#334155";
    });
    btn.dataset.tool = id;
    if (id === _tool) btn.style.background = "#334155";
    bar.appendChild(btn);
  });

  bar.appendChild(makeSep());

  bar.appendChild(makeBtn("↩ Undo", () => {
    if (_snapshots.length > 0) {
      const prev = _snapshots.pop();
      _ctx.putImageData(prev, 0, 0);
    }
  }));

  bar.appendChild(makeBtn("✕ Cancel", cancelAnnotation, "#7f1d1d", "#fca5a5"));

  bar.appendChild(makeSep());

  // Note textarea
  const note = document.createElement("textarea");
  Object.assign(note.style, {
    width: "200px", height: "32px", background: "#0f172a", color: "#e2e8f0",
    border: "1px solid #475569", borderRadius: "6px", padding: "4px 8px",
    fontSize: "11px", resize: "none", fontFamily: "monospace",
  });
  note.placeholder = "Add a note…";
  bar.appendChild(note);

  bar.appendChild(makeBtn("📤 Send to Factory", () => sendToFactory(note.value.trim()), "#1e3a5f", "#93c5fd"));

  return bar;
}

function makeBtn(label, onClick, bg = "#1e293b", color = "#e2e8f0") {
  const btn = document.createElement("button");
  btn.textContent = label;
  Object.assign(btn.style, {
    background: bg, color, border: "1px solid #475569", borderRadius: "6px",
    padding: "4px 10px", fontSize: "11px", cursor: "pointer", fontFamily: "sans-serif",
    whiteSpace: "nowrap",
  });
  btn.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  return btn;
}

function makeSep() {
  const sep = document.createElement("div");
  Object.assign(sep.style, { width: "1px", height: "24px", background: "#334155", margin: "0 4px" });
  return sep;
}

// ── Drawing ───────────────────────────────────────────────────────────────────

function saveSnapshot() {
  _snapshots.push(_ctx.getImageData(0, 0, _canvas.width, _canvas.height));
  if (_snapshots.length > 20) _snapshots.shift();
}

function onMouseDown(e) {
  if (e.target.closest("#oryntra-toolbar")) return;
  _drawing = true;
  _startX = e.clientX;
  _startY = e.clientY;
  saveSnapshot();

  if (_tool === "text") {
    const text = prompt("Enter text annotation:");
    if (text) {
      _ctx.font = "bold 16px sans-serif";
      _ctx.fillStyle = COLORS.text;
      _ctx.strokeStyle = "#000";
      _ctx.lineWidth = 2;
      _ctx.strokeText(text, e.clientX, e.clientY);
      _ctx.fillText(text, e.clientX, e.clientY);
    }
    _drawing = false;
  }
}

let _liveSnapshot = null;

function onMouseMove(e) {
  if (!_drawing || _tool === "text") return;
  if (_liveSnapshot) _ctx.putImageData(_liveSnapshot, 0, 0);
  else _liveSnapshot = _ctx.getImageData(0, 0, _canvas.width, _canvas.height);

  const x = e.clientX, y = e.clientY;
  _ctx.strokeStyle = COLORS.stroke;
  _ctx.fillStyle = COLORS.fill;
  _ctx.lineWidth = 2;

  if (_tool === "circle") {
    const rx = Math.abs(x - _startX) / 2;
    const ry = Math.abs(y - _startY) / 2;
    const cx = Math.min(_startX, x) + rx;
    const cy = Math.min(_startY, y) + ry;
    _ctx.beginPath();
    _ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    _ctx.fill();
    _ctx.stroke();
  } else if (_tool === "arrow") {
    drawArrow(_ctx, _startX, _startY, x, y);
  }
}

function onMouseUp() {
  _drawing = false;
  _liveSnapshot = null;
}

function drawArrow(ctx, x1, y1, x2, y2) {
  const headLen = 14;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

// ── Send to factory ───────────────────────────────────────────────────────────

async function sendToFactory(noteText) {
  // Ask background to capture the tab screenshot, then composite annotations
  const response = await chrome.runtime.sendMessage({ type: "CAPTURE_TAB" });
  if (!response?.dataUrl) {
    showToast("Screenshot failed — check extension permissions.", "error");
    return;
  }

  // Composite annotations onto screenshot
  const composited = await compositeAnnotations(response.dataUrl);

  const config = await new Promise(res =>
    chrome.storage.sync.get({ factoryUrl: "http://localhost:8099", activeWo: "", authorName: "human" }, res)
  );

  if (!config.activeWo) {
    showToast("Set Active WO in Oryntra settings first.", "error");
    return;
  }

  try {
    const resp = await fetch(`${config.factoryUrl}/api/proxy/thread/${config.activeWo}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        author: config.authorName || "human",
        role: "human",
        type: "image",
        content: noteText,
        image_data: composited.split(",")[1],
        metadata: { source_url: window.location.href, tool: "oryntra" },
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    showToast("✓ Sent to factory thread!", "success");
    cancelAnnotation();
  } catch (err) {
    showToast(`Failed: ${err.message}`, "error");
  }
}

async function compositeAnnotations(screenshotDataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // Scale annotation canvas to match screenshot dimensions
      const scaleX = img.width / _canvas.width;
      const scaleY = img.height / _canvas.height;
      ctx.save();
      ctx.scale(scaleX, scaleY);
      ctx.drawImage(_canvas, 0, 0);
      ctx.restore();
      resolve(c.toDataURL("image/png"));
    };
    img.src = screenshotDataUrl;
  });
}

function showToast(msg, type = "info") {
  const toast = document.createElement("div");
  Object.assign(toast.style, {
    position: "fixed", bottom: "80px", left: "50%", transform: "translateX(-50%)",
    background: type === "error" ? "#7f1d1d" : "#14532d",
    color: type === "error" ? "#fca5a5" : "#86efac",
    border: `1px solid ${type === "error" ? "#ef4444" : "#22c55e"}`,
    borderRadius: "8px", padding: "8px 16px", fontSize: "12px",
    zIndex: "2147483649", pointerEvents: "none", boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
  });
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
