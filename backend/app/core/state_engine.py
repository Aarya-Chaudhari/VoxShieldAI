from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import create_engine, or_
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import DATABASE_URL
from app.core.risk_engine import compute_risk_score
from app.models.incident import (
    AuditEntry,
    Base,
    ConversationMessage,
    Evidence,
    Hypothesis,
    Incident,
    InvestigationTask,
    TimelineEvent,
)
from app.schemas.incident import InvestigationDecision


class StateEngine:
    def __init__(self, database_url: str = DATABASE_URL):
        self.engine = create_engine(database_url, connect_args={"check_same_thread": False}) if database_url.startswith("sqlite") else create_engine(database_url)
        self.session_factory = sessionmaker(bind=self.engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=self.engine)

    def _iso_now(self) -> str:
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    def _make_audit(self, incident_id: str, action: str, previous_value: str | None, new_value: str | None, reason: str, source_message_id: str | None = None) -> dict[str, Any]:
        return {
            "id": str(uuid4()),
            "incident_id": incident_id,
            "action": action,
            "previous_value": previous_value,
            "new_value": new_value,
            "reason": reason,
            "source_message_id": source_message_id,
            "timestamp": self._iso_now(),
        }

    def _seed_demo_incident(self) -> Incident:
        with Session(self.engine) as session:
            incident = session.query(Incident).first()
            if incident:
                return incident

            incident_id = "INC-2026-001"
            incident = Incident(
                id=incident_id,
                title="Suspicious admin access in early hours",
                description="Repeated failed logins against the admin account followed by a successful login and download activity.",
                severity="high",
                status="open",
                risk_score=68,
            )
            session.add(incident)
            session.commit()

            timeline = [
                TimelineEvent(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    event_time="2026-11-07T02:00:00Z",
                    description="Repeated login attempts against the admin account from an unfamiliar IP.",
                    event_type="authentication",
                    source="analyst",
                    confidence=0.82,
                    verification_status="REPORTED",
                    original_statement="We have repeated login attempts against the admin account from an unfamiliar IP around 2 AM.",
                ),
                TimelineEvent(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    event_time="2026-11-07T02:14:00Z",
                    description="Analyst reported that one login succeeded at 2:14 AM.",
                    event_type="authentication",
                    source="analyst",
                    confidence=0.8,
                    verification_status="REPORTED",
                    original_statement="One login succeeded at 2:14 AM.",
                ),
                TimelineEvent(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    event_time="2026-11-07T02:19:00Z",
                    description="An unusual file download was observed shortly after the successful login.",
                    event_type="data_access",
                    source="analyst",
                    confidence=0.7,
                    verification_status="REPORTED",
                    original_statement="There was an unusual file download at 2:19 AM, but we don't know what it contained.",
                ),
            ]
            session.add_all(timeline)

            evidence = [
                Evidence(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    title="Admin account targeted",
                    description="Repeated sign-in attempts to the admin account from an unfamiliar IP around 02:00Z.",
                    evidence_type="authentication",
                    status="REPORTED",
                    source="analyst",
                    linked_event_ids=json.dumps([timeline[0].id]),
                )
            ]
            session.add_all(evidence)

            tasks = [
                InvestigationTask(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    title="Verify authentication logs",
                    description="Confirm whether the successful login was valid and from which IP and device.",
                    priority="high",
                    status="pending",
                ),
                InvestigationTask(
                    id=str(uuid4()),
                    incident_id=incident_id,
                    title="Inspect the downloaded file",
                    description="Identify the downloaded file, its destination, and whether it was sensitive or classified.",
                    priority="high",
                    status="pending",
                ),
            ]
            session.add_all(tasks)
            session.commit()
            return incident

    def _get_or_seed_incident(self, session: Session) -> Incident:
        incident = session.query(Incident).first()
        if incident is None:
            self._seed_demo_incident()
            incident = session.query(Incident).first()
        if incident is None:
            raise RuntimeError("Unable to initialize the demo incident.")
        return incident

    def get_state(self) -> dict[str, Any]:
        with Session(self.engine) as session:
            incident = self._get_or_seed_incident(session)

            timeline = sorted([
                {
                    "id": item.id,
                    "event_time": item.event_time,
                    "description": item.description,
                    "event_type": item.event_type,
                    "source": item.source,
                    "confidence": item.confidence,
                    "verification_status": item.verification_status,
                    "original_statement": item.original_statement,
                }
                for item in incident.timeline
            ], key=lambda item: item["event_time"])
            evidence = [
                {
                    "id": item.id,
                    "title": item.title,
                    "description": item.description,
                    "evidence_type": item.evidence_type,
                    "status": item.status,
                    "source": item.source,
                    "linked_event_ids": json.loads(item.linked_event_ids) if item.linked_event_ids else [],
                }
                for item in incident.evidence
            ]
            hypotheses = [
                {
                    "id": item.id,
                    "title": item.title,
                    "explanation": item.explanation,
                    "confidence": item.confidence,
                    "supporting_facts": json.loads(item.supporting_facts) if item.supporting_facts else [],
                    "contradicting_facts": json.loads(item.contradicting_facts) if item.contradicting_facts else [],
                    "status": item.status,
                }
                for item in incident.hypotheses
            ]
            tasks = [
                {
                    "id": item.id,
                    "title": item.title,
                    "description": item.description,
                    "priority": item.priority,
                    "status": item.status,
                }
                for item in incident.tasks
            ]
            audit = [
                {
                    "id": item.id,
                    "action": item.action,
                    "previous_value": item.previous_value,
                    "new_value": item.new_value,
                    "reason": item.reason,
                    "source_message_id": item.source_message_id,
                    "timestamp": item.timestamp,
                }
                for item in incident.audit
            ]
            messages = [
                {"id": item.id, "speaker": item.speaker, "text": item.text, "timestamp": item.timestamp, "source": item.source}
                for item in incident.messages
            ]
            risk_text = " ".join(
                [incident.description]
                + [item["text"] for item in messages]
                + [item["description"] for item in timeline]
            )
            _, risk_factors, _ = compute_risk_score(risk_text)

            return {
                "id": incident.id,
                "title": incident.title,
                "description": incident.description,
                "severity": incident.severity,
                "status": incident.status,
                "risk_score": incident.risk_score,
                "created_at": incident.created_at.isoformat() if incident.created_at else self._iso_now(),
                "updated_at": incident.updated_at.isoformat() if incident.updated_at else self._iso_now(),
                "timeline": timeline,
                "evidence": evidence,
                "hypotheses": hypotheses,
                "tasks": tasks,
                "audit": audit,
                "messages": messages,
                "questions": [],
                "risk_factors": risk_factors,
                "connection": {"status": "unknown", "prisma": "unknown", "timbre": "unknown"},
            }

    def _add_audit(
        self,
        session: Session,
        incident_id: str,
        action: str,
        previous: str | None,
        new: str | None,
        reason: str,
        source_message_id: str | None = None,
    ) -> None:
        session.add(AuditEntry(
        id=str(uuid4()),
        incident_id=incident_id,
        action=action,
        previous_value=previous,
        new_value=new,
        reason=reason,
        source_message_id=source_message_id,
        timestamp=self._iso_now(),
        ))

    def apply_decision(self, decision: InvestigationDecision, transcript: str | None = None) -> dict[str, Any]:
        with Session(self.engine) as session:
            incident = self._get_or_seed_incident(session)

            source_message_id = None
            if transcript:
                source_message_id = str(uuid4())
                session.add(ConversationMessage(
                    id=source_message_id,
                    incident_id=incident.id,
                    speaker="analyst",
                    text=transcript,
                    timestamp=self._iso_now(),
                    source="voice",
                ))

            if decision.incident_title:
                previous = incident.title
                incident.title = decision.incident_title
                self._add_audit(session, incident.id, "incident.title", previous, incident.title, "Updated from the investigation decision.", source_message_id)

            if decision.incident_description:
                previous = incident.description
                incident.description = decision.incident_description
                self._add_audit(session, incident.id, "incident.description", previous, incident.description, "Updated from analyst context.", source_message_id)

            event_ids: list[str] = []
            for timeline_event in decision.timeline_events:
                duplicate = session.query(TimelineEvent).filter_by(
                    incident_id=incident.id,
                    original_statement=timeline_event.original_statement or timeline_event.description,
                ).first()
                if duplicate:
                    event_ids.append(duplicate.id)
                    continue
                event_id = str(uuid4())
                event = TimelineEvent(
                    id=event_id,
                    incident_id=incident.id,
                    event_time=timeline_event.time,
                    description=timeline_event.description,
                    event_type=timeline_event.event_type,
                    source=timeline_event.source,
                    confidence=timeline_event.confidence,
                    verification_status=timeline_event.verification_status,
                    original_statement=timeline_event.original_statement or timeline_event.description,
                )
                session.add(event)
                event_ids.append(event_id)
                self._add_audit(session, incident.id, "timeline.created", None, timeline_event.description, "Created from an analyst statement.", source_message_id)

            if decision.timeline_correction:
                target = session.query(TimelineEvent).filter(
                    TimelineEvent.incident_id == incident.id,
                    TimelineEvent.event_type == decision.timeline_correction.event_type,
                    or_(
                        TimelineEvent.description.ilike("%succeeded%"),
                        TimelineEvent.description.ilike("%successful%"),
                        TimelineEvent.original_statement.ilike("%succeeded%"),
                        TimelineEvent.original_statement.ilike("%successful%"),
                    ),
                ).order_by(TimelineEvent.created_at.desc()).first()
                if target is None:
                    decision.assistant_response = (
                        "I couldn't find a matching successful-login event to correct. "
                        "The original timeline has been left unchanged."
                    )
                else:
                    previous = target.event_time
                    target.event_time = decision.timeline_correction.corrected_time
                    self._add_audit(
                        session,
                        incident.id,
                        "timeline.corrected",
                        previous,
                        target.event_time,
                        decision.timeline_correction.reason,
                        source_message_id,
                    )

            for evidence_update in decision.evidence_updates:
                duplicate = session.query(Evidence).filter_by(
                    incident_id=incident.id,
                    title=evidence_update.title,
                ).first()
                if duplicate:
                    continue
                item = Evidence(
                    id=str(uuid4()),
                    incident_id=incident.id,
                    title=evidence_update.title,
                    description=evidence_update.description,
                    evidence_type=evidence_update.evidence_type,
                    status=evidence_update.status,
                    source=evidence_update.source,
                    linked_event_ids=json.dumps(event_ids),
                )
                session.add(item)
                self._add_audit(session, incident.id, "evidence.created", None, item.title, f"Recorded as {item.status}.", source_message_id)

            for hypothesis in decision.hypotheses:
                duplicate = session.query(Hypothesis).filter_by(
                    incident_id=incident.id,
                    title=hypothesis.title,
                ).first()
                if duplicate:
                    continue
                item = Hypothesis(
                    id=str(uuid4()),
                    incident_id=incident.id,
                    title=hypothesis.title,
                    explanation=hypothesis.explanation,
                    confidence=hypothesis.confidence,
                    supporting_facts=json.dumps(hypothesis.supporting_facts),
                    contradicting_facts=json.dumps(hypothesis.contradicting_facts),
                    status=hypothesis.status,
                )
                session.add(item)
                self._add_audit(session, incident.id, "hypothesis.created", None, item.title, f"Recorded as {item.status}.", source_message_id)

            for task in decision.tasks:
                duplicate = session.query(InvestigationTask).filter_by(
                    incident_id=incident.id,
                    title=task.title,
                ).first()
                if duplicate:
                    continue
                item = InvestigationTask(
                    id=str(uuid4()),
                    incident_id=incident.id,
                    title=task.title,
                    description=task.description,
                    priority=task.priority,
                    status=task.status,
                )
                session.add(item)
                self._add_audit(session, incident.id, "task.created", None, item.title, "Suggested by investigation analysis.", source_message_id)

            context = " ".join(
                [incident.description, transcript or ""]
                + [message.text for message in incident.messages]
                + [timeline_event.description for timeline_event in incident.timeline]
            )
            risk_score, _, severity = compute_risk_score(context)
            if incident.risk_score != risk_score:
                self._add_audit(session, incident.id, "incident.risk_score", str(incident.risk_score), str(risk_score), "Recomputed from incident context.", source_message_id)
            if incident.severity != severity:
                self._add_audit(session, incident.id, "incident.severity", incident.severity, severity, "Recomputed from incident context.", source_message_id)
            next_status = "investigating" if not decision.report_ready else "report-ready"
            if incident.status != next_status:
                self._add_audit(session, incident.id, "incident.status", incident.status, next_status, "Updated from investigation activity.", source_message_id)
            incident.risk_score = risk_score
            incident.severity = severity
            incident.updated_at = datetime.utcnow()
            incident.status = next_status
            if decision.assistant_response:
                session.add(ConversationMessage(
                    id=str(uuid4()),
                    incident_id=incident.id,
                    speaker="assistant",
                    text=decision.assistant_response,
                    timestamp=self._iso_now(),
                    source="assistant",
                ))

            session.commit()

            return self.get_state()

    def update_task(self, task_id: str, status: str | None = None, priority: str | None = None) -> dict[str, Any]:
        with Session(self.engine) as session:
            task = session.get(InvestigationTask, task_id)
            if task is None:
                raise KeyError("Investigation task not found.")
            if status is not None and task.status != status:
                previous = task.status
                task.status = status
                self._add_audit(session, task.incident_id, "task.status", previous, status, "Updated by an analyst.")
            if priority is not None and task.priority != priority:
                previous = task.priority
                task.priority = priority
                self._add_audit(session, task.incident_id, "task.priority", previous, priority, "Updated by an analyst.")
            session.commit()
        return self.get_state()

    def verify_evidence(self, evidence_id: str, status: str) -> dict[str, Any]:
        with Session(self.engine) as session:
            item = session.get(Evidence, evidence_id)
            if item is None:
                raise KeyError("Evidence item not found.")
            previous = item.status
            if previous != status:
                item.status = status
                self._add_audit(
                    session,
                    item.incident_id,
                    "evidence.status",
                    previous,
                    status,
                    "Evidence status explicitly changed by an analyst.",
                )
                session.commit()
        return self.get_state()

    def create_evidence(self, title: str, description: str, evidence_type: str, status: str) -> dict[str, Any]:
        with Session(self.engine) as session:
            incident = self._get_or_seed_incident(session)
            item = Evidence(
                id=str(uuid4()),
                incident_id=incident.id,
                title=title,
                description=description,
                evidence_type=evidence_type,
                status=status,
                source="analyst",
                linked_event_ids="[]",
            )
            session.add(item)
            self._add_audit(session, incident.id, "evidence.created", None, title, "Manually added by an analyst.")
            session.commit()
        return self.get_state()

    def update_timeline_event(
        self,
        event_id: str,
        event_time: str,
        description: str,
        reason: str,
    ) -> dict[str, Any]:
        with Session(self.engine) as session:
            event = session.get(TimelineEvent, event_id)
            if event is None:
                raise KeyError("Timeline event not found.")
            incident_id = event.incident_id
            source_message_id = str(uuid4())
            session.add(ConversationMessage(
                id=source_message_id,
                incident_id=incident_id,
                speaker="analyst",
                text=reason,
                timestamp=self._iso_now(),
                source="manual_correction",
            ))
            if event.event_time != event_time:
                previous = event.event_time
                event.event_time = event_time
                self._add_audit(session, incident_id, "timeline.time", previous, event_time, reason, source_message_id)
            if event.description != description:
                previous = event.description
                event.description = description
                self._add_audit(session, incident_id, "timeline.description", previous, description, reason, source_message_id)
            if event.original_statement is None:
                event.original_statement = description
            session.commit()
        return self.get_state()

    def generate_report(self) -> str:
        state = self.get_state()
        summary = [
            "# VOXSHIELD Investigation Report",
            "",
            f"- Incident: {state['title']}",
            f"- Severity: {state['severity']}",
            f"- Indicative risk score: {state['risk_score']}/100",
            f"- Status: {state['status']}",
            "",
            "## Timeline",
        ]
        for event in state["timeline"]:
            summary.append(f"- {event['event_time']} | {event['description']} | {event['verification_status']} | {event['source']}")

        confirmed = [item for item in state["evidence"] if item["status"] == "CONFIRMED"]
        reported = [item for item in state["evidence"] if item["status"] == "REPORTED"]
        unknown = [item for item in state["evidence"] if item["status"] == "UNKNOWN"]
        contradicted = [item for item in state["evidence"] if item["status"] == "CONTRADICTED"]
        summary.extend(["", "## Confirmed evidence"])
        summary.extend([f"- {item['title']}: {item['description']}" for item in confirmed] or ["- No evidence is currently marked CONFIRMED."])
        summary.extend(["", "## Analyst-reported evidence"])
        summary.extend([f"- {item['title']}: {item['description']}" for item in reported] or ["- None recorded."])
        summary.extend(["", "## Hypotheses"])
        summary.extend([
            f"- {item['title']} ({item['confidence']:.0%}, {item['status']}): {item['explanation']}"
            for item in state["hypotheses"]
        ] or ["- None recorded."])
        summary.extend(["", "## Unknown or missing evidence"])
        summary.extend([f"- {item['title']}: {item['description']}" for item in unknown] or ["- None explicitly recorded."])
        summary.extend(["", "## Contradicted evidence"])
        summary.extend([f"- {item['title']}: {item['description']}" for item in contradicted] or ["- None recorded."])
        summary.extend(["", "## Investigation tasks"])
        summary.extend([f"- {item['title']} ({item['priority']} / {item['status']})" for item in state["tasks"]] or ["- None recorded."])
        summary.extend(["", "## Analyst statements"])
        summary.extend([
            f"- {item['timestamp']} | {item['text']}"
            for item in state["messages"] if item["speaker"] == "analyst"
        ] or ["- None recorded."])
        audit_history = [
            f"- {item['timestamp']} | {item['action']} | {item['previous_value'] or '—'} → {item['new_value'] or '—'} | {item['reason']}"
            for item in state["audit"]
        ]
        summary.extend(["", "## Audit history", *(audit_history or ["- No changes recorded."])])
        return "\n".join(summary)
