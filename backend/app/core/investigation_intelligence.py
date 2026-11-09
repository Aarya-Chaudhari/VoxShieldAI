from __future__ import annotations

import re
from typing import Any


def build_knowledge_graph(state: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    timeline = state.get("timeline", [])
    timeline_ids = {item["id"] for item in timeline}

    for event in timeline:
        nodes.append({
            "id": f"timeline:{event['id']}",
            "type": "timeline",
            "label": event["description"],
            "status": event["verification_status"],
            "source_references": [event["id"]],
            "source_text": event.get("original_statement") or event["description"],
            "confidence": event.get("confidence"),
        })

    entities: dict[str, set[str]] = {}
    for event in timeline:
        source_text = f"{event['description']} {event.get('original_statement') or ''}"
        for match in re.finditer(r"\b(?:admin(?:istrator)? account|[\w.-]+ account)\b", source_text, re.IGNORECASE):
            label = match.group(0)
            entity_id = f"entity:{label.casefold()}"
            entities.setdefault(entity_id, set()).add(event["id"])

    for entity_id, references in entities.items():
        label = entity_id.removeprefix("entity:")
        nodes.append({
            "id": entity_id,
            "type": "entity",
            "label": label,
            "status": "REPORTED",
            "source_references": sorted(references),
            "source_text": "Mentioned in the linked analyst timeline statement(s).",
            "confidence": None,
        })
        for event_id in sorted(references):
            edges.append({
                "id": f"{entity_id}->timeline:{event_id}",
                "source": entity_id,
                "target": f"timeline:{event_id}",
                "relationship": "mentioned in",
                "status": "REPORTED",
                "explanation": "The account name appears in the source timeline text.",
                "source_references": [event_id],
            })

    for item in state.get("evidence", []):
        evidence_id = f"evidence:{item['id']}"
        linked_ids = [event_id for event_id in item.get("linked_event_ids", []) if event_id in timeline_ids]
        nodes.append({
            "id": evidence_id,
            "type": "evidence",
            "label": item["title"],
            "status": item["status"],
            "source_references": [item["id"], *linked_ids],
            "source_text": item["description"],
            "confidence": None,
        })
        for event_id in linked_ids:
            edges.append({
                "id": f"{evidence_id}->timeline:{event_id}",
                "source": evidence_id,
                "target": f"timeline:{event_id}",
                "relationship": "linked to",
                "status": item["status"],
                "explanation": "This relationship uses the evidence item's persisted linked-event reference.",
                "source_references": [item["id"], event_id],
            })

    for hypothesis in state.get("hypotheses", []):
        hypothesis_id = f"hypothesis:{hypothesis['id']}"
        supporting_facts = hypothesis.get("supporting_facts", [])
        nodes.append({
            "id": hypothesis_id,
            "type": "hypothesis",
            "label": hypothesis["title"],
            "status": hypothesis["status"],
            "source_references": [hypothesis["id"]],
            "source_text": hypothesis["explanation"],
            "confidence": hypothesis.get("confidence"),
        })
        for fact in supporting_facts:
            if not isinstance(fact, str):
                continue
            for event in timeline:
                event_source = event.get("original_statement") or event["description"]
                if fact.strip().casefold() not in {
                    event_source.strip().casefold(),
                    event["description"].strip().casefold(),
                }:
                    continue
                edges.append({
                    "id": f"{hypothesis_id}->timeline:{event['id']}",
                    "source": hypothesis_id,
                    "target": f"timeline:{event['id']}",
                    "relationship": "supported by",
                    "status": "HYPOTHESIS",
                    "explanation": "The hypothesis explicitly lists this timeline statement as supporting context.",
                    "source_references": [hypothesis["id"], event["id"]],
                })

    for task in state.get("tasks", []):
        nodes.append({
            "id": f"task:{task['id']}",
            "type": "task",
            "label": task["title"],
            "status": task["status"],
            "source_references": [task["id"]],
            "source_text": task["description"],
            "confidence": None,
        })

    return {"nodes": nodes, "edges": edges}


def build_completeness(state: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    timeline = state.get("timeline", [])
    evidence = state.get("evidence", [])
    tasks = state.get("tasks", [])
    gaps: list[dict[str, Any]] = []

    def add_gap(
        title: str,
        question: str,
        rationale: str,
        priority: str,
        related_terms: tuple[str, ...],
    ) -> None:
        if any(
            evidence_item["status"] == "CONFIRMED"
            and any(term in f"{evidence_item['title']} {evidence_item['description']}".casefold() for term in related_terms)
            for evidence_item in evidence
        ):
            return
        existing_task = next(
            (
                task for task in tasks
                if task["status"] == "pending"
                and any(term in f"{task['title']} {task['description']}".casefold() for term in related_terms)
            ),
            None,
        )
        gaps.append({
            "id": re.sub(r"[^a-z0-9]+", "-", title.casefold()).strip("-"),
            "title": title,
            "question": question,
            "rationale": rationale,
            "priority": priority,
            "existing_task_id": existing_task["id"] if existing_task else None,
            "status": "OPEN",
        })

    has_authentication = any(
        event["event_type"] == "authentication"
        or any(term in event["description"].casefold() for term in ("login", "sign-in", "authentication"))
        for event in timeline
    )
    has_download = any(
        event["event_type"] == "data_access"
        or any(term in event["description"].casefold() for term in ("download", "file"))
        for event in timeline
    )
    all_text = " ".join(
        [state.get("description", "")]
        + [event["description"] for event in timeline]
        + [f"{item['title']} {item['description']}" for item in evidence]
    ).casefold()

    if has_authentication:
        add_gap(
            "Validate authentication records",
            "Which identity-provider or authentication log confirms the account, source IP, and outcome?",
            "The timeline contains authentication activity, but the available state has no confirmed authentication-log evidence.",
            "high",
            ("authentication", "login", "sign-in", "identity provider", "auth log"),
        )
        if not any(term in all_text for term in ("device", "endpoint", "workstation", "user agent")):
            add_gap(
                "Identify the login device",
                "Which device or session identifier was associated with the successful login?",
                "Device identity is not present in the persisted incident timeline or evidence.",
                "medium",
                ("device", "endpoint", "workstation", "user agent"),
            )
        if re.search(r"\badmin(?:istrator)? account\b", all_text) and not any(
            term in all_text for term in ("account owner", "owned by", "owner verified")
        ):
            add_gap(
                "Verify account ownership",
                "Who owns the targeted admin account, and has that ownership been independently verified?",
                "The incident references an admin account but does not record an independently verified owner.",
                "medium",
                ("account owner", "owned by", "owner verified"),
            )

    if has_download:
        add_gap(
            "Identify and classify the downloaded file",
            "What exact file was downloaded, where was it stored, and does it contain sensitive data?",
            "Download activity is in the timeline, but no confirmed file identification or classification is recorded.",
            "high",
            ("download", "file", "artifact", "data access"),
        )

    return {"gaps": gaps}


def analyze_what_if(question: str, state: dict[str, Any]) -> dict[str, Any]:
    lower = question.casefold()
    incident_references = [event["id"] for event in state.get("timeline", [])]

    if any(term in lower for term in ("legitimate", "authorized", "expected login")):
        impact = (
            "If the successful login was legitimate, that would reduce concern about that login being an account takeover. "
            "It would not by itself explain the earlier failed attempts or establish whether the later download was authorized."
        )
        checks = [
            "Confirm the account owner recognizes the time, device, and source IP.",
            "Independently identify and classify the downloaded file.",
        ]
    elif any(term in lower for term in ("not sensitive", "not confidential", "public file")):
        impact = (
            "If the downloaded file was not sensitive, the potential data-exposure impact would be lower. "
            "The download still needs attribution and authorization review, and the reported login remains a separate question."
        )
        checks = [
            "Verify the file hash, contents, and classification from an authoritative source.",
            "Confirm which account and session performed the download.",
        ]
    else:
        impact = (
            "This assumption is not represented as a fact in the incident. Assess how it would change the relevant event, "
            "but keep the existing reported and confirmed evidence unchanged."
        )
        checks = [
            "Identify the evidence that would confirm or disprove the assumption.",
            "Keep any conclusion conditional until that evidence is reviewed.",
        ]

    return {
        "scenario_only": True,
        "incident_state_changed": False,
        "assumption": question,
        "analysis": impact,
        "follow_up_checks": checks,
        "source_references": incident_references,
    }
