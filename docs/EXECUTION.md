# Execution Loop (Phase 5)

Oryntra isolates implementation in a **git worktree** so review feedback can be built without touching your main branch.

## Flow

1. Review in Chromium + Review Room
2. Approve artifacts (work orders, doc updates, change requests)
3. **Handoff to IDE** — creates worktree at `.oryntra/worktrees/{sessionId}`
4. Cursor MCP executes in the worktree

## Worktree

- Branch: `oryntra/{sessionId}`
- Path: `{workspace}/.oryntra/worktrees/{sessionId}`
- Created lazily on handoff when approved artifacts exist

## MCP tools

| Tool | Action |
|------|--------|
| `handoff_to_ide` | Full package + worktree + execution plan |
| `get_worktree_status` | Branch, path, clean/dirty |
| `prepare_execution` | Task list from approved work orders + doc updates |
| `apply_approved_docs` | Write approved `doc_update` artifacts into worktree |

## Example Cursor prompt

```
Use Oryntra handoff_to_ide, then apply_approved_docs.
Implement remaining code tasks from prepare_execution in the worktree.
Do not edit files outside the worktree path.
```

## API

- `POST /api/sessions/:id/worktree` — create worktree
- `GET /api/sessions/:id/worktree` — status
- `GET /api/sessions/:id/execution-plan` — task list
- `POST /api/sessions/:id/apply-docs` — apply approved doc updates
