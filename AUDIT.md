# VOXSHIELD audit

**Scope:** Repository source, configuration examples, running local frontend (`localhost:3000`), and backend API (`localhost:8000`) inspected on 2026-11-07. No Gnani credentials were present in the inspected environment examples. External provider calls and microphone permissions were not exercised.

## Summary

The local frontend and FastAPI backend both respond, and the backend returns a persisted SQLite incident. The dashboard renders the incident. However, the current voice flow is not connected end-to-end to Prisma or Timbre: configured STT uploads return no transcript, while unconfigured STT returns explanatory fallback text that the UI treats as an analyst transcript. Several controls are visual-only, provider status is misleading, and the investigation agent is keyword-based rather than an LLM.

## Working features observed

- Next.js responds with HTTP 200 on `http://localhost:3000`.
- FastAPI `/api/health`, `/api/incident`, `/api/report`, `/api/voice/transcript`, `/api/voice/stt`, `/api/voice/tts`, and `/ws` are implemented; `/api/health` and `/api/incident` returned HTTP 200 during inspection.
- SQLAlchemy models and SQLite persistence cover incidents, timeline, evidence, hypotheses, tasks, conversations, and audit entries.
- A seeded incident and dashboard panels for timeline, evidence, hypotheses, tasks, the copilot, and audit history render.
- The transcript endpoint runs rule-based extraction, persists some updates, and broadcasts incident/assistant events to WebSocket clients.

## Findings

| Area | Finding | Impact |
|---|---|---|
| Gnani Prisma | The upload route calls `transcribe_from_uploaded_audio`, which returns `requires-live-audio` when credentials are set; the streaming STT method is not wired to the upload flow. | Real audio does not produce a transcript. |
| Development fallback | Without credentials, STT returns explanatory text in the `transcript` field. The frontend submits that message as an analyst transcript. | Fallback copy can contaminate incident records. |
| Gnani Timbre | The WebSocket response parser expects top-level `audio` / `is_final`; current Gnani docs specify `type: audio` with `data.audio`, followed by `type: complete` or `error`. | Configured speech synthesis is not parsed according to the provider protocol. |
| Provider status | `/api/health`, `/ws`, and incident state hard-code connection/fallback labels or equate configuration with a successful connection. | The UI can claim a provider is connected without a verified provider request. |
| Investigation logic | `InvestigationAgent` uses string matching, does not call an LLM, and misses the demo phrase “One login succeeded at 2:14 AM” because its condition requires “successful”. | The stated multi-turn scenario is not reliably extracted. |
| Corrections and timeline | Corrections produce only a response string; no existing event is edited. Timeline entries use the literal `"now"` for extracted event times and are not sorted. | Corrections and chronological reporting are inaccurate. |
| State and audit | Decision persistence does not consistently link audit entries to the source message; evidence creation is not audited; task/evidence mutations have no API routes. | History is incomplete and dashboard actions cannot update the backend. |
| Report | Report generation includes hard-coded statements and hypotheses instead of deriving all sections from current state. | Reports can misrepresent unverified or absent findings. |
| Frontend controls | Sidebar navigation and “Why this item?” do not have actions. There are no task-completion, evidence-verification, correction, or report-download controls. | Several visible controls are nonfunctional. |
| Voice UI | There is no live transcript stream, turn detection, reconnect strategy, or interruption/stop control. The microphone records WebM, while the configured STT implementation does not accept/transcribe that upload format. | Voice interaction is not a reliable conversational flow. |
| Frontend state | The WebSocket effect depends on `muted`, so toggling mute closes and recreates the socket; inspection captured a “closed before the connection is established” browser warning. Errors and reconnect state are not surfaced consistently. | Unnecessary disconnects and misleading status. |
| Risk score | The score is recomputed from only the latest transcript, and the severity proposal is overwritten by the rule-based score. | Risk/severity can fall after later turns and diverge from incident context. |

## Provider documentation checked

- [Gnani Quick Start](https://docs.gnani.ai/api/introduction/quick-start)
- [Prisma realtime WebSocket](https://docs.gnani.ai/api/STT/stt-websocket)
- [Timbre realtime WebSocket](https://docs.gnani.ai/api/TTS/tts-websocket)
- [Prisma v3 overview](https://www.gnani.ai/resources/prisma-v3)

The documented STT WebSocket endpoint is `wss://api.vachana.ai/stt/v3/stream`, with `x-api-key-id`, `model`, `language_code`, and binary PCM frames. The documented TTS WebSocket endpoint is `wss://api.vachana.ai/api/v1/tts`; audio frames are read from `data.audio`. The current examples do not configure a Gnani API key.

## Runtime inspection limits

- Local frontend/backend HTTP health checks passed, but the backend terminal log stream was not available for inspection.
- Browser inspection found the WebSocket lifecycle warning noted above; no microphone permissions or real Gnani requests were attempted.
- No automated test suite was found in the repository inventory.
