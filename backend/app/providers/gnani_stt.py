from __future__ import annotations

import asyncio
import json
from typing import Any

import requests
import websockets

from app.core.config import GNANI_API_KEY, GNANI_STT_MODEL, GNANI_STT_REST_URL, GNANI_STT_WS_URL


class GnaniSTTProvider:
    def __init__(self) -> None:
        self.api_key = GNANI_API_KEY
        self.model = GNANI_STT_MODEL
        self.rest_endpoint = GNANI_STT_REST_URL
        self.websocket_endpoint = GNANI_STT_WS_URL
        self._last_status = "not_configured"

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.rest_endpoint and self.model)

    @property
    def status(self) -> str:
        if not self.configured:
            return "not_configured"
        return "configured_not_verified" if self._last_status == "not_configured" else self._last_status

    @property
    def stream_configured(self) -> bool:
        return bool(self.api_key and self.websocket_endpoint and self.model)

    def open_stream(self, language_code: str, sample_rate: int):
        if not self.stream_configured:
            raise RuntimeError("Prisma streaming is not configured.")
        if sample_rate not in {8000, 16000, 44100, 48000}:
            raise ValueError("Prisma streaming requires an 8, 16, 44.1, or 48 kHz audio stream.")
        headers = {
            "x-api-key-id": self.api_key or "",
            "model": self.model or "prisma-v3.0",
            "language_code": language_code,
            "x-sample-rate": str(sample_rate),
            "format": "verbatim",
            "x-idle-timeout-sec": "300",
            "x-vad-threshold": "0.6",
            "x-min-silence-ms": "700",
            "x-min-speech-ms": "100",
            "x-min-segment-ms": "120",
            "x-max-speech-s": "30",
        }
        return websockets.connect(
            self.websocket_endpoint,
            extra_headers=headers,
            open_timeout=10,
            close_timeout=5,
            ping_interval=20,
            ping_timeout=20,
        )

    async def stream_transcript(self, pcm_chunks: list[bytes], language_code: str = "en-IN") -> dict[str, Any]:
        if not self.configured:
            return {
                "mode": "development_fallback",
                "provider": "gnani-prisma",
                "status": "not_configured",
                "message": "Prisma is not configured. Use the text input or configure Gnani credentials.",
            }

        headers = {
            "x-api-key-id": self.api_key or "",
            "model": self.model or "prisma-v3.0",
            "language_code": language_code,
            "x-sample-rate": "16000",
        }
        results: list[dict[str, Any]] = []
        try:
            async with websockets.connect(
                self.websocket_endpoint,
                extra_headers=headers,
                open_timeout=10,
                close_timeout=5,
            ) as websocket:
                async def sender() -> None:
                    for chunk in pcm_chunks:
                        await websocket.send(chunk)
                    await websocket.send('{"type":"commit"}')

                async def receiver() -> None:
                    async for raw_message in websocket:
                        frame = json.loads(raw_message)
                        if frame.get("type") == "transcript":
                            results.append({
                                "text": frame.get("text", ""),
                                "segment_id": frame.get("segment_id"),
                                "final": frame.get("is_final", True),
                            })
                        elif frame.get("type") == "error":
                            raise RuntimeError(frame.get("message", "Gnani STT error"))

                await asyncio.wait_for(asyncio.gather(sender(), receiver()), timeout=60)
        except Exception:
            self._last_status = "error"
            raise

        self._last_status = "connected"
        return {"mode": "live", "segments": results, "provider": "gnani-prisma", "status": "ok"}

    def _transcribe(self, payload: bytes, filename: str) -> dict[str, Any]:
        response = requests.post(
            self.rest_endpoint or "",
            headers={"X-API-Key-ID": self.api_key or ""},
            files={"audio_file": (filename, payload, "audio/wav")},
            data={"model": self.model or "prisma-v3.0", "language_code": "en-IN"},
            timeout=60,
        )
        response.raise_for_status()
        result = response.json()
        transcript = result.get("transcript")
        if result.get("success") is False or not isinstance(transcript, str) or not transcript.strip():
            raise RuntimeError("Gnani STT returned no transcript.")
        return {
            "mode": "live",
            "transcript": transcript.strip(),
            "provider": "gnani-prisma",
            "status": "ok",
            "model": result.get("model", self.model),
            "request_id": result.get("request_id"),
        }

    async def transcribe_from_uploaded_audio(self, payload: bytes, filename: str) -> dict[str, Any]:
        if not payload:
            return {"mode": "error", "provider": "gnani-prisma", "status": "empty", "message": "The uploaded audio is empty."}
        if not self.configured:
            return {
                "mode": "development_fallback",
                "provider": "gnani-prisma",
                "status": "not_configured",
                "message": "Prisma is not configured. Use the text input or configure Gnani credentials.",
            }

        try:
            result = await asyncio.to_thread(self._transcribe, payload, filename)
        except Exception:
            self._last_status = "error"
            raise
        self._last_status = "connected"
        return result
