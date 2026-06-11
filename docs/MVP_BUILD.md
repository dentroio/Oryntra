# Oryntra MVP Build Guide

This document is the implementation brief for Phase 1–3 of Oryntra. Hand it to a coding agent or engineer to scaffold the repository.

**Full architecture:** [ARCHITECTURE.md](./ARCHITECTURE.md)

---

## Goal

Build a local tool that lets a developer:

1. Attach to a running web app in a **real Chromium browser**
2. Navigate the UI like production while talking to an AI agent
3. Have the agent understand **where** they are pointing/clicking (mouse, element, route)
4. Convert feedback into **structured artifacts** (change requests, work orders, doc/arch drafts)
5. Persist everything for later handoff to Cursor/VS Code (MCP in Phase 4)

**MVP does not edit source code.**

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Language | TypeScript |
| Backend | Node.js + Fastify |
| Frontend | React + Vite |
| Browser automation | Playwright (non-headless Chromium) |
| Persistence | SQLite (better-sqlite3 or drizzle) |
| Real-time | WebSocket (`@fastify/websocket`) |
| CLI | `commander` or `cac`; binary name `oryntra` |
| Monorepo | npm workspaces or pnpm workspaces |

---

## Recommended Monorepo Layout

```
oryntra/
├── packages/
│   ├── cli/                 # oryntra start, etc.
│   ├── server/              # Fastify backend + WebSocket
│   ├── review-room/         # React/Vite Review Room UI
│   ├── browser-service/     # Playwright capture + spatial resolution
│   ├── core/                # Shared types, data models, config parser
│   └── facilitator/         # ReviewFacilitator interface + stub/mock
├── docs/
├── oryntra.yaml.example
├── package.json
└── README.md
```

---

## CLI

```bash
oryntra start --workspace . --url http://localhost:3000
```

Behavior:

1. Load `oryntra.yaml` from workspace (if present); CLI flags override
2. Start Fastify on `localhost:4317`
3. Create `ReviewSession` with unique ID
4. Launch Playwright Chromium (non-headless) → navigate to `appUrl`
5. Print Review Room URL: `http://localhost:4317/session/{sessionId}`
6. Optionally open Review Room in default browser (`--open`)

Optional flags:

- `--dev-command "npm run dev"` — Oryntra may start dev server if app URL is not reachable (health check)
- `--no-open` — do not auto-open Review Room

---

## Backend (`packages/server`)

### Responsibilities

- Session CRUD
- WebSocket event fan-out
- REST API per [ARCHITECTURE.md](./ARCHITECTURE.md) §11
- Orchestrate `browser-service` and `facilitator`
- SQLite persistence
- Screenshot file storage under `~/.oryntra/sessions/{id}/`

### Key endpoints (MVP)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions/:id` | Session details |
| GET | `/api/sessions/:id/browser-state` | Live spatial state |
| POST | `/api/sessions/:id/feedback` | Submit feedback → FeedbackMoment |
| POST | `/api/sessions/:id/review-mode` | normal / explain_this / element_picker |
| GET | `/api/sessions/:id/artifacts` | List artifacts |
| POST | `/api/sessions/:id/artifacts` | Create/approve artifact |
| GET | `/api/sessions/:id/feedback-moments` | List moments |
| WS | `/api/sessions/:id/events` | Real-time stream |

### Static assets

Serve Review Room SPA from `review-room` build at `/session/*` and `/`.

---

## Browser Service (`packages/browser-service`)

### Playwright setup

```typescript
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto(appUrl);
```

### Event listeners

| Event | Handler |
|-------|---------|
| `page.on('click')` | Emit `BrowserEvent` type `click` with `ElementRef` |
| `page.on('framenavigated')` | Emit `navigation` with route |
| `page.on('console')` | Emit `console_error` for error level |
| `page.on('requestfailed')` | Emit `network_error` |
| `page.on('response')` | Emit `network_error` for status >= 400 |
| Throttled mouse | Sample at 10 Hz → `mouse_sample` events |

### Spatial resolution

On feedback submit, run in page context:

```typescript
async function resolveSpatial(page: Page): Promise<SpatialContext> {
  const data = await page.evaluate(() => {
    const x = /* last known mouse x */;
    const y = /* last known mouse y */;
    const el = document.elementFromPoint(x, y);
    // return route, title, mouse, element metadata, viewport scroll
  });
  return data;
}
```

