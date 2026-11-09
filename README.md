# VOXSHIELD

VOXSHIELD is a voice-first security operations workspace for investigating incidents. It separates analyst-reported statements, unknown evidence, hypotheses, and human-confirmed evidence; records meaningful changes in an audit trail; and broadcasts incident updates to connected dashboards.

## Architecture

- `frontend/` — Next.js 14, React, TypeScript, Tailwind CSS, and Lucide icons. The public homepage is `/`; the existing investigation workspace is `/dashboard` and uses the FastAPI REST API and WebSocket for persisted state and live updates.
- `backend/` — FastAPI application with Pydantic-validated investigation decisions and REST/WebSocket endpoints.
- `backend/app/agents/` — optional structured OpenAI extraction; if no OpenAI key is configured, a clearly labeled deterministic development rules engine is used.
- `backend/app/providers/` — Gnani Prisma speech-to-text and Timbre text-to-speech adapters. Provider status is `CONNECTED` only after a successful provider request.
- `backend/app/core/state_engine.py` — SQLAlchemy persistence for the incident, timeline, evidence, hypotheses, tasks, conversations, and audit history. SQLite is the local default.

## Quick start (PowerShell)

Use separate terminals from the repository root.

### Backend

```powershell
cd E:\VoxShieldAI\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### Frontend

```powershell
cd E:\VoxShieldAI\frontend
npm install
Copy-Item .env.example .env.local
npm run dev
```

The homepage links to the investigation workspace at `http://localhost:3000/dashboard`. Optional `NEXT_PUBLIC_GITHUB_URL` and `NEXT_PUBLIC_LINKEDIN_URL` values add validated HTTPS links to the homepage; they are omitted when unset.

