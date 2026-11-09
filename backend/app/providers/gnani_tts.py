from __future__ import annotations

import asyncio
import base64
import json
from typing import Any

import websockets

from app.core.config import GNANI_API_KEY, GNANI_TTS_MODEL, GNANI_TTS_WS_URL


class GnaniTTSProvider:
    def __init__(self) -> None:
        self.api_key = GNANI_API_KEY
        self.model = GNANI_TTS_MODEL
        self.endpoint = GNANI_TTS_WS_URL
        self._last_status = "not_configured"

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.endpoint and self.model)

    @property
    def status(self) -> str:
        if not self.configured:
            return "not_configured"
        return "configured_not_verified" if self._last_status == "not_configured" else self._last_status

    async def synthesize(self, text: str, voice: str = "Nalini", language: str = "en-IN") -> dict[str, Any]:
        if not self.configured:
            return {
                "mode": "development_fallback",
                "provider": "gnani-timbre",
                "status": "not_configured",
                "message": "Timbre is not configured. Text responses remain available without speech playback.",
                "audio_base64": "",
            }

        message = {
            "text": text,
            "voice": voice,
            "model": self.model,
            "language": language,
            "speed": 1.0,
            "audio_config": {
                "sample_rate": 48000,
                "num_channels": 1,
                "sample_width": 2,
                "encoding": "linear_pcm",
                "container": "wav",
            },
        }

        audio_chunks: list[bytes] = []
        try:
            async with websockets.connect(
                self.endpoint,
                extra_headers={"X-API-Key-ID": self.api_key or ""},
                open_timeout=10,
                close_timeout=5,
            ) as websocket:
                await websocket.send(json.dumps(message))

                async def receive_audio() -> None:
                    async for raw_message in websocket:
                        frame = json.loads(raw_message)
                        if frame.get("type") == "error":
                            raise RuntimeError(frame.get("message", "Gnani TTS error"))
                        if frame.get("type") == "audio":
                            audio = frame.get("data", {}).get("audio")
                            if isinstance(audio, str) and audio:
                                audio_chunks.append(base64.b64decode(audio, validate=True))
                        elif frame.get("type") == "complete":
                            break
                await asyncio.wait_for(receive_audio(), timeout=60)
        except Exception:
            self._last_status = "error"
            raise

        if not audio_chunks:
            self._last_status = "error"
            raise RuntimeError("Gnani TTS completed without returning audio.")
        self._last_status = "connected"
        audio_bytes = b"".join(audio_chunks)
        return {
            "mode": "live",
            "provider": "gnani-timbre",
            "status": "ok",
            "content_type": "audio/wav",
            "audio_base64": base64.b64encode(audio_bytes).decode("ascii"),
        }
