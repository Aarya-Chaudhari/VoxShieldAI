from __future__ import annotations

import asyncio
import base64
import json
from unittest.mock import AsyncMock
from unittest.mock import patch

from websockets.exceptions import WebSocketException

from tests.support import BackendTestCase
from app import main
from app.core.config import GNANI_TTS_LANGUAGE, GNANI_TTS_VOICE
from app.providers.gnani_tts import GnaniTTSProvider


class UnconfiguredSTT:
    status = "not_configured"

    async def transcribe_from_uploaded_audio(self, payload: bytes, filename: str) -> dict[str, str]:
        return {
            "mode": "development_fallback",
            "provider": "gnani-prisma",
            "status": "not_configured",
            "message": "Prisma is not configured. Use the text input.",
        }


class UnconfiguredTTS:
    status = "not_configured"

    async def synthesize(self, text: str, voice: str, language: str) -> dict[str, str]:
        return {
            "mode": "development_fallback",
            "provider": "gnani-timbre",
            "status": "not_configured",
            "message": "Timbre is not configured.",
            "audio_base64": "",
        }


class FakeTTSWebSocket:
    def __init__(self) -> None:
        self.sent_messages: list[str] = []

    async def __aenter__(self) -> FakeTTSWebSocket:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def send(self, message: str) -> None:
        self.sent_messages.append(message)

    def __aiter__(self):
        async def frames():
            yield json.dumps({"type": "audio", "data": {"audio": base64.b64encode(b"wav-data").decode()}})
            yield json.dumps({"type": "complete", "data": {"audio": "", "is_final": True}})

        return frames()


class FakePrismaWebSocket:
    def __init__(self) -> None:
        self.frames: asyncio.Queue[dict[str, object] | None] = asyncio.Queue()
        self.audio_frames: list[bytes] = []

    async def __aenter__(self) -> FakePrismaWebSocket:
        return self

    async def __aexit__(self, *_: object) -> None:
        return None

    async def recv(self) -> str:
        return json.dumps({"type": "connected"})

    async def send(self, payload: bytes) -> None:
        self.audio_frames.append(payload)
        if isinstance(payload, bytes):
            await self.frames.put({"type": "processing"})
            await self.frames.put({"type": "transcript", "text": "partial", "is_final": False})
            final = {"type": "transcript", "text": "Login succeeded.", "is_final": True, "segment_id": "seg-1"}
            await self.frames.put(final)
            await self.frames.put(final)

    def __aiter__(self):
        async def frames():
            while True:
                frame = await self.frames.get()
                if frame is None:
                    return
                yield json.dumps(frame)

        return frames()


