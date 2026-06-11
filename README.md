# Oryntra

**Live AI product review room for coding agents.**

Oryntra lets you navigate a running web app in a real browser, explain what is correct, missing, or wrong — while an AI agent sees **where** you are (mouse, clicks, elements, screenshots) and turns feedback into actionable **work orders**, documentation updates, architecture notes, and change requests. Execution hands off to Cursor, VS Code, or another IDE via MCP.

## The problem

Describing UI changes in chat is hard. "The button on the right" or "when I click here" loses context. Screenshots and Loom videos help but are manual. Oryntra captures spatial and visual context automatically during a live review session.

## How it works

```
Developer navigates real Chromium window (Playwright-attached)
        ↓
Review Room (localhost:4317) — chat, timeline, spatial evidence, artifacts
        ↓
Review Facilitator agent — clarifies, structures findings
        ↓
Work orders / docs / architecture / change requests
        ↓
MCP handoff → Cursor or VS Code executes in your workspace
```

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture & Design Spec (v1.1)](./docs/ARCHITECTURE.md) | Full product architecture, data models, APIs, MCP tools |
| [MVP Build Guide](./docs/MVP_BUILD.md) | Implementation brief for Phase 1–3 |
| [Original PDF spec](./Oryntra_Architecture_and_Design_Spec.pdf) | v1.0 reference (superseded by markdown for implementation) |

## Quick start (once implemented)

```bash
# From your app workspace
oryntra start --workspace . --url http://localhost:3000
```

- Backend: `http://localhost:4317`
- Review Room: `http://localhost:4317/session/{sessionId}`
- App: Playwright opens non-headless Chromium at your dev URL

Copy and customize config:

```bash
cp oryntra.yaml.example oryntra.yaml
```

## Status

**Specification complete — implementation not started.**

The repo contains architecture docs and build guidance. See [MVP_BUILD.md](./docs/MVP_BUILD.md) to begin coding.

## License

TBD
