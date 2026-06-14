# Clarion Demo App

Intentionally imperfect UI for dogfooding Oryntra. Use this app to test spatial review, feedback, artifacts, and worktree handoff.

## Known issues (for review sessions)

| Area | Current behavior | Expected (for reviewers to find) |
|------|------------------|----------------------------------|
| Devices → View Details | Navigates to full detail page | Should open side drawer, preserve filters |
| Save button | No loading indicator | Should show loading while saving |
| Devices empty state | Shows blank table | Should show helpful empty message |
| Settings → Theme | Label says "Color mode" | Should say "Theme" |

## Run

Terminal 1 — demo app:

```bash
npm run dev -w @oryntra/demo-app
```

Terminal 2 — Oryntra (from repo root, after `npm run build`):

```bash
node packages/cli/dist/index.js start \
  --workspace apps/demo-app \
  --url http://127.0.0.1:4318
```

Or from repo root:

```bash
npm run demo:review
```

## Suggested review script

1. Open **Devices**, apply a filter, click **View Details** on a row
2. Say: *"This should open a drawer, not navigate away — filters are lost"*
3. Go to **Settings**, hover Save, click without waiting for feedback
4. Say: *"Save button needs a loading state"*
5. Approve artifacts → **Handoff to IDE** → use Cursor MCP `handoff_to_ide`
