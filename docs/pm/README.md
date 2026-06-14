# Oryntra project management

Track **requirements**, **features**, and **sprint** status for the Oryntra repo.

## Source of truth

| File | Purpose |
|------|---------|
| [`backlog.yaml`](./backlog.yaml) | Canonical registry — edit IDs, status, and links here |
| [`../PROJECT_STATUS.md`](../PROJECT_STATUS.md) | High-level phase summary and decisions log |
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | Product spec, APIs, and long-term roadmap |

Run a quick dashboard:

```bash
npm run pm:report
```

## ID conventions

| Prefix | Example | Meaning |
|--------|---------|---------|
| `REQ-` | REQ-006 | Requirement — what the product must do |
| `FEAT-` | FEAT-017 | Feature — implementable unit of work |
| `SPRINT-` | SPRINT-2026-06-11 | Time-boxed focus (optional) |

Link features to requirements via `requirements:` / `features:` arrays in `backlog.yaml`.

## Status values

| Status | Meaning |
|--------|---------|
| `proposed` | Idea captured; not committed |
| `planned` | Committed; not started |
| `in_progress` | Active work |
| `blocked` | Waiting on dependency or decision |
| `done` | Shipped and verified |
| `deferred` | Out of scope for now |
| `cancelled` | Will not do |

## Priority

`critical` → `high` → `medium` → `low`

## Workflow

1. **New requirement** — add `REQ-xxx` in `backlog.yaml` with acceptance criteria.
2. **Break down** — add `FEAT-xxx` items linked to the requirement.
3. **Sprint** — list active feature IDs under `sprints:` (or move items to `in_progress`).
4. **Ship** — set feature `status: done`; roll requirement to `done` when all linked features are done.
5. **Sync** — bump `meta.last_updated` and run `npm run pm:report`.

When finishing work in Cursor, update the relevant `FEAT-` / `REQ-` rows so the backlog stays accurate.

## Current focus

Active sprint: **SPRINT-2026-06-12** — browser extension + multi-IDE registry.

Previous: **SPRINT-2026-06-11** — execution loop + visual evidence.

See [`backlog.yaml`](./backlog.yaml) for the full list.
