import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BASE_DIR / ".env")


def get_setting(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    return value


GNANI_API_KEY = get_setting("GNANI_API_KEY")
GNANI_STT_MODEL = get_setting("GNANI_STT_MODEL", "prisma-v3.0")
GNANI_TTS_MODEL = get_setting("GNANI_TTS_MODEL", "timbre-v2.5")
GNANI_STT_WS_URL = get_setting("GNANI_STT_WS_URL", "wss://api.vachana.ai/stt/v3/stream")
GNANI_STT_REST_URL = get_setting("GNANI_STT_REST_URL", "https://api.vachana.ai/stt/v3")
GNANI_TTS_WS_URL = get_setting("GNANI_TTS_WS_URL", "wss://api.vachana.ai/api/v1/tts")
GNANI_TTS_VOICE = get_setting("GNANI_TTS_VOICE", "Nalini")
GNANI_TTS_LANGUAGE = get_setting("GNANI_TTS_LANGUAGE", "en-IN")
OPENAI_API_KEY = get_setting("OPENAI_API_KEY")
OPENAI_MODEL = get_setting("OPENAI_MODEL", "gpt-4o-mini")
DATABASE_URL = get_setting("DATABASE_URL", "sqlite:///./incident.db")
APP_ENV = get_setting("APP_ENV", "development")
FRONTEND_ORIGIN = get_setting("FRONTEND_ORIGIN", "http://localhost:3000")
