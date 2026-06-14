# Oryntra Architecture and Design Specification

**Version:** 1.2  
**Status:** Active — extension + multi-IDE registry  
**Audience:** Autonomous coding agents and human engineers

Oryntra is a local, IDE-connected **interactive product review room** for web applications built by AI coding agents. A developer navigates a running app like production, points at UI elements, and explains what is correct, missing, or wrong — while an AI agent captures **spatial context** (mouse position, clicks, element identity, screenshots) and turns feedback into **actionable artifacts**: change requests, documentation updates, architecture notes, and work orders. Execution flows back to Cursor, VS Code, or another IDE via MCP.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Design Principles](#2-design-principles)
3. [Problem Statement](#3-problem-statement)
4. [Architecture Overview](#4-architecture-overview)
5. [Browser Interaction Model](#5-browser-interaction-model)
6. [Review Room Web App](#6-review-room-web-app)
7. [Interactive Agent Loop](#7-interactive-agent-loop)
8. [IDE Integration](#8-ide-integration)
9. [Agent Roles](#9-agent-roles)
10. [Core Data Models](#10-core-data-models)
11. [Local API Specification](#11-local-api-specification)
12. [WebSocket Event Stream](#12-websocket-event-stream)
13. [MCP Server Tool Surface](#13-mcp-server-tool-surface)
14. [Browser Automation](#14-browser-automation)
15. [Voice Design](#15-voice-design)
16. [Security and Safety](#16-security-and-safety)
17. [Project Configuration](#17-project-configuration)
18. [Implementation Roadmap](#18-implementation-roadmap)
19. [MVP Build Instructions](#19-mvp-build-instructions)
20. [MVP Acceptance Criteria](#20-mvp-acceptance-criteria)

---

## 1. Executive Summary

Oryntra closes the gap between **live product behavior** and **AI-assisted development**. Coding agents can write code, but they often lack the real-time human intent that emerges when someone clicks through the actual UI. Oryntra provides a shared, spatial review session: the developer uses a real browser; the agent sees where they are, what they clicked, and what they said.

**Primary architectural choice (v1.2):** **Single-screen enterprise review** via the **Oryntra browser extension** — the app runs in a normal browser tab; Review Studio runs in the **Chrome side panel**. The local backend correlates spatial capture from the extension with IDE handoff over MCP.

**Secondary path (dev / demo):** **Embedded mode** — app in Review Studio iframe with bridge script (zero install).

**Legacy path:** Playwright-attached separate Chromium window — not recommended for daily use.

**Primary output choice:** Feedback produces **structured artifacts** — not only code patches. Artifacts include change requests, documentation updates, architecture amendments, and work orders that hand off to the IDE agent for execution.

---

## 2. Design Principles

| Principle | Meaning |
|-----------|---------|
| **Production-like navigation** | The user interacts with a real browser session on the dev/staging app URL. Routing, forms, modals, and state behave as in production. |
| **Spatial + conversational context** | Every feedback moment carries route, element, mouse position, recent events, and optional screenshot evidence. |
| **Show, don't tell** | The agent resolves "this button" to a concrete DOM element without the user manually attaching screenshots or Loom videos. |
| **Interactive clarification** | The agent can ask "Do you mean this element?" and the user confirms by click, picker, or yes/no. |
| **IDE executes, Review Room discovers** | Oryntra captures product truth; Cursor/VS Code records and builds it (docs, architecture, code, tests). |
| **Approval-gated changes** | Source edits, shell commands, and patches require explicit approval in MVP and by default thereafter. |
| **Localhost-first** | Bind to localhost; workspace-scoped file access; no public tunnels unless explicitly enabled. |

---

## 3. Problem Statement

AI coding agents can write code, but they often lack the real-time human product intent that emerges while someone clicks through the actual UI. The missing loop is not just code review — it is **live product behavior review**: what the user expected, what the application actually did, and how the implementation should change.

Describing UI in words alone is lossy ("the button on the right", "when I click here"). Screenshots and video help but are manual and detached. Oryntra automates spatial and visual context so the agent understands **where** the user is explaining.

### 3.1 Target Use Cases

- Review UI behavior while an AI coding agent is actively building or modifying an app.
- Navigate workflows in a real browser while talking or typing about what is correct, missing, or wrong.
- Convert feedback into structured change requests, documentation updates, architecture notes, and work orders.
- Link feedback to browser events, mouse position, selected UI elements, screenshots, console logs, network calls, routes, and source files.
- Ask clarifying questions while the human is interacting with the live application.
- Hand off artifacts to Cursor, VS Code, or another IDE agent to update docs, architecture specs, and implement build tasks.
- Generate validation tests (especially Playwright e2e) based on expected behavior.
- Keep product review, coding, diffs, and verification connected without overloading the IDE.

---

## 4. Architecture Overview

```
Human Developer
  | voice, mouse, keyboard, product intent
  v
Review Room Web App  (localhost:4317)
  | HTTP / WebSocket
  v
Oryntra Local Backend  (Fastify, SQLite)
  | session, agent, browser, IDE, repo, artifact orchestration
  +--> Browser Automation Service
  |      Playwright-controlled Chromium (user navigates here)
  |
  +--> IDE Bridge
  |      Cursor MCP Server (first)
  |      VS Code Extension (second)
  |
  +--> Review Facilitator Agent
  |      conversation, clarification, artifact drafting
  |
  +--> Execution Agent Provider (IDE-side)
  |      Codex / Cursor Agent / Claude Code / local agents
  |
  +--> Workspace Manager
  |      Git repo / worktree / tests / package manager
  |
  +--> Persistence Layer
         SQLite (MVP); Postgres optional later
```

### 4.1 Component Responsibility Matrix

| Component | Responsibilities | Implementation Notes |
|-----------|------------------|----------------------|
| **Review Room Web App** | Live session UI, transcript, spatial evidence strip, change requests, work orders, approval controls | React/Vite; WebSocket event stream |
| **Oryntra Backend** | Session orchestration, spatial correlation, agent loop, persistence, API, security | Node.js/TypeScript, Fastify; localhost only |
| **Browser Extension** | Enterprise capture from real browser tab; side panel Review Studio; IDE chips | Chrome MV3; `@oryntra/browser-extension` |
| **IDE Registry** | Multi-IDE heartbeat, probe, session `preferredIde` | In-process registry on backend |
| **Browser Automation** | Spatial capture via extension bridge, embedded bridge, or Playwright | `@oryntra/browser-service` |
| **IDE Bridge** | Launch sessions, MCP tools, handoff to coding agents | MCP stdio; VS Code extension planned |
| **Review Facilitator** | Clarify feedback, resolve elements, draft artifacts, interactive Q&A | LLM via configured provider; session-scoped |
| **Execution Agent Provider** | Apply approved artifacts in IDE workspace (docs, code, tests) | Provider abstraction; runs in IDE via MCP |
| **Workspace Manager** | Detect repo, Git worktree (lazy), run allowlisted commands | Worktree created on first approved patch (Phase 4+) |
| **Persistence** | Sessions, feedback moments, events, artifacts, patches, test results | SQLite for MVP |

---

## 5. Browser Interaction Model

Oryntra supports three **capture modes**. Enterprise deployments should use **`extension`**.

### 5.1 Extension mode (enterprise default)

| Aspect | Behavior |
|--------|----------|
| App surface | Normal browser tab at `appUrl` (no iframe) |
| Review UI | Chrome **side panel** → Review Studio (`?layout=sidepanel`) |
| Capture | Extension content script → `/bridge-events`; background → `captureVisibleTab` |
| Screenshots | Authenticated pixels from the user's visible tab |
| MFA / OAuth | Works — app is not embedded |

### 5.2 Embedded mode (dev / demo)

| Aspect | Behavior |
|--------|----------|
| App surface | iframe in Review Studio left panel |
| Bridge | `oryntra-bridge.js` injected via query params |
| Screenshots | html2canvas in iframe session (bridge upload) |

### 5.3 Playwright mode (legacy)

Separate non-headless Chromium window. Two-window UX — avoid for Clarion-scale review.

### 5.4 Spatial Signals Captured

| Signal | When | Purpose |
|--------|------|---------|
| **Click events** | Always | Target element, route, timestamp |
| **Route / navigation** | Always | Workflow context |
| **Mouse position** | On feedback submit; throttled during session (10 Hz max) | Resolve "this area" / "here" |
| **Element under pointer** | On feedback submit | `elementFromPoint` + a11y metadata |
| **Last clicked element** | On feedback submit | Disambiguate recent actions |
| **Viewport + scroll** | On feedback submit | Layout context |
| **Console / network errors** | Always | Debugging evidence |
| **Accessibility snapshot** | On feedback + on route change | Structured UI tree for LLM |
| **Screenshot** | On feedback; on demand | Visual evidence for layout/color/motion |
| **Short video clip** | Phase 6+ | Replay transitions around feedback moment |

### 5.5 "Explain This" Mode

User activates **Explain This** (hotkey or Review Room button). The next click — or current pointer position at submit — becomes the **subject** of the next feedback message. The element receives a brief visual pulse in the evidence strip (bbox on captured screenshot).

### 5.6 Element Picker Mode

User activates **Element Picker**, then clicks one element in the app. Oryntra locks that element as the explicit subject, bypassing ambiguity in crowded UIs.

---

## 6. Review Room Web App

The Review Room is the collaboration console — not a code editor.

```
+--------------------------------------------------------------------------------+
| Session: clarion-ui | Branch: main | App: localhost:3000 | Agent: active      |
+-----------------------------------------------+--------------------------------+
|                                               | AI Conversation                |
|  [App runs in separate Chromium window]       | - human feedback               |
|  Status: route, element under cursor, health  | - agent clarifications         |
|                                               | - proposed artifacts           |
+-----------------------------------------------+--------------------------------+
| Evidence Timeline | Spatial | Console | Network | Artifacts | Tests          |
+--------------------------------------------------------------------------------+
```

### 6.1 Panels

| Panel | Purpose | MVP |
|-------|---------|-----|
| **Session status** | Route, page title, element under cursor, app health | Required |
| **AI conversation** | Typed feedback; agent questions and responses | Required |
| **Evidence timeline** | Clicks, routes, errors, feedback moments with thumbnails | Required |
| **Spatial context** | Mouse coords, resolved element, bbox highlight on screenshot | Required |
| **Artifacts** | Change requests, work orders, doc/arch updates | Required |
| **Console / network** | Errors and failed requests | Required |
| **Tests / verification** | Manual in MVP; Playwright in later phases | Optional MVP |

---

## 7. Interactive Agent Loop

The review session is **two-way**, not a one-shot transcript.

```
1. User navigates app in Chromium
2. User hovers/clicks or activates Explain This / Element Picker
3. User types or speaks feedback
4. Oryntra attaches SpatialContext + recent events + screenshot
5. Review Facilitator interprets: correct / missing / wrong / unclear
6. If unclear → agent asks clarifying question with element highlight
7. User confirms (yes/no, click, picker)
8. Agent drafts artifact(s): ChangeRequest, WorkOrder, DocUpdate, etc.
9. User approves or says "go implement"
10. MCP handoff → IDE Execution Agent updates docs/arch/code
```

### 7.1 Feedback Correlation (v1 Rule)

When feedback is submitted:

1. Capture `SpatialContext` at submit time (mouse, element under pointer, last click, viewport).
2. Attach the last **5** browser events within 60 seconds.
3. Capture accessibility snapshot and screenshot.
4. Store as a `FeedbackMoment` linked to the chat message.

---

## 8. IDE Integration

The IDE launches sessions, receives artifacts, opens files/diffs, and executes work orders. It does **not** host the full Review Room.

Oryntra supports **multiple IDEs simultaneously** via the **IDE Registry** — each connected MCP client or extension sends heartbeats; Review Studio and the browser extension display available IDEs and route handoff to the session's `preferredIde`.

```
IDE (Cursor / VS Code / Windsurf / …)
  <-> Oryntra MCP Bridge (heartbeat → IDE Registry)
  <-> Browser Extension (optional side panel)
  <-> Oryntra Backend
  <-> Review Room Web App
  <-> Browser Capture (extension | embedded | playwright)
  <-> Execution Agent (in IDE)
  <-> Git / Tests
```

### 8.1 IDE Registry (multi-IDE)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/ide/heartbeat` | MCP, extension, or CLI registers `{ provider, clientId, workspacePath, source }` |
| `GET /api/ide/connected` | Live MCP/extension connections (90s TTL) |
| `GET /api/ide/available` | Connected + probed installed IDEs |
| `POST /api/sessions/:id/preferred-ide` | Set handoff target for session |

**Providers:** `cursor` · `vscode` · `windsurf` · `jetbrains` · `zed` · `other`

Detection sources:

1. **MCP heartbeat** — `ORYNTRA_IDE=cursor` (or vscode, etc.) on MCP startup and every 30s
2. **Extension heartbeat** — browser extension registers while side panel is active
3. **Local probe** — server checks for installed app bundles / CLI binaries

### 8.2 Cursor (MCP — primary)

Expose a local MCP server with session, spatial, transcript, artifact, and handoff tools. The Cursor agent calls Oryntra for review context, then edits files in the attached workspace.

Example flow:

```
User in Review Room: "The devices drawer is wrong — update the arch spec and create a work order"
User: "Go implement in Cursor"

Cursor Agent (via MCP):
  - get_review_context
  - list_review_artifacts
  - handoff_to_ide
  → Updates Oryntra_Architecture_and_Design_Spec / docs
  → Implements code per work order
```

### 8.3 VS Code (MCP + extension — planned)

- **Commands:** `Oryntra: Start Session`, `Attach Workspace`, `Open Review Room`
- **Status bar:** active session, app URL, branch
- **Side panel:** artifacts summary, latest verification
- **Open file / diff:** backend can request IDE to open a component or spec file

---

## 9. Agent Roles

Split v1.0's single `CodingAgentProvider` into two roles.

### 9.1 Review Facilitator (Oryntra-side)

Runs in the Oryntra backend during review sessions.

```typescript
interface ReviewFacilitator {
  processFeedback(input: {
    moment: FeedbackMoment;
    transcript: string;
    session: ReviewSession;
  }): Promise<FacilitatorResponse>;

  clarify(input: {
    moment: FeedbackMoment;
    question: string;
    candidateElements: ElementRef[];
  }): Promise<ClarificationResponse>;

  draftArtifacts(input: {
    moments: FeedbackMoment[];
    session: ReviewSession;
  }): Promise<ReviewArtifact[]>;
}

type FacilitatorResponse = {
  interpretation: "correct" | "missing" | "wrong" | "unclear";
  summary: string;
  clarifyingQuestion?: string;
  candidateElements?: ElementRef[];
  suggestedArtifacts?: ReviewArtifact[];
};
```

### 9.2 Execution Agent Provider (IDE-side)

Runs in Cursor/VS Code via MCP. Implements approved artifacts.

```typescript
interface ExecutionAgentProvider {
  name: string;
  applyWorkOrder(order: WorkOrder): Promise<ExecutionResult>;
  applyDocUpdate(update: DocUpdate): Promise<ExecutionResult>;
  applyArchitectureUpdate(update: ArchitectureUpdate): Promise<ExecutionResult>;
  proposePatch(request: ChangeRequest): Promise<ProposedPatch>;
  applyPatch(patch: ProposedPatch): Promise<PatchResult>;
  runTests(request: TestRunRequest): Promise<TestRunResult>;
}
```

---

## 10. Core Data Models

### 10.1 ReviewSession

```typescript
type ReviewSession = {
  id: string;
  workspacePath: string;
  repoName: string;
  branchName: string;
  worktreePath?: string;
  appUrl: string;
  devServerCommand?: string;
  status:
    | "starting"
    | "active"
    | "reviewing"
    | "handoff"
    | "paused"
    | "closed"
    | "failed";
  errorMessage?: string;
  ide?: "cursor" | "vscode" | "other";
  reviewMode?: "normal" | "explain_this" | "element_picker";
  createdAt: string;
  updatedAt: string;
};
```

### 10.2 ElementRef

```typescript
type ElementRef = {
  selector: string;
  role?: string;
  name?: string;
  text?: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  domPath?: string;
};
```

### 10.3 SpatialContext

```typescript
type SpatialContext = {
  route: string;
  pageTitle: string;
  mouse: { x: number; y: number };
  elementUnderPointer?: ElementRef;
  lastClickedElement?: ElementRef;
  viewport: {
    width: number;
    height: number;
    scrollX: number;
    scrollY: number;
  };
};
```

### 10.4 FeedbackMoment

```typescript
type FeedbackMoment = {
  id: string;
  sessionId: string;
  timestamp: string;
  modality: "typed" | "voice" | "click_only" | "explain_this" | "element_picker";
  transcript?: string;
  spatial: SpatialContext;
  screenshotId?: string;
  accessibilitySnapshotId?: string;
  clipId?: string;
  recentEventIds: string[];
  linkedArtifactIds?: string[];
};
```

### 10.5 BrowserEvent

```typescript
type BrowserEvent =
  | {
      id: string;
      sessionId: string;
      type: "click";
      timestamp: string;
      route: string;
      element?: ElementRef;
      screenshotId?: string;
    }
  | {
      id: string;
      sessionId: string;
      type: "navigation" | "console_error" | "network_error" | "dom_snapshot";
      timestamp: string;
      route?: string;
      message?: string;
      url?: string;
      status?: number;
      payload?: unknown;
    }
  | {
      id: string;
      sessionId: string;
      type: "mouse_sample";
      timestamp: string;
      route: string;
      mouse: { x: number; y: number };
      elementUnderPointer?: ElementRef;
    };
```

### 10.6 Review Artifacts

```typescript
type ReviewArtifact =
  | ChangeRequest
  | WorkOrder
  | DocUpdate
  | ArchitectureUpdate;

type ChangeRequest = {
  kind: "change_request";
  id: string;
  sessionId: string;
  title: string;
  userIntent: string;
  currentBehavior: string;
  expectedBehavior: string;
  affectedRoutes: string[];
  affectedElements?: ElementRef[];
  affectedComponents?: CodeReference[];
  priority: "low" | "medium" | "high";
  status:
    | "draft"
    | "needs-clarification"
    | "approved"
    | "in-progress"
    | "implemented"
    | "verified"
    | "rejected";
  acceptanceCriteria: string[];
  feedbackMomentIds: string[];
  browserEvidence: BrowserEvent[];
  codeEvidence?: CodeReference[];
};

type WorkOrder = {
  kind: "work_order";
  id: string;
  sessionId: string;
  title: string;
  summary: string;
  tasks: WorkOrderTask[];
  acceptanceCriteria: string[];
  feedbackMomentIds: string[];
  status: "draft" | "approved" | "in-progress" | "completed" | "rejected";
};

type WorkOrderTask = {
  id: string;
  description: string;
  type: "doc" | "architecture" | "code" | "test" | "config";
  targetPath?: string;
  status: "pending" | "in-progress" | "done";
};

type DocUpdate = {
  kind: "doc_update";
  id: string;
  sessionId: string;
  targetPath: string;
  summary: string;
  proposedContent: string;
  feedbackMomentIds: string[];
  status: "draft" | "approved" | "applied" | "rejected";
};

type ArchitectureUpdate = {
  kind: "architecture_update";
  id: string;
  sessionId: string;
  section: string;
  rationale: string;
  proposedChanges: string;
  feedbackMomentIds: string[];
  status: "draft" | "approved" | "applied" | "rejected";
};

type CodeReference = {
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  symbol?: string;
};
```

### 10.7 Screenshot Storage

Screenshots stored on disk under `{dataDir}/sessions/{sessionId}/screenshots/{id}.png`. SQLite stores metadata (`id`, `sessionId`, `feedbackMomentId?`, `elementBbox?`, `createdAt`). Blobs are not stored in SQLite.

---

## 11. Local API Specification

Base URL: `http://localhost:4317`

### 11.1 Session Startup

`POST /api/sessions`

Request:
```json
{
  "workspacePath": "/Users/steve/projects/my-app",
  "appUrl": "http://localhost:3000",
  "devCommand": "npm run dev",
  "ide": "cursor"
}
```

Response:
```json
{
  "sessionId": "abc123",
  "reviewRoomUrl": "http://localhost:4317/session/abc123",
  "branch": "main",
  "status": "active"
}
```

### 11.2 Browser State

`GET /api/sessions/:id/browser-state`

Response:
```json
{
  "route": "/devices",
  "title": "Devices",
  "mouse": { "x": 412, "y": 288 },
  "elementUnderPointer": {
    "role": "button",
    "name": "View Details",
    "selector": "[data-testid='device-details-button']",
    "boundingBox": { "x": 380, "y": 270, "width": 120, "height": 36 }
  },
  "lastClickedElement": { "role": "button", "name": "View Details", "selector": "..." },
  "consoleErrors": [],
  "networkErrors": [],
  "accessibilitySnapshotId": "snap_123"
}
```

### 11.3 Submit Feedback

`POST /api/sessions/:id/feedback`

Request:
```json
{
  "transcript": "This button should open a drawer, not navigate away",
  "modality": "typed",
  "reviewMode": "explain_this"
}
```

Response:
```json
{
  "feedbackMoment": { "id": "fm_001", "..." : "..." },
  "facilitatorResponse": {
    "interpretation": "wrong",
    "summary": "View Details navigates to full page; expected side drawer",
    "suggestedArtifacts": [{ "kind": "change_request", "title": "..." }]
  }
}
```

### 11.4 Review Mode

`POST /api/sessions/:id/review-mode`

Request: `{ "mode": "normal" | "explain_this" | "element_picker" }`

### 11.5 Artifacts

- `GET /api/sessions/:id/artifacts`
- `POST /api/sessions/:id/artifacts` (create from facilitator draft)
- `PATCH /api/sessions/:id/artifacts/:artifactId` (approve/reject)
- `POST /api/sessions/:id/handoff` (package for IDE)

### 11.6 Screenshots

- `POST /api/sessions/:id/screenshots` (on-demand capture)
- `GET /api/sessions/:id/screenshots/:screenshotId` (PNG)

### 11.7 Feedback Moments

- `GET /api/sessions/:id/feedback-moments`
- `GET /api/sessions/:id/feedback-moments/:momentId`

---

## 12. WebSocket Event Stream

`WS /api/sessions/:id/events`

### 12.1 Client → Server

```typescript
type ClientMessage =
  | { type: "ping" }
  | { type: "subscribe"; channels: ("browser" | "chat" | "artifacts")[] };
```

### 12.2 Server → Client

```typescript
type ServerMessage =
  | { type: "pong" }
  | { type: "browser_event"; event: BrowserEvent }
  | { type: "browser_state"; state: BrowserState }
  | { type: "feedback_moment"; moment: FeedbackMoment }
  | { type: "chat_message"; role: "user" | "agent"; content: string; momentId?: string }
  | { type: "artifact"; artifact: ReviewArtifact }
  | { type: "session_status"; status: ReviewSession["status"] };
```

Events are ordered by server timestamp. Clients reconnect with `Last-Event-Id` header or query param.

---

## 13. MCP Server Tool Surface

| Tool | Purpose |
|------|---------|
| `start_review_session` | Start session for active workspace |
| `get_active_session` | Current `ReviewSession` |
| `get_browser_state` | Route, mouse, elements, errors |
| `get_feedback_moments` | Spatial feedback moments with evidence |
| `get_element_context` | Resolved element + screenshot + a11y |
| `capture_screenshot` | On-demand screenshot |
| `get_recent_user_feedback` | Recent feedback linked to browser state |
| `get_review_transcript` | Full or summarized transcript |
| `list_review_artifacts` | Change requests, work orders, doc/arch updates |
| `create_work_order` | Structured build request from findings |
| `propose_doc_update` | Draft spec/doc change with evidence |
| `create_change_request` | Structured UI/behavior task |
| `handoff_to_ide` | Package artifacts + summary for execution agent |
| `propose_patch` | Generate code patch (Phase 4+) |
| `apply_patch` | Apply approved patch to worktree (Phase 4+) |
| `run_tests` | Run configured verification commands |
| `verify_behavior` | Browser automation against acceptance criteria (Phase 7) |
| `summarize_session` | Handoff summary, decisions, open items |

MCP tools are scoped to the active session and workspace. Do not expose broad filesystem or shell tools through Oryntra MCP.

---

## 14. Browser Automation

- Launch one **persistent Chromium context** per session (`headless: false`).
- Navigate to configured `appUrl`.
- Listen: clicks, navigation, console errors, failed network requests, throttled mouse samples.
- On feedback: resolve element under pointer, capture a11y snapshot + screenshot.
- Prefer **accessibility snapshots and DOM metadata** for agent reasoning; screenshots for visual/layout issues.
- Expose explicit verification commands (Phase 7); do not let agents click randomly without state tracking.

---

## 15. Voice Design

Voice is phased after the spatial review loop works.

| Phase | Capability |
|-------|------------|
| MVP | Typed feedback only |
| Phase 6 | Push-to-talk; STT creates `FeedbackMoment` with same spatial bundle |
| Phase 6b | AI text + optional read-aloud |
| Phase 7 | Realtime voice (WebRTC); barge-in handling |

---

## 16. Security and Safety

| Control | Requirement |
|---------|-------------|
| Network | Bind backend to localhost only by default |
| Workspace | Restrict file access to workspace root (+ session worktree when used) |
| Shell | Allowlist; approval before non-configured commands |
| Source edits | Git worktree (lazy); approval before patch apply |
| Secrets | Redact from logs, transcripts, screenshots, MCP output |
| Browser | Isolated context per session; no default cookie reuse |
| Tunnels | Disabled unless `allowPublicTunnel: true` |

---

## 17. Project Configuration

See `oryntra.yaml.example` in the repo root.

---

## 18. Implementation Roadmap

| Phase | Goal | Deliverables | Defer |
|-------|------|--------------|-------|
| **1** | Spatial Review Room | CLI, backend, session manager, Review Room UI, real Chromium, mouse/click capture, feedback moments | Voice, code edits |
| **2** | Rich observation | a11y snapshots, element picker, explain-this mode, evidence timeline with screenshots | Autonomous patching |
| **3** | Artifacts + facilitator | Review facilitator, change requests, work orders, doc/arch drafts, interactive clarification | Voice |
| **4** | IDE handoff | MCP server, `handoff_to_ide`, artifact listing; Cursor integration | VS Code extension |
| **5** | Execution loop | Git worktree (lazy), patch propose/apply, test runs, VS Code extension | Full IDE replacement |
| **6** | Voice | Push-to-talk STT with spatial bundle | Realtime duplex |
| **7** | Verification | Generated Playwright tests, before/after screenshots, acceptance checklist | Cloud collaboration |

---

## 19. MVP Build Instructions

See [MVP_BUILD.md](./MVP_BUILD.md).

---

## 20. MVP Acceptance Criteria

- [ ] `oryntra start --workspace . --url http://localhost:3000` starts backend on `localhost:4317`
- [ ] Playwright opens non-headless Chromium at the app URL; user navigates normally
- [ ] Review Room opens at `/session/:id` showing session status, route, element under cursor
- [ ] Click events, route changes, console errors, and network errors appear in timeline
- [ ] User submits typed feedback; system captures mouse position, element under pointer, screenshot
- [ ] Feedback stored as `FeedbackMoment` with spatial context and recent events
- [ ] Review facilitator returns interpretation (correct/missing/wrong/unclear) and drafts a change request or work order
- [ ] User can activate Explain This mode and bind feedback to a specific click/element
- [ ] Artifacts and feedback moments persist in SQLite; screenshots on disk
- [ ] MVP does **not** modify source code
- [ ] Codebase includes `ReviewFacilitator` and `ExecutionAgentProvider` extension points
- [ ] WebSocket stream delivers browser events and feedback moments to Review Room in real time

---

## Reference Links

- [Cursor MCP Documentation](https://cursor.com/docs/mcp)
- [VS Code Webview UX Guidelines](https://code.visualstudio.com/api/ux-guidelines/webviews)
- [Playwright MCP Documentation](https://playwright.dev/docs/getting-started-mcp)
- [OpenAI Realtime API](https://developers.openai.com/api/docs/guides/realtime)
