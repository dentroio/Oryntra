# Legacy annotation extension (archived)

Enterprise Oryntra on `main` is the supported Chrome extension. The older
annotation extension is **archived**, not merged.

## What it was

Work order **WO-1011** shipped a Chrome extension that annotated screenshots and
posted them **directly** to the agentic-factory thread proxy (`POST` image +
thread). That code lived on `feat/factory-thread-integration` — a git lineage
with **no history in common** with current `main`, so GitHub would not accept a
PR between them.

Last commit on that branch: `83ab15f` (2026-07-23) — auto-detect used
`GET /api/factory/dispatch` after `/api/status` was removed from the factory
status site.

## Superseded by

**WO-1047** (and the review-cockpit work on this branch) put capture and
evidence **inside enterprise Oryntra**:

- Chrome side panel → local backend `http://127.0.0.1:4317`
- Backend relays evidence to the factory when a session is bound
- Factory WO-1011 endpoints (orchestrator image storage, proxy, thread
  rendering) stay in place; only the *client* changed

Do not load the archived extension unpacked. Use
`packages/browser-extension` on `main` (or the review-cockpit PR).

## Archive tag

| Item | Value |
|------|--------|
| Tag | `legacy-annotation-extension` |
| Commit | `83ab15f803a0fb70d22da94af6f866746220e93c` |
| Former branch | `feat/factory-thread-integration` (deleted after tagging) |

Restore the tree if you need to inspect it:

```bash
git fetch origin tag legacy-annotation-extension
git checkout legacy-annotation-extension
```

## Factory-side follow-up

WO-1051 also updates factory wiki / CAPABILITY_STATUS pointers away from the
deleted branch. That lives in `dentroio/agentic-factory`, not this repo.
The factory must **not** remove WO-1011 plumbing — enterprise Oryntra still
uses those endpoints.