Open [http://localhost:3000](http://localhost:3000). Install frontend dependencies from `frontend/`, where `package.json` lives.

If port 8000 is already in use, reuse the running backend or stop its specific process before starting another instance. Do not start a second server on the same address and port.

## Environment

The backend reads `backend/.env`; copy `backend/.env.example` there and set secrets locally. The frontend reads `frontend/.env.local`; copy `frontend/.env.example` there if the API is not at `http://localhost:8000`.

| Variable | Purpose | Default |
|---|---|---|
| `GNANI_API_KEY` | Server-side Gnani API key; never put this in frontend variables | empty |
| `GNANI_STT_MODEL` | Prisma STT model identifier | `prisma-v3.0` |
| `GNANI_STT_REST_URL` | Gnani STT upload endpoint | `https://api.vachana.ai/stt/v3` |
| `GNANI_STT_WS_URL` | Gnani realtime STT endpoint for the streaming adapter | `wss://api.vachana.ai/stt/v3/stream` |
| `GNANI_TTS_MODEL` | Timbre model identifier | `timbre-v2.5` |
| `GNANI_TTS_WS_URL` | Gnani Timbre WebSocket endpoint | `wss://api.vachana.ai/api/v1/tts` |
| `GNANI_TTS_VOICE` | Timbre voice name supported by the selected model | `Nalini` |
| `GNANI_TTS_LANGUAGE` | Language code for Timbre synthesis | `en-IN` |
| `OPENAI_API_KEY` | Optional key for structured incident extraction | empty |
| `OPENAI_MODEL` | OpenAI chat-completions model used for structured extraction | `gpt-4o-mini` |
| `DATABASE_URL` | SQLAlchemy database URL | `sqlite:///./incident.db` |
| `FRONTEND_ORIGIN` | Allowed frontend origin for CORS | `http://localhost:3000` |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend API and WebSocket base URL; contains no secrets | `http://localhost:8000` |

Never commit `.env`, `.env.local`, or API credentials. The example files contain placeholders only.

## Gnani setup

1. Put your Gnani API key in `backend/.env` as `GNANI_API_KEY`.
2. Keep the documented model IDs and endpoints unless your Gnani account specifies otherwise.
3. Use **Start conversation** for continuous Prisma streaming. The browser requests a 48 kHz mono microphone stream, converts Float32 audio to signed 16-bit little-endian PCM in 512-sample frames, and forwards each 1,024-byte frame to the backend at real-time cadence. The backend proxies frames over one authenticated Prisma WebSocket and forwards finalized VAD transcripts only. **Record one turn (fallback)** retains the WAV upload flow.
4. When a continuous session is active, assistant responses are automatically synthesized by Timbre and buffered as WAV for browser playback. `GNANI_TTS_MODEL`, `GNANI_TTS_VOICE`, and `GNANI_TTS_LANGUAGE` configure synthesis. Browser playback can still require the **Play assistant response** recovery button if autoplay is blocked.
5. Provider status starts at `DEVELOPMENT MODE` or `CONFIGURED · UNVERIFIED`; it changes to `CONNECTED` only after a successful provider request. Provider failures are reported in the workspace.

The app does not return simulated transcripts or synthesized audio when credentials are missing. Use the text input in development fallback mode. Streaming STT forwards finalized segments only; single-turn WAV upload remains available as a fallback.

Documentation checked for the provider adapters:

- [Gnani Quick Start](https://docs.gnani.ai/api/introduction/quick-start)
- [Prisma realtime WebSocket](https://docs.gnani.ai/api/STT/stt-websocket)
- [Timbre realtime WebSocket](https://docs.gnani.ai/api/TTS/tts-websocket)
- [Prisma v3 overview](https://www.gnani.ai/resources/prisma-v3)

## Demo workflow

With the backend and frontend running, use **Start conversation** when Prisma is configured, or use the copilot text input in development fallback mode:

1. “We have repeated login attempts against the admin account from an unfamiliar IP around 2 AM.”
2. “One login succeeded at 2:14 AM.”
3. “There was an unusual file download at 2:19 AM, but we don't know what it contained.”
4. Ask what to investigate next, review the recommended tasks and completeness gaps, and verify any evidence only after analyst confirmation.
5. Correct a timeline entry with its reason; the original statement and audit history are retained.
6. Ask a what-if question to view a scenario-only analysis, then open the report preview or download the Markdown report.

## Investigation and voice workflow

1. The dashboard loads the persisted incident and provider status. The analyst can submit text, record a single turn for WAV transcription, or start a continuous voice session.
2. Continuous voice captures mono microphone audio in the browser, forwards PCM frames through the backend, and sends only finalized Prisma transcripts to the investigation flow. Brief connection losses trigger up to three reconnect attempts with 1-, 2-, and 4-second delays; the retry budget resets after a connection stays stable for 30 seconds. Ending the conversation cancels retries.
3. Each transcript is analyzed by the configured structured OpenAI extractor or, when no key is configured, the clearly labeled deterministic development rules engine. Model context is bounded to the last 12 conversation turns plus capped incident history. Exact repeated timeline statements and evidence are deduplicated.
4. Validated decisions update the incident database and are broadcast to connected dashboards. Reported statements, hypotheses, and evidence verification remain distinct; analysts control evidence verification and timeline corrections.
5. During an active continuous voice session, assistant responses are synthesized through Timbre and played in the browser. The playback recovery button remains available if browser autoplay is blocked. Manual interruption is supported; voice-onset interruption is experimental and may react to echo.
6. The intelligence panels derive a relationship graph and investigation-completeness gaps from persisted incident data. What-if analysis is a deterministic scenario aid and does not change incident state. Reports are generated from persisted state and are available in the dashboard preview and as Markdown.

The development rules engine supports demonstration turns without claiming that an LLM or Gnani provider is connected. A reported statement is not presented as confirmed evidence.

## API overview

| Route | Purpose |
|---|---|
| `GET /api/health` | Backend, provider, and analysis-engine status |
| `GET /api/incident` | Current persisted incident state |
| `POST /api/voice/transcript` | Analyze and record an analyst statement |
| `POST /api/voice/stt` | Transcribe WAV audio with Prisma, or return an explicit unconfigured status |
| `POST /api/voice/tts` | Synthesize speech with Timbre, or return an explicit unconfigured status |
| `WS /ws/voice` | Authenticated backend-to-Prisma streaming session for continuous PCM transcription |
| `GET /api/investigation/graph` | Build an incident relationship graph from persisted data |
| `GET /api/investigation/completeness` | Return investigation gaps and related existing tasks |
| `POST /api/investigation/what-if` | Return a scenario-only analysis without persisting changes |
| `PATCH /api/timeline/{event_id}` | Correct a timeline entry while preserving its original statement and audit history |
| `POST /api/evidence` | Add analyst-reported or unknown evidence |
| `PATCH /api/evidence/{evidence_id}` | Change verification status through an explicit analyst action |
| `PATCH /api/tasks/{task_id}` | Update task status or priority |
| `GET /api/report` | Download a Markdown report from current incident state |
| `WS /ws` | Receive incident, assistant, and connection status updates |

## Tests

From `backend/`:

```powershell
python -m unittest discover -s tests -v
```

From `frontend/`:

```powershell
npm run build
```

## Troubleshooting

- **`npm install` reports no `package.json`:** run it from `E:\VoxShieldAI\frontend`, not the repository root.
- **Port 8000 bind error (`10048`):** another process is already listening. Check with `Get-NetTCPConnection -LocalPort 8000 -State Listen`; reuse it, stop that specific PID, or configure a different port and update `NEXT_PUBLIC_API_BASE_URL`.
- **API/WebSocket disconnected:** verify that the backend is running and that `NEXT_PUBLIC_API_BASE_URL` matches its host and port. Restart the Next.js dev server after changing `.env.local`.
- **Microphone access denied:** allow microphone permission for `localhost`, then retry; the text input remains available.
- **Continuous Prisma session unavailable:** verify `GNANI_API_KEY`, `GNANI_STT_WS_URL`, and `GNANI_STT_MODEL` in `backend/.env`, restart FastAPI, and check the Prisma status. Text updates and single-turn WAV transcription remain available.
- **Voice keeps reconnecting:** the client makes at most three retries per connection-loss episode, with the retry budget resetting after 30 seconds of stable connection. If retries fail, end the conversation and check the backend, network, and Prisma provider status before starting again.
- **Prisma/Timbre shows DEVELOPMENT MODE:** set `GNANI_API_KEY` in `backend/.env` and restart FastAPI. A configured key is not shown as connected until a provider call succeeds.
- **OpenAI extraction unavailable:** with no `OPENAI_API_KEY`, the app uses the deterministic development rules engine. If a configured model request fails, the API reports an error instead of silently switching behavior.

## Current limitations

- The single-turn recording fallback submits Prisma transcription after recording ends; partial live transcripts are not processed as incident updates.
- Continuous Prisma transcription uses provider VAD and only forwards finalized transcript segments. Reconnect is bounded to three attempts per connection-loss episode; a short outage may mean audio spoken during the disconnect is not transcribed.
- The browser-to-backend voice WebSocket checks request Origin, but this prototype does not have user login/session authentication. Origin validation is not authentication.
- Browser single-turn recording has a 27-second maximum and uses a pause to detect the end of a turn. Browser autoplay restrictions can require the **Play assistant response** button.
- Voice-onset interruption is experimental: it relies on browser echo cancellation plus sustained microphone energy while Timbre audio is playing. Use the manual interrupt control if onset detection misses speech or reacts to speaker echo. It has not been validated across physical devices.
- The relationship graph is limited to explicit persisted links and source-text mentions. Completeness checks and what-if output are deterministic heuristics, not a general reasoning engine.
- When external credentials are absent, text turns use the development rules engine; it is not a general-purpose AI investigator. Conversation context sent to structured extraction is capped to recent turns and selected incident history.
- Prisma and Timbre live requests, microphone permissions on the user's device, and external-account behavior require real credentials/device access and cannot be verified by the local automated tests.
- SQLite is suitable for local development; production deployment requires an appropriately managed database, credentials, and operational configuration.

## Audit

The initial repository findings and inspected runtime behavior are recorded in [AUDIT.md](./AUDIT.md).
