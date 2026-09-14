# Oryntra + Agentic Factory

How Oryntra runs on your machine, and how it connects to the **agentic-factory** work-order system.

## Runtime model (not a shared container)

Oryntra’s backend is a **local localhost service**, not something you deploy in Docker next to the factory.

| Piece | How it runs | Default |
|-------|-------------|---------|
| **Oryntra backend** | Node process on your PC (foreground `npm run dev`, or background **daemon** via CLI / `ensure-oryntra-daemon`) | `http://127.0.0.1:4317` |
| **Browser extension / Review Studio** | Chrome side panel → talks to that localhost API | same host |
| **IDE (Cursor, VS Code, …)** | MCP client on the same machine → Oryntra API | `ORYNTRA_URL` |
| **Agentic factory** | **Separate** service (its own process or stack) | `http://localhost:8099` |

**Why not one container with the factory?**

- Extension capture, IDE MCP, and workspace paths assume **host localhost**.
- Oryntra needs your real app URL and repo paths on the machine.
- The factory is an optional peer API, not a subprocess of Oryntra.

Treat Oryntra like a **local daemon** (always available on `:4317`), and the factory like a **separate service** Oryntra calls over HTTP. Packaging Oryntra in Docker is optional later for demos/CI — it is not the supported daily developer model.

```
┌─ Your Mac ─────────────────────────────────────────────────────┐
│  Clarion (or other app)     Cursor / VS Code (MCP)               │
│         │                            │                           │
│         │    Chrome extension        │                           │
│         └──────────┬─────────────────┘                           │
│                    ▼                                             │
│         Oryntra backend (local daemon :4317)                     │
│                    │                                             │
│                    │  HTTP (optional)                            │
│                    ▼                                             │
│         Agentic factory (:8099)  ← own process / compose         │
└──────────────────────────────────────────────────────────────────┘
```

Start Oryntra with `npm run dev`, `npm run collaborate`, MCP `collaborate_now`, or the workspace-open daemon helper. Confirm health at `http://127.0.0.1:4317/health`.

---

## What “connected to the factory” means

Oryntra does **not** embed or spawn factory runners. It is an HTTP client to the factory **status / dispatch API**:

- **Reads** (dispatch board, agents, WO thread): unauthenticated.
- **Writes** (create WO, post notes, approve/reject validation): `Authorization: Bearer …` from `ORYNTRA_FACTORY_SECRET`, `API_SECRET`, or (on macOS) the Keychain item `dentroio-factory` / `API_SECRET`.

| Env | Purpose |
|-----|---------|
| `ORYNTRA_FACTORY_URL` | Factory base URL (default `http://localhost:8099`) |
| `ORYNTRA_FACTORY_SECRET` | Bearer token for writes (factory `API_SECRET`) |
| `ORYNTRA_REVIEWER` | Name used as `decided_by` on validation (default `oryntra-reviewer`) |

If the factory is down, review still works; factory panels show offline and bind/export/notes fail until it is reachable. The **Factory** IDE chip is shown only while `GET {FACTORY_URL}/api/factory/dispatch` responds.

Selecting **Factory** as the preferred execution target means handoff is **Send to Factory**, not MCP. Approve still does not create a WO.

Oryntra does **not** pin exported WOs to the front of the factory queue. Queue order stays the factory PM’s call (`ORDER BY position ASC`; new rows append). Factory pre-dispatch approval (P1 / `REQUIRE_APPROVAL_FOR`) is a separate factory-side gate after the WO exists.

Implementation lives in `packages/server/src/factory/` (client, export, lanes). Deeper factory-side contract: `docs/ORYNTRA_FACTORY_INTEGRATION.md` in the **agentic-factory** repo.

---

## Two lanes: Send vs Post note

When a session is **bound** to a factory WO (e.g. `WO-562`):

| Action | Goes to | Effect |
|--------|---------|--------|
| **Send** | Oryntra facilitator (IDE agent via MCP) | Spatial review chat; does **not** post to the WO thread |
| **Post note** | Bound factory WO thread | Steers the implementer; does **not** interrupt their current pass |
| **Unbind** | — | Clears `factoryWo` on the session |

Unbound sessions are “scratch” reviews: Send only; use **Send to Factory** / `export_artifact_to_factory` after approval to create a WO.

---

## End-to-end workflows

### A — Review first, then queue a factory WO

1. Start Oryntra (local daemon) and open Review Studio (extension **Start** or Full studio).
2. Navigate the app; Snap / click modes as needed; **Send** feedback.
3. Facilitator drafts a change request or work order → you **Approve**.
4. **Send to Factory** (or MCP `export_artifact_to_factory`) creates a factory WO and typically **binds** the session to it.
5. An idle factory runner (claude, cursor, codex, gemini, …) **claims** the WO.
6. The bound session shows live dispatch progress: queued → claimed → in progress → PR link → awaiting review. Pickup, PR, and “awaiting your review” also flash in the side-panel status line.
7. Use **Post note** for extra evidence; use **Send** to keep talking to Oryntra.
8. When status is `awaiting_human`, inspect in the app → **Approve** or **Reject** (reject requires a note).

### B — Join an existing factory WO

1. Factory status site → **Open in Oryntra**, or side panel **FACTORY WO** → enter id → **Bind**, or MCP `join_factory_review` / `bind_factory_session`.
2. Session loads that WO’s thread as **memory** for the facilitator (Oryntra does not speak as the factory agent).
3. Queued / unclaimed: any idle runner can claim it.
4. Claimed / in progress: **Post note** addresses the implementer (or `address_factory_agent` then note).
5. Validate when the WO reaches `awaiting_human`; **Unbind** when finished.

### C — IDE-only (no factory)

Leave the session unbound. Approve → local implement via MCP / worktree (`autoImplementOnApprove`). Extension sessions are **factory-first** unless `oryntra.yaml` sets `agent.autoImplementOnApprove: true`.

---

## MCP tools (factory)

| Tool | Role |
|------|------|
| `list_factory_work` | Live WOs and which agent is on them |
| `list_factory_validations` | WOs in `awaiting_human` |
| `bind_factory_session` | Bind / unbind session ↔ WO |
| `join_factory_review` | Open Review Studio bound to a WO |
| `address_factory_agent` | Who factory notes `@` (does not post) |
| `export_artifact_to_factory` | Approved artifact → new factory WO |

Review loop tools (`collaborate_now`, `await_review_feedback`, …) stay the same; binding only changes memory and note routing.

---

## Clarion + factory checklist

```bash
# Terminal 1 — Clarion app (and its own compose/DB if that project uses Docker)
# Terminal 2 — Agentic factory status API (whatever that repo documents)
# Terminal 3 — Oryntra local backend
cd oryntra && npm run build && npm run dev   # or collaborate / daemon

# Chrome — extension → Start review on Clarion tab
# Cursor — Oryntra MCP with ORYNTRA_WORKSPACE → clarion
# Optional — ORYNTRA_FACTORY_URL / ORYNTRA_FACTORY_SECRET if not using defaults + Keychain
```

`docker compose` in Clarion docs is for **Clarion’s** stack, not “Oryntra + factory in one container.”
