# Cursor + Oryntra Review Loop

Oryntra does **not** require a separate LLM API key or a second login.

## IDE login vs CLI login (important)

You are already signed in to **Cursor the IDE**. That is not the same credential as the **Cursor CLI** (`cursor agent` in a terminal).

| Path | Who runs it | Auth |
|------|-------------|------|
| **Cursor IDE + MCP** (recommended) | The Agent chat you already use | Your IDE session |
| **`cursor agent` CLI** | Oryntra server spawns a headless subprocess | Separate `cursor agent login` or `CURSOR_API_KEY` |

We previously wired `facilitatorProvider: cursor` to the **CLI** — that is why you saw “run cursor agent login” even though the IDE was logged in. That was the wrong default for IDE users.

**Recommended setup:** Review Studio captures feedback → syncs to `review-history.md` → **this Cursor Agent** (with Oryntra MCP) reads context and implements. No CLI login.

Optional advanced mode: `facilitatorProvider: cursor` only if you run Oryntra as a headless daemon and accept CLI auth.

## The loop (2 steps)

1. **Describe** — In Review Room chat, click the app on the left, then describe what should change.
2. **Confirm & approve** — The agent replies with **"Here's what I understood:"** and a draft change request in **Artifacts**. If it looks right, click **Approve & implement**.

After approval, Cursor implements automatically. The embedded app refreshes when implementation completes.

You do **not** need to type "Process my Oryntra feedback" in Cursor chat for each item.

## Open the collaboration room

### Cursor chat (MCP)

> Open the Oryntra collaboration room

### VS Code / Cursor task

**Terminal → Run Task…** → **Oryntra: Collaborate Now**

### CLI

```bash
npm run build
npm run demo:dev          # demo app on http://127.0.0.1:4318
npm run collaborate       # open review room (reuses session)
npm run collaborate:fresh # new session
```

## Demo configuration

`apps/demo-app/oryntra.yaml`:

```yaml
agent:
  facilitatorProvider: ide       # Review Studio → Cursor Agent via MCP
  autoImplementOnApprove: true
  implementInWorkspace: true   # edits live Vite app for iframe hot-reload
  cursorAgent: true              # sync history to review-history.md

browser:
  mode: embedded                 # enterprise default — one Review Studio window
```

### Embedded mode (enterprise default)

The app runs **inside Review Studio** (left panel). Chat and spatial review stay on the right — **no second browser window**.

The iframe bridge captures from your **live logged-in session**:

- Authenticated viewport screenshots (html2canvas in-app)
- DOM accessibility snapshots
- Click, route, mouse, console, and network errors

Set `browser.mode: embedded` in `oryntra.yaml`. Playwright (`mode: playwright`) remains available as a legacy two-window fallback only.

### Facilitator modes

| `facilitatorProvider` | Review Studio chat | Uses IDE login? |
|----------------------|-------------------|-----------------|
| `ide` (demo default) | Cursor Agent replies via MCP (`submit_review_response`) | **Yes** |
| `instant` | Immediate local ack + change request draft | N/A (local) |
| `cursor` | Headless CLI agent (`cursor agent --print`) | **No** — needs CLI login |
| `openai` | Separate OpenAI API call | API key |

**MCP loop:** `collaborate_now` → `await_review_feedback` → `process_pending_review` → `submit_review_response`. A project **stop hook** (`.cursor/hooks.json`) also nudges the agent when feedback is pending.

**Same brain as IDE:** keep this Agent chat open with Oryntra MCP enabled. No `cursor agent login`.

## Example review

1. Open **Devices**, filter by site (e.g. NYC).
2. Click **View Details** — you leave the list (full-page detail; filters are lost on back).
3. In chat: *"View Details should open a drawer and keep my filters."*
4. Agent summarizes what it understood → open **Artifacts** → **Approve & implement**.
5. When status shows **Done**, try **View Details** again — drawer opens, filters stay.

## IDE-delegated mode (advanced)

Set `agent.facilitatorProvider: ide` to route feedback through Cursor MCP (`get_review_context`, `submit_review_response`) instead of instant acknowledgments. See [MCP_SETUP.md](./MCP_SETUP.md).
