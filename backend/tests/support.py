from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from app import main
from app.agents.investigation_agent import InvestigationAgent
from app.core.state_engine import StateEngine
from app.providers.gnani_stt import GnaniSTTProvider
from app.providers.gnani_tts import GnaniTTSProvider


class BackendTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        database_path = Path(self.temp_dir.name) / "incident-test.db"
        self.engine = StateEngine(f"sqlite:///{database_path.as_posix()}")
        self.engine._seed_demo_incident()
        main.state_engine = self.engine
        main.agent = InvestigationAgent()
        main.agent.api_key = None
        main.stt_provider = GnaniSTTProvider()
        main.stt_provider.api_key = None
        main.tts_provider = GnaniTTSProvider()
        main.tts_provider.api_key = None
        self.client = TestClient(main.app)

    def tearDown(self) -> None:
        self.client.close()
        self.engine.engine.dispose()
        self.temp_dir.cleanup()
