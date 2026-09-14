# Oryntra MCP Setup (Cursor, VS Code, Antigravity, …)

Connect any MCP-capable IDE to a running Oryntra review session so the agent can read spatial feedback, artifacts, and implement approved changes.

The backend is a **local localhost service** (not co-deployed in Docker with the factory). Factory WO tools are optional; see [FACTORY.md](./FACTORY.md).

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

Give each IDE a distinct `ORYNTRA_MCP_CLIENT_ID` (for example `mcp:cursor` and `mcp:vscode`) so both can stay connected at once.

The extension side panel shows connected IDEs. Click a chip to set **preferred IDE** for handoff. Only the matching MCP client processes pending feedback when `preferredIde` is set.

## VS Code (Copilot, Claude, Codex)

VS Code does **not** read `.cursor/mcp.json`. Native MCP (Copilot Agent and other VS Code agents) uses `.vscode/mcp.json` with a top-level `servers` key:

```json
{
  "servers": {
    "oryntra": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/oryntra/packages/mcp/dist/index.js"
      ],
      "env": {
        "ORYNTRA_URL": "http://127.0.0.1:4317",
        "ORYNTRA_WORKSPACE": "/absolute/path/to/your/app",
        "ORYNTRA_IDE": "vscode",
        "ORYNTRA_MCP_CLIENT_ID": "mcp:vscode"
      }
    }
  }
}
```

Copy [`.vscode/mcp.json.example`](../.vscode/mcp.json.example) into the app workspace as `.vscode/mcp.json`. Then:

1. Rebuild MCP: `npm run build -w @oryntra/mcp`
2. Reload VS Code (`Developer: Reload Window`)
3. Open Chat in **Agent** mode and confirm the `oryntra` tools
4. In the Oryntra side panel, click the **VS Code** chip so handoff targets this IDE
5. Ask the agent: `Await Oryntra review feedback, then process_pending_review and submit_review_response.`

**Claude Code** in VS Code also reads a project-root [`.mcp.json`](https://code.claude.com/docs/en/mcp) (`mcpServers` key, same env as Cursor). Keep `ORYNTRA_IDE=vscode` there so it does not collide with Cursor.

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
