# Oryntra

Chrome extension for annotating web UI and sending screenshots directly to the AI Factory WO thread.

## What it does

When an agent implements a UI change, you can annotate exactly what's wrong visually — circles, arrows, text — and send it directly to the WO thread with one click. The agent receives your screenshot with annotations and can fix the specific element without ambiguity.

## Install (Developer mode)

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select this directory
3. Click the Oryntra icon → **Settings** → configure:
   - **AI Factory URL**: `http://localhost:8099` (or your factory host)
   - **Active WO**: `WO-370` (or click **Auto-detect** to pull from factory)
   - **Your Name**: shown as author in the thread

## Usage

1. Navigate to the page you want to annotate
2. Click the Oryntra extension icon
3. Click **Annotate this page** — a drawing toolbar appears
4. Draw circles, arrows, or text on the page
5. Add a note in the text box
6. Click **Send to Factory** — screenshot + annotations posted to the WO thread within 2s

## Files

```
manifest.json          Extension manifest (MV3)
popup.html / popup.js  Extension popup
options.html / options.js  Settings page
src/
  background.js        Service worker — tab screenshot capture
  content.js           Drawing overlay injected into pages
  factory.js           Factory API client (reusable module)
```

## Factory integration

Annotations POST to `{factoryUrl}/api/proxy/thread/{activeWo}/messages` with:
```json
{
  "author": "human",
  "role": "human",
  "type": "image",
  "content": "your note text",
  "image_data": "<base64 PNG>",
  "metadata": { "source_url": "https://...", "tool": "oryntra" }
}
```

The status site proxy forwards to the orchestrator, which saves the image to disk and returns a served URL. The image appears inline in the WO thread.
