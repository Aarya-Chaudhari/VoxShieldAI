from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from app.agents.investigation_agent import InvestigationAgent
from app.core.state_engine import StateEngine
from app.schemas.incident import InvestigationDecision
from tests.support import BackendTestCase


class InvestigationFlowTests(BackendTestCase):
    def test_llm_context_is_bounded_and_excludes_unneeded_audit_history(self) -> None:
        state = {
            "id": "INC-TEST",
            "timeline": [{"id": str(index)} for index in range(40)],
            "evidence": [{"id": str(index)} for index in range(40)],
            "hypotheses": [{"id": str(index)} for index in range(30)],
            "tasks": [
                {"id": "open", "status": "pending"},
                {"id": "closed", "status": "completed"},
            ],
            "messages": [
                {"speaker": "analyst", "text": str(index), "timestamp": str(index)}
                for index in range(30)
            ],
            "audit": [{"id": str(index)} for index in range(100)],
            "questions": [str(index) for index in range(20)],
            "risk_factors": [str(index) for index in range(20)],
        }

        compact = InvestigationAgent._compact_incident_context(state)

        self.assertEqual(len(compact["timeline"]), 30)
        self.assertEqual(len(compact["evidence"]), 30)
        self.assertEqual(len(compact["hypotheses"]), 20)
        self.assertEqual([task["id"] for task in compact["open_tasks"]], ["open"])
        self.assertEqual(len(compact["recent_conversation"]), 12)
        self.assertEqual(len(compact["questions"]), 10)
        self.assertEqual(len(compact["risk_factors"]), 10)
        self.assertNotIn("audit", compact)

    def test_explicit_report_request_marks_report_ready_for_dashboard(self) -> None:
        agent = InvestigationAgent()
        agent.api_key = "test-key"
        with patch.object(
            agent,
            "_evaluate_with_llm",
            return_value=InvestigationDecision(assistant_response="Preparing the report."),
        ):
            decision = agent.evaluate("Please show me the incident report.")

        self.assertTrue(decision.report_ready)
        self.assertIn("displayed in the dashboard under Reports", decision.assistant_response)

    def test_empty_model_response_is_reported_instead_of_succeeding_silently(self) -> None:
        agent = InvestigationAgent()
        agent.api_key = "test-key"
        with patch.object(agent, "_evaluate_with_llm", return_value=InvestigationDecision()):
            with self.assertRaisesRegex(RuntimeError, "returned no response text"):
                agent.evaluate("We have repeated login attempts.")
        self.assertEqual(agent.mode, "openai_error")

    def test_empty_database_is_seeded_for_reads_and_writes(self) -> None:
        engines = [
            StateEngine(f"sqlite:///{(Path(self.temp_dir.name) / name).as_posix()}")
            for name in ("empty-read.db", "empty-decision.db", "empty-evidence.db")
        ]
        try:
            initial_state = engines[0].get_state()
            self.assertEqual(initial_state["id"], "INC-2026-001")
            self.assertEqual(len(initial_state["timeline"]), 3)

            decision_state = engines[1].apply_decision(InvestigationDecision(assistant_response="Ready."))
            self.assertEqual(decision_state["id"], "INC-2026-001")

            evidence_state = engines[2].create_evidence(
                "Initial check",
                "Created against a newly initialized incident.",
                "observation",
                "REPORTED",
            )
            self.assertEqual(len(evidence_state["evidence"]), 2)
        finally:
            for engine in engines:
                engine.engine.dispose()

    def test_demo_conversation_records_and_corrects_reported_facts(self) -> None:
        turns = [
            "We have repeated login attempts against the admin account from an unfamiliar IP around 2 AM.",
            "One login succeeded at 2:14 AM.",
            "There was an unusual file download at 2:19 AM, but we don't know what it contained.",
            "Actually, correct the successful login time. It was 2:16 AM.",
            "What should we investigate next?",
            "Prepare the incident report.",
        ]

        responses = [self.client.post("/api/voice/transcript", json={"transcript": turn}) for turn in turns]
        self.assertTrue(all(response.status_code == 200 for response in responses))
        state = self.client.get("/api/incident").json()

        successful_login = next(item for item in state["timeline"] if "login succeeded" in item["description"].lower())
        self.assertIn("02:16:00", successful_login["event_time"])
        self.assertEqual(successful_login["original_statement"], "One login succeeded at 2:14 AM.")
        self.assertTrue(any(item["status"] == "UNKNOWN" for item in state["evidence"]))
        self.assertTrue(any(item["status"] == "HYPOTHESIS" for item in state["hypotheses"]))
        self.assertTrue(any(item["title"] == "Verify authentication logs" for item in state["tasks"]))
        self.assertTrue(any(item["action"] == "timeline.corrected" for item in state["audit"]))
        self.assertEqual(state["status"], "report-ready")
        self.assertEqual(len([item for item in state["messages"] if item["speaker"] == "analyst"]), len(turns))

        report = self.client.get("/api/report")
        self.assertEqual(report.status_code, 200)
        self.assertIn("## Confirmed evidence", report.text)
        self.assertIn("## Unknown or missing evidence", report.text)
        self.assertIn("No evidence is currently marked CONFIRMED.", report.text)
        self.assertIn("2:14 AM", report.text)
        self.assertIn("2:16:00", report.text)

    def test_investigation_graph_uses_persisted_relationships_and_sources(self) -> None:
        response = self.client.get("/api/investigation/graph")
        self.assertEqual(response.status_code, 200)
        graph = response.json()

        node_ids = {node["id"] for node in graph["nodes"]}
        self.assertTrue(any(node["type"] == "timeline" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "entity" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "evidence" for node in graph["nodes"]))
        self.assertTrue(any(node["type"] == "task" for node in graph["nodes"]))
        self.assertTrue(graph["edges"])
        self.assertTrue(all(edge["source"] in node_ids and edge["target"] in node_ids for edge in graph["edges"]))
        self.assertTrue(all(edge["source_references"] and edge["explanation"] for edge in graph["edges"]))

    def test_completeness_reports_gaps_without_duplicating_existing_tasks(self) -> None:
        response = self.client.get("/api/investigation/completeness")
        self.assertEqual(response.status_code, 200)
        gaps = response.json()["gaps"]
        authentication_gap = next(gap for gap in gaps if gap["title"] == "Validate authentication records")
        download_gap = next(gap for gap in gaps if gap["title"] == "Identify and classify the downloaded file")

        self.assertEqual(authentication_gap["priority"], "high")
        self.assertEqual(download_gap["priority"], "high")
        self.assertIsNotNone(authentication_gap["existing_task_id"])
        self.assertIsNotNone(download_gap["existing_task_id"])

    def test_repeated_statement_does_not_duplicate_incident_events_or_evidence(self) -> None:
        transcript = "One login succeeded at 2:14 AM."
        first = self.client.post("/api/voice/transcript", json={"transcript": transcript})
        second = self.client.post("/api/voice/transcript", json={"transcript": transcript})
        state = self.client.get("/api/incident").json()

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(
            len([event for event in state["timeline"] if event["original_statement"] == transcript]),
            1,
        )
        self.assertEqual(
            len([item for item in state["evidence"] if item["title"] == "Successful login event"]),
            1,
        )

    def test_what_if_analysis_is_explicitly_scenario_only_and_does_not_mutate_incident(self) -> None:
        before = self.client.get("/api/incident").json()
        response = self.client.post(
            "/api/investigation/what-if",
            json={"question": "What if the successful login was legitimate?"},
        )
        after = self.client.get("/api/incident").json()

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["scenario_only"])
        self.assertFalse(response.json()["incident_state_changed"])
        self.assertEqual(response.json()["source_references"], [item["id"] for item in before["timeline"]])
        self.assertEqual(before["timeline"], after["timeline"])
        self.assertEqual(before["evidence"], after["evidence"])
        self.assertEqual(before["tasks"], after["tasks"])
        self.assertEqual(before["audit"], after["audit"])

    def test_empty_transcript_is_rejected_without_state_change(self) -> None:
        before = self.client.get("/api/incident").json()
        response = self.client.post("/api/voice/transcript", json={"transcript": "  "})
        after = self.client.get("/api/incident").json()
        self.assertEqual(response.status_code, 422)
        self.assertEqual(len(before["messages"]), len(after["messages"]))
