# Oryntra MCP Setup (Cursor, VS Code, Antigravity, …)

Connect any MCP-capable IDE to a running Oryntra review session so the agent can read spatial feedback, artifacts, and implement approved changes.

## Prerequisites

1. Oryntra backend running with an active session:

```bash
npm run build
node packages/cli/dist/index.js start --workspace /path/to/your/app --url http://localhost:3000
```

2. MCP server built:

```bash
npm run build -w @oryntra/mcp
```

## Cursor / VS Code configuration

Copy [`.cursor/mcp.json.example`](../.cursor/mcp.json.example) to `.cursor/mcp.json` (or add to global MCP settings):

```json
{
  "mcpServers": {
    "oryntra": {
      "command": "node",
      "args": [
        "/absolute/path/to/oryntra/packages/mcp/dist/index.js"
      ],
      "env": {
        "ORYNTRA_URL": "http://127.0.0.1:4317",
        "ORYNTRA_WORKSPACE": "/absolute/path/to/your/app",
        "ORYNTRA_IDE": "cursor"
      }
    }
  }
}
```

Replace paths with your machine. `ORYNTRA_WORKSPACE` should be the app you are reviewing (for `open_collaboration_room`).

Set `ORYNTRA_IDE` to register your IDE with the Oryntra IDE Registry:

`cursor` · `vscode` · `windsurf` · `jetbrains` · `zed` · `antigravity` · `other`

The extension side panel shows connected IDEs. Click a chip to set **preferred IDE** for handoff. Only the matching MCP client processes pending feedback when `preferredIde` is set.

**Without MCP:** use **Tasks: Run Task → Oryntra: Open Collaboration Room** (see `.vscode/tasks.json`).

## Available tools

| Tool | Purpose |
|------|---------|
| `open_collaboration_room` | Start server + open Review Room from the IDE |
| `get_active_session` | Current review session |
| `get_browser_state` | Route, mouse, element under pointer |
| `get_feedback_moments` | All spatial feedback with evidence |
| `get_pending_feedback` | Moments waiting for the preferred IDE to process |
| `await_review_feedback` | Block until reviewer sends chat in Review Studio |
| `process_pending_review` | Full context for the latest pending feedback (skipped if wrong IDE) |
| `get_review_context` | Pending feedback + browser state + transcript + artifacts |
| `submit_review_response` | Post agent reply and draft artifacts to Review Room |
| `get_review_transcript` | Chat history |
| `list_review_artifacts` | Change requests, work orders, doc updates |
| `get_implement_status` | Implementation progress from implement-request.json |
| `request_implementation` | Write implement-request.json for approved artifacts |
| `propose_patch` | Draft structured patch from a change_request |
| `apply_patch` | Apply patch in session git worktree |
| `handoff_to_ide` | Full handoff package for implementation |
| `summarize_session` | Summary + open items |

## Example Cursor prompts

**Open collaboration room:**

```
Open the Oryntra collaboration room for this workspace.
```

**Facilitate Review Studio chat** (default `ide` facilitator — uses IDE login):

```
Start Oryntra review. After collaborate_now, use await_review_feedback, then process_pending_review and submit_review_response.
```

**Implement approved work** (after approving in Review Room):

```
Use Oryntra MCP handoff_to_ide, then implement approved work orders in this workspace.
Update docs and architecture specs before code changes.
```

See [CURSOR_REVIEW.md](./CURSOR_REVIEW.md) for the full loop.

## Troubleshooting

- **No active session** — Start `oryntra start` first; MCP uses the latest session by default.
- **Connection refused** — Confirm backend is on `http://127.0.0.1:4317` (or set `ORYNTRA_URL`).