class ProviderAndWebSocketTests(BackendTestCase):
    def test_tts_route_uses_environment_configured_voice_and_language(self) -> None:
        main.tts_provider.synthesize = AsyncMock(return_value={
            "mode": "live",
            "provider": "gnani-timbre",
            "status": "ok",
            "audio_base64": "d2F2",
        })

        response = self.client.post("/api/voice/tts", json={"text": "Test response"})

        self.assertEqual(response.status_code, 200)
        main.tts_provider.synthesize.assert_awaited_once_with(
            "Test response",
            voice=GNANI_TTS_VOICE or "Nalini",
            language=GNANI_TTS_LANGUAGE or "en-IN",
        )

    def test_prisma_streaming_uses_documented_headers_and_rate(self) -> None:
        provider = main.stt_provider
        provider.api_key = "test-key"

        with patch("app.providers.gnani_stt.websockets.connect") as connect:
            provider.open_stream("en-IN", 48000)

        self.assertEqual(connect.call_args.args[0], provider.websocket_endpoint)
        self.assertEqual(connect.call_args.kwargs["extra_headers"]["x-api-key-id"], "test-key")
        self.assertEqual(connect.call_args.kwargs["extra_headers"]["x-sample-rate"], "48000")
        self.assertEqual(connect.call_args.kwargs["extra_headers"]["model"], provider.model)

    def test_continuous_prisma_stream_forwards_pcm_and_only_final_transcripts(self) -> None:
        provider = main.stt_provider
        provider.api_key = "test-key"
        prisma = FakePrismaWebSocket()

        with patch.object(provider, "open_stream", return_value=prisma):
            with self.client.websocket_connect("/ws/voice", headers={"origin": "http://localhost:3000"}) as websocket:
                websocket.send_json({"type": "start", "language_code": "en-IN", "sample_rate": 48000})
                ready = websocket.receive_json()
                self.assertEqual(ready["type"], "session.ready")
                websocket.send_bytes(b"\x00" * 1024)
                processing = websocket.receive_json()
                transcript = websocket.receive_json()
                state = websocket.receive_json()
                self.assertEqual(processing, {"type": "session.state", "state": "PROCESSING"})
                self.assertEqual(transcript["type"], "transcript.final")
                self.assertEqual(transcript["text"], "Login succeeded.")
                self.assertEqual(state, {"type": "session.state", "state": "LISTENING"})
                websocket.send_json({"type": "stop"})

        self.assertEqual(prisma.audio_frames, [b"\x00" * 1024])

    def test_continuous_prisma_stream_rejects_non_pcm_frame_sizes(self) -> None:
        provider = main.stt_provider
        provider.api_key = "test-key"
        prisma = FakePrismaWebSocket()

        with patch.object(provider, "open_stream", return_value=prisma):
            with self.client.websocket_connect("/ws/voice", headers={"origin": "http://localhost:3000"}) as websocket:
                websocket.send_json({"type": "start", "language_code": "en-IN", "sample_rate": 48000})
                websocket.receive_json()
                websocket.send_bytes(b"not-a-pcm-frame")
                error = websocket.receive_json()
                self.assertEqual(error["type"], "session.error")
                self.assertIn("1,024 bytes", error["message"])

    def test_timbre_uses_headers_supported_by_pinned_websockets_client(self) -> None:
        provider = GnaniTTSProvider()
        provider.api_key = "test-key"
        websocket = FakeTTSWebSocket()

        with patch("app.providers.gnani_tts.websockets.connect", return_value=websocket) as connect:
            result = asyncio.run(provider.synthesize("Test speech"))

        self.assertEqual(connect.call_args.kwargs["extra_headers"], {"X-API-Key-ID": "test-key"})
        self.assertNotIn("additional_headers", connect.call_args.kwargs)
        self.assertEqual(json.loads(websocket.sent_messages[0])["model"], provider.model)
        self.assertEqual(base64.b64decode(result["audio_base64"]), b"wav-data")
        self.assertEqual(result["status"], "ok")

    def test_timbre_websocket_failures_return_actionable_http_errors(self) -> None:
        main.tts_provider.synthesize = AsyncMock(side_effect=WebSocketException("provider handshake failed"))
        response = self.client.post("/api/voice/tts", json={"text": "Test"})
        self.assertEqual(response.status_code, 502)
        self.assertIn("Timbre speech generation failed: provider handshake failed", response.json()["detail"])

    def test_unconfigured_providers_do_not_return_simulated_transcript_or_audio(self) -> None:
        main.stt_provider = UnconfiguredSTT()
        main.tts_provider = UnconfiguredTTS()
        health = self.client.get("/api/health").json()
        self.assertEqual(health["providers"]["prisma"], "not_configured")
        self.assertEqual(health["providers"]["timbre"], "not_configured")

        transcription = self.client.post(
            "/api/voice/stt",
            files={"file": ("sample.wav", b"RIFF-test", "audio/wav")},
        )
        self.assertEqual(transcription.status_code, 200)
        self.assertNotIn("transcript", transcription.json())
        self.assertEqual(transcription.json()["mode"], "development_fallback")

        speech = self.client.post("/api/voice/tts", json={"text": "Test response"})
        self.assertEqual(speech.status_code, 200)
        self.assertEqual(speech.json()["audio_base64"], "")
        self.assertEqual(speech.json()["mode"], "development_fallback")

    def test_websocket_broadcasts_state_updates_and_real_connection_status(self) -> None:
        with self.client.websocket_connect("/ws") as websocket:
            connection = websocket.receive_json()
            initial_state = websocket.receive_json()
            self.assertEqual(connection["type"], "connection.status")
            self.assertEqual(connection["payload"]["prisma"], "not_configured")
            self.assertEqual(initial_state["type"], "incident.updated")

            websocket.send_json({
                "type": "transcript.final",
                "payload": {"text": "One login succeeded at 2:14 AM."},
            })
            updated = websocket.receive_json()
            self.assertEqual(updated["type"], "incident.updated")
            self.assertTrue(any("login succeeded" in item["description"].lower() for item in updated["payload"]["timeline"]))
            assistant = websocket.receive_json()
            self.assertEqual(assistant["type"], "assistant.response")
            self.assertIn("analyst-reported", assistant["payload"]["text"])
