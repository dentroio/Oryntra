# LLM Review Facilitator

Oryntra can use an LLM to interpret spatial feedback and draft richer artifacts. Without an API key, the **stub facilitator** runs offline.

## Enable OpenAI

```bash
export ORYNTRA_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export ORYNTRA_LLM_MODEL=gpt-4o-mini   # optional
```

Or in `oryntra.yaml`:

```yaml
agent:
  facilitatorProvider: openai
```

## Behavior

- On feedback submit, the facilitator receives route, element, mouse position, and transcript.
- It returns interpretation (`correct` / `missing` / `wrong` / `unclear`) and drafts:
  - `change_request`
  - `work_order`
  - `doc_update` (when relevant)
- If the LLM call fails, Oryntra **falls back to the stub** automatically.

## Compatible APIs

Set `OPENAI_BASE_URL` for OpenAI-compatible endpoints (local models, Azure, etc.).