Also track `lastClickedElement` from most recent click event.

### Screenshots

- Full viewport PNG on each feedback submit
- Store path in SQLite; file on disk
- Optional element crop when `explain_this` or `element_picker` mode active

### Accessibility snapshot

Use Playwright's accessibility snapshot or axe-core subtree for the current route. Store snapshot ID + JSON on disk.

---

## Review Room UI (`packages/review-room`)

### Pages

- `/session/:sessionId` — main review console

### Panels (MVP)

1. **Session header** — session ID, app URL, route, status
2. **Spatial status** — element under cursor, mouse coords, review mode toggle
3. **Chat** — user input + agent responses linked to `feedbackMomentId`
4. **Evidence timeline** — browser events + feedback moments (thumbnail if screenshot exists)
5. **Artifacts** — change requests, work orders, doc/arch drafts with approve/reject

### Review mode controls

- **Normal** — spatial context captured at feedback submit
- **Explain This** — next click or submit binds explicit element subject
- **Element Picker** — user clicks one element in app to lock subject

### WebSocket client

Connect to `/api/sessions/:id/events`. Update timeline, chat, and spatial status in real time.

---

## Review Facilitator (`packages/facilitator`)

MVP ships with a **pluggable interface** and a **stub implementation** that:

- Classifies feedback as correct/missing/wrong/unclear (rule-based or LLM via env `ORYNTRA_LLM_PROVIDER`)
- Drafts a `ChangeRequest` or `WorkOrder` from `FeedbackMoment` spatial data
- Returns optional `clarifyingQuestion` with `candidateElements` when ambiguous

```typescript
// packages/facilitator/src/index.ts
export interface ReviewFacilitator { /* see ARCHITECTURE.md §9.1 */ }
export class StubReviewFacilitator implements ReviewFacilitator { /* ... */ }
```

Do not block MVP on LLM integration — stub must work offline.

---

## Persistence (SQLite)

### Tables (minimum)

- `sessions`
- `browser_events`
- `feedback_moments`
- `chat_messages`
- `artifacts` (JSON blob per row, discriminated by `kind`)
- `screenshots` (metadata only; files on disk)

Use migrations (drizzle-kit or simple SQL files).

---

## Shared Types (`packages/core`)

Export all types from [ARCHITECTURE.md](./ARCHITECTURE.md) §10:

- `ReviewSession`, `ElementRef`, `SpatialContext`, `FeedbackMoment`
- `BrowserEvent`, `ReviewArtifact`, `ChangeRequest`, `WorkOrder`, `DocUpdate`, `ArchitectureUpdate`

Export `loadOryntraConfig(path)` for `oryntra.yaml` parsing.

---

## Security (MVP)

- Bind Fastify to `127.0.0.1` only
- Do not run shell commands except optionally starting configured `devCommand` after health check failure
- Do not modify source files
- Restrict file reads to workspace root (for config and future MCP)
- Redact common secret patterns in logs

---

## Extension Points (interfaces only in MVP)

| Interface | Package | Phase |
|-----------|---------|-------|
| `ReviewFacilitator` | `facilitator` | 1–3 (stub now) |
| `ExecutionAgentProvider` | `core` | 4+ |
| MCP server | `packages/mcp` | 4 |
| VS Code extension | `packages/vscode-extension` | 5 |

---

## npm Scripts (root)

```json
{
  "scripts": {
    "build": "npm run build -ws",
    "dev": "npm run dev -w packages/server & npm run dev -w packages/review-room",
    "test": "npm run test -ws",
    "start": "node packages/cli/dist/index.js start"
  }
}
```

---

## Tests (basic)

- `core`: config parser, type guards
- `browser-service`: element resolution unit tests (mock page)
- `server`: session create, feedback submit, WebSocket emits event
- `facilitator`: stub produces change request from sample FeedbackMoment

---

## Build Order for Coding Agent

1. `packages/core` — types + config
2. `packages/browser-service` — Playwright listeners + spatial resolution
3. `packages/server` — API + WebSocket + SQLite
4. `packages/facilitator` — stub
5. `packages/review-room` — UI panels + WebSocket client
6. `packages/cli` — `oryntra start` wires everything together
7. Root README, example config, smoke test script

---

## Done When

All items in [ARCHITECTURE.md §20](./ARCHITECTURE.md#20-mvp-acceptance-criteria) pass.
