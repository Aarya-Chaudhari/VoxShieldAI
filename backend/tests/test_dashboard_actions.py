from __future__ import annotations

from tests.support import BackendTestCase


class DashboardActionTests(BackendTestCase):
    def test_analyst_actions_persist_and_create_audit_entries(self) -> None:
        state = self.client.get("/api/incident").json()
        task = state["tasks"][0]
        evidence = state["evidence"][0]
        event = state["timeline"][1]

        updated_task = self.client.patch(
            f"/api/tasks/{task['id']}",
            json={"status": "completed", "priority": "low"},
        )
        self.assertEqual(updated_task.status_code, 200)
        task_after = next(item for item in updated_task.json()["tasks"] if item["id"] == task["id"])
        self.assertEqual(task_after["status"], "completed")
        self.assertEqual(task_after["priority"], "low")

        verified = self.client.patch(
            f"/api/evidence/{evidence['id']}",
            json={"status": "CONFIRMED"},
        )
        self.assertEqual(verified.status_code, 200)
        evidence_after = next(item for item in verified.json()["evidence"] if item["id"] == evidence["id"])
        self.assertEqual(evidence_after["status"], "CONFIRMED")

        corrected = self.client.patch(
            f"/api/timeline/{event['id']}",
            json={
                "event_time": "2026-11-07T02:16:00+00:00",
                "description": "Analyst corrected the successful login time to 2:16 AM.",
                "reason": "The original report contained a time transcription error.",
            },
        )
        self.assertEqual(corrected.status_code, 200)
        final_state = self.client.get("/api/incident").json()
        self.assertTrue(any(item["action"] == "task.status" for item in final_state["audit"]))
        self.assertTrue(any(item["action"] == "evidence.status" for item in final_state["audit"]))
        self.assertTrue(any(item["action"] == "timeline.time" for item in final_state["audit"]))
        self.assertEqual(
            next(item for item in final_state["timeline"] if item["id"] == event["id"])["original_statement"],
            event["original_statement"],
        )
        self.assertIn("CONFIRMED", self.client.get("/api/report").text)

    def test_invalid_task_or_evidence_ids_return_not_found(self) -> None:
        missing_task = self.client.patch("/api/tasks/absent", json={"status": "completed"})
        missing_evidence = self.client.patch("/api/evidence/absent", json={"status": "CONFIRMED"})
        self.assertEqual(missing_task.status_code, 404)
        self.assertEqual(missing_evidence.status_code, 404)
