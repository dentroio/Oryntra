# Oryntra Demo App

The **Clarion Demo** (`apps/demo-app`) is a small React app with intentional UX issues for testing Oryntra end-to-end.

## Quick start

**Terminal 1** — demo app:

```bash
npm install
npm run demo:dev
```

**Terminal 2** — Oryntra (build first if needed):

```bash
npm run build
npm run demo:review
```

- Review Room opens with **app embedded** (single-window collaborative mode)  
- Demo app runs at http://127.0.0.1:4318 inside the Review Room iframe (dedicated port — avoids conflicts with other apps on :3000)  

## Built-in scenarios

### 1. Drawer vs navigation (Devices)

1. Go to **Devices**
2. Set site filter to **NYC**
3. Click **View Details** on a row
4. Feedback: *"Should open a side drawer, not navigate — filters are lost"*
5. Use **Explain This** or **Element Picker** on the button

### 2. Missing loading state (Settings)

1. Go to **Settings**
2. Change theme, click **Save changes**
3. Feedback: *"Save needs a loading indicator"*

### 3. Missing empty state (Devices)

1. Click **Toggle empty data**
2. Feedback: *"Table needs an empty state message"*

### 4. Wrong label (Settings)

1. Feedback on **Color mode** label: *"Should be called Theme"*

## After review

1. Approve change requests / work orders in Review Room
2. **Handoff to IDE**
3. Cursor MCP: `handoff_to_ide` → `prepare_execution` → implement in worktree

## Config

`apps/demo-app/oryntra.yaml` is preconfigured for port 4318.
