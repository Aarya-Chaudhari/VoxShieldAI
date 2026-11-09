from __future__ import annotations

import asyncio
import json
from typing import Any

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field, ValidationError, field_validator
from websockets.exceptions import WebSocketException

from app.agents.investigation_agent import InvestigationAgent
from app.core.config import FRONTEND_ORIGIN, GNANI_TTS_LANGUAGE, GNANI_TTS_VOICE
from app.core.investigation_intelligence import analyze_what_if, build_completeness, build_knowledge_graph
from app.core.state_engine import StateEngine
from app.providers.gnani_stt import GnaniSTTProvider
from app.providers.gnani_tts import GnaniTTSProvider
from app.schemas.incident import EvidenceCreate, EvidenceVerification, TaskUpdate, TimelineEventUpdate

app = FastAPI(title="VOXSHIELD", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN or "http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT"],
    allow_headers=["Content-Type"],
)

state_engine = StateEngine()
agent = InvestigationAgent()
stt_provider = GnaniSTTProvider()
tts_provider = GnaniTTSProvider()
active_connections: set[WebSocket] = set()
MAX_AUDIO_BYTES = 10 * 1024 * 1024


class TranscriptRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=10000)

    @field_validator("transcript")
    @classmethod
    def trim_transcript(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Transcript must contain non-whitespace text.")
        return normalized


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class WhatIfRequest(BaseModel):
    question: str = Field(min_length=4, max_length=1000)

    @field_validator("question")
    @classmethod
    def trim_question(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("A scenario question is required.")
        return normalized


class VoiceSessionStart(BaseModel):
    type: str = Field(pattern="^start$")
    language_code: str = Field(default="en-IN", min_length=2, max_length=24)
    sample_rate: int = Field(default=48000, ge=8000, le=48000)

    @field_validator("sample_rate")
    @classmethod
    def validate_sample_rate(cls, value: int) -> int:
        if value not in {8000, 16000, 44100, 48000}:
            raise ValueError("Unsupported Prisma sample rate.")
        return value


def connection_state() -> dict[str, str]:
    return {
        "status": "connected",
        "prisma": stt_provider.status,
        "timbre": tts_provider.status,
        "investigation": agent.mode,
    }


def incident_state() -> dict[str, Any]:
    state = state_engine.get_state()
    state["connection"] = connection_state()
    return state


async def broadcast(event_type: str, payload: dict[str, Any]) -> None:
    message = {"type": event_type, "payload": payload}
    stale: list[WebSocket] = []
    for websocket in tuple(active_connections):
        try:
            await websocket.send_json(message)
        except (WebSocketDisconnect, RuntimeError):
            stale.append(websocket)
    for websocket in stale:
        active_connections.discard(websocket)


async def process_transcript(transcript: str) -> dict[str, Any]:
    try:
        decision = await asyncio.to_thread(agent.evaluate, transcript, incident_state())
    except (requests.RequestException, ValidationError, KeyError, RuntimeError, json.JSONDecodeError) as exc:
        await broadcast("connection.status", connection_state())
        raise HTTPException(status_code=502, detail=f"Investigation analysis failed: {exc}") from exc

    state = state_engine.apply_decision(decision, transcript)
    state["connection"] = connection_state()
    await broadcast("incident.updated", state)
    await broadcast("assistant.response", {"text": decision.assistant_response})
    await broadcast("connection.status", connection_state())
    return {"status": "ok", "decision": decision.model_dump(), "state": state}


@app.get("/api/health")
async def health() -> dict[str, Any]:
    providers = {
        "prisma": stt_provider.status,
        "timbre": tts_provider.status,
    }
    return {
        "status": "ok",
        "app": "VOXSHIELD",
        "mode": "live_gnani" if "connected" in providers.values() else "development_fallback",
        "providers": providers,
        "investigation_engine": agent.mode,
    }


@app.get("/api/incident")
async def get_incident() -> dict[str, Any]:
    return incident_state()


@app.get("/api/investigation/graph")
async def investigation_graph() -> dict[str, Any]:
    return build_knowledge_graph(state_engine.get_state())


@app.get("/api/investigation/completeness")
async def investigation_completeness() -> dict[str, Any]:
    return build_completeness(state_engine.get_state())


@app.post("/api/investigation/what-if")
async def what_if_scenario(payload: WhatIfRequest) -> dict[str, Any]:
    state = state_engine.get_state()
    return analyze_what_if(payload.question, state)


@app.get("/api/report")
async def get_report() -> PlainTextResponse:
    return PlainTextResponse(
        state_engine.generate_report(),
        media_type="text/markdown",
        headers={"Content-Disposition": 'attachment; filename="voxshield-incident-report.md"'},
    )


@app.post("/api/voice/transcript")
async def final_transcript(payload: TranscriptRequest) -> dict[str, Any]:
    return await process_transcript(payload.transcript.strip())


@app.post("/api/voice/stt")
async def stt_upload(file: UploadFile | None = File(default=None)) -> dict[str, Any]:
    if file is None:
        raise HTTPException(status_code=400, detail="Upload a WAV audio recording to transcribe.")
    if file.content_type not in {"audio/wav", "audio/x-wav", "audio/wave"} and not (file.filename or "").lower().endswith(".wav"):
        raise HTTPException(status_code=415, detail="Prisma transcription currently requires a WAV recording.")
    payload = await file.read(MAX_AUDIO_BYTES + 1)
    if not payload:
        raise HTTPException(status_code=400, detail="The uploaded audio is empty.")
    if len(payload) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio recordings must be 10 MB or smaller.")

    try:
        result = await stt_provider.transcribe_from_uploaded_audio(payload, file.filename or "recording.wav")
    except (requests.RequestException, ValueError, RuntimeError) as exc:
        await broadcast("connection.status", connection_state())
        raise HTTPException(status_code=502, detail=f"Prisma transcription failed: {exc}") from exc
    await broadcast("connection.status", connection_state())
    return result


@app.post("/api/voice/tts")
async def tts_synthesis(payload: TTSRequest) -> dict[str, Any]:
    try:
        result = await tts_provider.synthesize(
            payload.text.strip(),
            voice=GNANI_TTS_VOICE or "Nalini",
            language=GNANI_TTS_LANGUAGE or "en-IN",
        )
    except (OSError, ValueError, RuntimeError, WebSocketException) as exc:
        await broadcast("connection.status", connection_state())
        raise HTTPException(status_code=502, detail=f"Timbre speech generation failed: {exc}") from exc
    await broadcast("connection.status", connection_state())
    return result


@app.websocket("/ws/voice")
async def voice_stream(websocket: WebSocket) -> None:
    allowed_origins = {FRONTEND_ORIGIN or "http://localhost:3000", "http://127.0.0.1:3000"}
    origin = websocket.headers.get("origin")
    if origin not in allowed_origins:
        await websocket.close(code=1008, reason="Origin is not allowed.")
        return

    await websocket.accept()
    try:
        start_message = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        start = VoiceSessionStart.model_validate_json(start_message)
    except (asyncio.TimeoutError, ValidationError, json.JSONDecodeError) as exc:
        await websocket.send_json({"type": "session.error", "message": f"Invalid voice session start: {exc}"})
        await websocket.close(code=1008)
        return

    if not stt_provider.stream_configured:
        await websocket.send_json({
            "type": "session.error",
            "message": "Prisma streaming is not configured. Use typed updates or single-recording transcription.",
        })
        await websocket.close(code=1013)
        return

    try:
        async with stt_provider.open_stream(start.language_code, start.sample_rate) as provider_socket:
            try:
                initial = json.loads(await asyncio.wait_for(provider_socket.recv(), timeout=10))
            except (asyncio.TimeoutError, json.JSONDecodeError) as exc:
                raise RuntimeError("Prisma did not confirm the streaming session.") from exc
            if not isinstance(initial, dict):
                raise RuntimeError("Prisma returned an invalid streaming handshake.")
            if initial.get("type") == "error":
                raise RuntimeError(initial.get("message", "Prisma rejected the streaming session."))
            if initial.get("type") != "connected":
                raise RuntimeError("Prisma returned an unexpected streaming handshake.")

            stt_provider._last_status = "connected"
            await websocket.send_json({
                "type": "session.ready",
                "state": "LISTENING",
                "provider": "gnani-prisma",
                "sample_rate": start.sample_rate,
            })
            await broadcast("connection.status", connection_state())
            seen_segments: set[str] = set()

            async def forward_audio() -> None:
                while True:
                    message = await websocket.receive()
                    if message["type"] == "websocket.disconnect":
                        return
                    payload = message.get("bytes")
                    if payload is not None:
                        if len(payload) != 1024:
                            await websocket.send_json({
                                "type": "session.error",
                                "message": "Prisma expects raw PCM frames of exactly 1,024 bytes.",
                            })
                            return
                        await provider_socket.send(payload)
                        continue
                    text = message.get("text")
                    if text:
                        try:
                            control = json.loads(text)
                        except json.JSONDecodeError:
                            await websocket.send_json({"type": "session.error", "message": "Invalid voice control message."})
                            continue
                        if isinstance(control, dict) and control.get("type") == "stop":
                            return
                        await websocket.send_json({"type": "session.error", "message": "Unsupported voice control message."})

            async def forward_provider_events() -> None:
                async for raw_message in provider_socket:
                    if not isinstance(raw_message, str):
                        continue
                    frame = json.loads(raw_message)
                    if not isinstance(frame, dict):
                        continue
                    frame_type = frame.get("type")
                    if frame_type == "error":
                        stt_provider._last_status = "error"
                        await websocket.send_json({
                            "type": "session.error",
                            "message": frame.get("message", "Prisma streaming failed."),
                        })
                        return
                    if frame_type == "processing":
                        await websocket.send_json({"type": "session.state", "state": "PROCESSING"})
                    elif frame_type == "speech_start":
                        await websocket.send_json({"type": "session.state", "state": "LISTENING"})
                    elif frame_type == "transcript":
                        segment_id = frame.get("segment_id")
                        transcript = frame.get("text")
                        if frame.get("is_final") is not True or not isinstance(transcript, str) or not transcript.strip():
                            continue
                        if isinstance(segment_id, str):
                            if segment_id in seen_segments:
                                continue
                            seen_segments.add(segment_id)
                            if len(seen_segments) > 1000:
                                seen_segments.clear()
                                seen_segments.add(segment_id)
                        await websocket.send_json({
                            "type": "transcript.final",
                            "text": transcript.strip(),
                            "segment_id": segment_id,
                        })
                        await websocket.send_json({"type": "session.state", "state": "LISTENING"})

            audio_task = asyncio.create_task(forward_audio())
            provider_task = asyncio.create_task(forward_provider_events())
            done, pending = await asyncio.wait(
                {audio_task, provider_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                try:
                    task.result()
                except WebSocketDisconnect:
                    pass
    except (OSError, RuntimeError, ValueError, WebSocketException, json.JSONDecodeError) as exc:
        stt_provider._last_status = "error"
        try:
            await websocket.send_json({"type": "session.error", "message": f"Prisma streaming failed: {exc}"})
        except (WebSocketDisconnect, RuntimeError):
            pass
        await broadcast("connection.status", connection_state())
    finally:
        if websocket.client_state.name == "CONNECTED":
            await websocket.close()


@app.patch("/api/tasks/{task_id}")
async def update_task(task_id: str, payload: TaskUpdate) -> dict[str, Any]:
    if not payload.model_fields_set:
        raise HTTPException(status_code=422, detail="Provide a task status or priority to update.")
    try:
        state = state_engine.update_task(**{"task_id": task_id, **payload.model_dump(exclude_unset=True)})
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    state["connection"] = connection_state()
    await broadcast("incident.updated", state)
    return state


@app.post("/api/evidence")
async def add_evidence(payload: EvidenceCreate) -> dict[str, Any]:
    state = state_engine.create_evidence(
        payload.title.strip(),
        payload.description.strip(),
        payload.evidence_type.strip(),
        payload.status,
    )
    state["connection"] = connection_state()
    await broadcast("incident.updated", state)
    return state


@app.patch("/api/evidence/{evidence_id}")
async def verify_evidence(evidence_id: str, payload: EvidenceVerification) -> dict[str, Any]:
    try:
        state = state_engine.verify_evidence(evidence_id, payload.status)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    state["connection"] = connection_state()
    await broadcast("incident.updated", state)
    return state


@app.patch("/api/timeline/{event_id}")
async def correct_timeline(event_id: str, payload: TimelineEventUpdate) -> dict[str, Any]:
    try:
        state = state_engine.update_timeline_event(
            event_id,
            payload.event_time,
            payload.description,
            payload.reason,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    state["connection"] = connection_state()
    await broadcast("incident.updated", state)
    return state


@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    active_connections.add(websocket)
    await websocket.send_json({"type": "connection.status", "payload": connection_state()})
    await websocket.send_json({"type": "incident.updated", "payload": incident_state()})
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "payload": {"message": "Invalid JSON WebSocket message."}})
                continue
            if not isinstance(message, dict):
                await websocket.send_json({"type": "error", "payload": {"message": "WebSocket message must be an object."}})
                continue

            event_type = message.get("type")
            payload = message.get("payload", {})
            if not isinstance(payload, dict):
                await websocket.send_json({"type": "error", "payload": {"message": "WebSocket payload must be an object."}})
            elif event_type == "transcript.final":
                try:
                    request = TranscriptRequest.model_validate({"transcript": payload.get("text", "")})
                    await process_transcript(request.transcript.strip())
                except ValidationError as exc:
                    await websocket.send_json({"type": "error", "payload": {"message": str(exc)}})
                except HTTPException as exc:
                    await websocket.send_json({"type": "error", "payload": {"message": exc.detail}})
            elif event_type == "assistant.audio":
                try:
                    request = TTSRequest.model_validate({"text": payload.get("text", "")})
                    result = await tts_provider.synthesize(
                        request.text,
                        voice=GNANI_TTS_VOICE or "Nalini",
                        language=GNANI_TTS_LANGUAGE or "en-IN",
                    )
                    await websocket.send_json({"type": "assistant.audio", "payload": result})
                    await broadcast("connection.status", connection_state())
                except (ValidationError, OSError, ValueError, RuntimeError, WebSocketException) as exc:
                    await websocket.send_json({"type": "error", "payload": {"message": f"Timbre speech generation failed: {exc}"}})
            else:
                await websocket.send_json({"type": "error", "payload": {"message": "Unsupported WebSocket event."}})
    except WebSocketDisconnect:
        pass
    finally:
        active_connections.discard(websocket)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
