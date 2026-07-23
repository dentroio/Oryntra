/**
 * Factory integration — posts annotated screenshots to the AI Factory WO thread.
 *
 * The status site at baseUrl exposes a CORS-friendly proxy at:
 *   POST /api/proxy/thread/{wo}/messages
 *
 * Call sendAnnotationToFactory() after the user completes an annotation.
 */

export async function loadFactoryConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { factoryUrl: "http://localhost:8099", activeWo: "", authorName: "human" },
      resolve
    );
  });
}

export async function detectActiveWo(factoryUrl) {
  try {
    const resp = await fetch(`${factoryUrl}/api/factory/dispatch`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return null;
    const dispatch = await resp.json();
    // Most recently claimed WO that is still active
    const active = Object.entries(dispatch)
      .filter(([, state]) => ["claimed", "in_progress", "awaiting_human"].includes(state.status))
      .sort(([, a], [, b]) => (b.claimed_at || "").localeCompare(a.claimed_at || ""));
    return active.length ? active[0][0] : null;
  } catch {
    return null;
  }
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function sendAnnotationToFactory({ factoryUrl, activeWo, authorName, screenshot, annotationText, pageUrl }) {
  if (!factoryUrl || !activeWo) {
    throw new Error("Factory URL and active WO must be configured in Oryntra settings.");
  }

  const base64 = screenshot instanceof Blob
    ? await blobToBase64(screenshot)
    : screenshot; // already base64 string

  const endpoint = `${factoryUrl}/api/proxy/thread/${activeWo}/messages`;

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      author: authorName || "human",
      role: "human",
      type: "image",
      content: annotationText || "",
      image_data: base64,
      metadata: { source_url: pageUrl, tool: "oryntra" },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Factory returned ${resp.status}: ${body.slice(0, 200)}`);
  }

  return resp.json();
}
