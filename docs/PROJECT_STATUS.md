# Oryntra Project Status

**Architect / PM:** Cursor agent  
**Spec version:** 1.2  
**Last updated:** 2026-06-12 (Phase 5–6 enterprise close-out)

**PM backlog:** [docs/pm/README.md](./pm/README.md) · `npm run pm:report`

## Vision

Interactive spatial product review on **one screen**: developer navigates a real app tab, agent understands where they point/click, produces actionable artifacts, hands off to **any connected IDE** (Cursor, VS Code, Windsurf, Antigravity, …).

## Phase tracker

| Phase | Goal | Status | Notes |
|-------|------|--------|-------|
| **0** | Architecture & spec | ✅ Done | v1.2 in `docs/ARCHITECTURE.md` |
| **1** | Monorepo + spatial review room | ✅ Done | |
| **2** | Rich observation (picker, explain-this, evidence UI) | ✅ Done | Screenshots in chat + Snap |
| **3** | Facilitator + artifacts | ✅ Done | |
| **4** | MCP + IDE handoff | ✅ Done | Multi-IDE MCP filter |
| **5** | Execution loop (patches, worktrees) | ✅ Done | propose/apply patch, implement MCP tools |
| **6** | Browser extension + multi-IDE | ✅ Done | preferredIde routing, clickable IDE chips |
| **7** | Voice + Playwright verification | ⏳ Pending | Mic UI exists; STT + verify_behavior not built |

## Enterprise review (Clarion) — ready to dogfood

| Capability | Status |
|------------|--------|
| Extension + side panel | ✅ |
| Bridge capture + screenshots | ✅ |
| IDE Registry + heartbeat | ✅ |
| Route handoff to `preferredIde` | ✅ |
| VS Code / Windsurf / Antigravity MCP | ✅ via `ORYNTRA_IDE` |
| Execution loop + worktree | ✅ |
| Visual evidence in chat | ✅ |
| Manual Snap before Send | ✅ |

## Next actions

1. Dogfood Clarion with extension + preferred IDE MCP
2. **Phase 7** — push-to-talk STT, `verify_behavior` Playwright checks
3. Team packaging — Chrome Web Store or managed CRX install
4. Optional VS Code extension (commands/status bar) — MCP covers v1

See [`docs/pm/backlog.yaml`](./pm/backlog.yaml).
