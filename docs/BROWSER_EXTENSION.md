# Oryntra Browser Extension

Enterprise **single-screen** product review: your app runs in a normal browser tab; Oryntra chat runs in the **Chrome side panel**. Spatial capture uses your **real logged-in session** (MFA, maps, API calls intact).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser window                                               │
│  ┌─────────────────────────────┬───────────────────────────┐ │
│  │  Your app (Clarion, etc.)    │  Oryntra Side Panel       │ │
│  │  Normal tab — no iframe      │  Review Studio chat       │ │
│  │  content.js captures clicks  │  IDE status chips         │ │
│  └─────────────────────────────┴───────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
         │                                    │
         └──────────────┬─────────────────────┘
                        v
              Oryntra backend (localhost:4317)
                        │
         ┌──────────────┼──────────────┐
         v              v              v
    Cursor MCP     VS Code MCP    Other IDEs
    (heartbeat)    (future)       (heartbeat)
```

## Capture modes

| Mode | App surface | Best for |
|------|-------------|----------|
| **`extension`** (recommended) | Normal browser tab + side panel | Enterprise apps (Clarion), MFA, maps |
| **`embedded`** | iframe inside Review Studio | Zero-install dev / demo |
| **`playwright`** | Separate Chromium window | Legacy / debugging only |

Set in `oryntra.yaml`:

```yaml
browser:
  mode: extension
```

Or create sessions with `captureMode: extension` from the extension UI.

## Install (development)

```bash
cd /path/to/oryntra
npm run build

# Load unpacked extension in Chrome:
# chrome://extensions → Developer mode → Load unpacked
# → select packages/browser-extension/dist
```

## Configure

1. Open extension **Settings** (right-click extension icon → Options).
2. Set **Workspace path** (e.g. `/Users/you/clarion`).
3. Set **App URL** (e.g. `http://localhost:3000`).
4. Choose **Preferred IDE** for handoff.

## Start a review

1. Ensure Oryntra server is running (`npm run collaborate:restart` or MCP `collaborate_now`).
2. Open your app tab (e.g. Clarion on `:3000`).
3. Click the Oryntra extension → **Start review**.
4. Use the side panel for chat; navigate the app in the main tab.

## Multi-IDE detection

Oryntra discovers IDEs from three sources:

| Source | How |
|--------|-----|
| **MCP heartbeat** | Cursor (or VS Code) MCP sends `POST /api/ide/heartbeat` every 30s while connected |
| **Extension heartbeat** | Browser extension registers as `source: extension` |
| **Local probe** | Server checks for installed Cursor, VS Code, Windsurf binaries |

### API

```http
GET /api/ide/available?workspacePath=/path/to/project
GET /api/ide/connected?workspacePath=/path/to/project
POST /api/ide/heartbeat
```

Response lists each IDE with `provider`, `label`, `connected`, and `source`.

The side panel shows **IDE chips** — green when MCP-connected. Handoff uses `preferredIde` on the session (set from extension settings or `POST /api/sessions/:id/preferred-ide`).

### Supported IDE providers

`cursor` · `vscode` · `windsurf` · `jetbrains` · `zed` · `other`

Add new providers in `@oryntra/core` `IdeProvider` and register via MCP `ORYNTRA_IDE` env.

## What the extension captures

- Clicks, mouse samples, SPA navigation
- Viewport size and scroll
- Console and network errors (fetch/XHR)
- **Screenshots** via `chrome.tabs.captureVisibleTab` (authenticated pixels)
- **Accessibility snapshot** from live DOM

Same backend pipeline as embedded bridge mode (`BridgeSession` + `/bridge-events`).

## Clarion workflow

```bash
# Terminal 1 — backend
docker compose up -d

# Terminal 2 — frontend
cd clarion && npm run dev

# Terminal 3 — Oryntra
cd oryntra && npm run build && npm run dev

# Browser — extension side panel → Start review
# Cursor — MCP enabled with ORYNTRA_WORKSPACE pointing at clarion
```

## Permissions

- `activeTab` / `tabs` — capture visible tab screenshot
- `sidePanel` — Review Studio UI
- `storage` — workspace path and session binding
- `host_permissions` — localhost app URLs and Oryntra API

## See also

- [ARCHITECTURE.md](./ARCHITECTURE.md) §5 Browser Interaction Model
- [MCP_SETUP.md](./MCP_SETUP.md)
- [CURSOR_REVIEW.md](./CURSOR_REVIEW.md)
