# Oryntra

**Live AI product review room for coding agents.**

Oryntra lets you navigate a running web app in a **real browser tab**, explain what is correct, missing, or wrong — while an AI agent sees **where** you are (mouse, clicks, elements, screenshots) and turns feedback into actionable **work orders**, documentation updates, architecture notes, and change requests. Execution hands off to **Cursor, VS Code, Windsurf**, or other IDEs via MCP.

## The problem

Describing UI changes in chat is hard. "The button on the right" or "when I click here" loses context. Screenshots and Loom videos help but are manual. Oryntra captures spatial and visual context automatically during a live review session.

## How it works (enterprise)

```
App in normal browser tab (extension captures spatial context)
        +
Review Studio in Chrome side panel (chat, artifacts, approve)
        ↓
Oryntra backend (localhost:4317)
        ↓
IDE Registry detects connected IDEs (Cursor MCP, VS Code, …)
        ↓
MCP handoff → preferred IDE implements in your workspace
```

**Single screen.** No iframe. No second Chromium window.

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture & Design Spec (v1.2)](./docs/ARCHITECTURE.md) | Full product architecture, capture modes, multi-IDE registry |
| [Browser Extension](./docs/BROWSER_EXTENSION.md) | Enterprise single-screen review (recommended) |
| [MVP Build Guide](./docs/MVP_BUILD.md) | Implementation brief for Phase 1–3 |
| [Cursor Review Loop](./docs/CURSOR_REVIEW.md) | IDE agent as facilitator |
| [MCP Setup (Cursor)](./docs/MCP_SETUP.md) | Connect IDE agent to review sessions |
| [LLM Facilitator](./docs/LLM_FACILITATOR.md) | Optional OpenAI-backed review agent |
| [Execution Loop](./docs/EXECUTION.md) | Git worktree + IDE implementation |
| [Original PDF spec](./Oryntra_Architecture_and_Design_Spec.pdf) | v1.0 reference |

## Quick start (demo app)

```bash
npm install
npm run build

npm run demo:dev
npm run collaborate:restart
```

## Quick start (enterprise — Clarion + extension)

```bash
npm run build
npm run dev                    # Oryntra backend

# Chrome → Load unpacked → packages/browser-extension/dist
# Extension Settings → workspace path + app URL
# Open Clarion tab → extension → Start review
# Cursor → enable Oryntra MCP with ORYNTRA_WORKSPACE
```

See [Browser Extension Guide](./docs/BROWSER_EXTENSION.md).

## Capture modes

| Mode | Use when |
|------|----------|
| **`extension`** | Enterprise apps (Clarion), MFA, maps, production-like review |
| **`embedded`** | Zero-install dev; demo app in Review Studio iframe |
| **`playwright`** | Legacy debugging only |

```yaml
# oryntra.yaml
browser:
  mode: extension   # or embedded for dev
```

## Status

**Phase 5–6 in progress** — execution loop, embedded bridge capture, **browser extension + multi-IDE registry** shipped.

Project tracking: [docs/pm/README.md](./docs/pm/README.md) · [docs/PROJECT_STATUS.md](./docs/PROJECT_STATUS.md) · `npm run pm:report`

## Development

```bash
npm install
npm run build
node packages/cli/dist/index.js collaborate --workspace /path/to/app --fresh
```

## License

TBD
