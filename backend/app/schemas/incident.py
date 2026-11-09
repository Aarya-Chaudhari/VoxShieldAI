from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class FactItem(BaseModel):
    text: str
    source: str = "analyst"
    confidence: float = Field(default=0.0, ge=0, le=1)
    status: Literal["CONFIRMED", "REPORTED", "HYPOTHESIS", "UNKNOWN", "CONTRADICTED"] = "REPORTED"


class TimelineEventInput(BaseModel):
    time: str
    description: str
    event_type: str
    source: str = "analyst"
    confidence: float = Field(default=0.5, ge=0, le=1)
    verification_status: Literal["CONFIRMED", "REPORTED", "HYPOTHESIS", "UNKNOWN", "CONTRADICTED"] = "REPORTED"
    original_statement: str | None = None


class EvidenceInput(BaseModel):
    title: str
    description: str
    evidence_type: str
    status: Literal["CONFIRMED", "REPORTED", "HYPOTHESIS", "UNKNOWN", "CONTRADICTED"] = "REPORTED"
    source: str = "analyst"


class HypothesisInput(BaseModel):
    title: str
    explanation: str
    confidence: float = Field(default=0.5, ge=0, le=1)
    supporting_facts: list[str] = Field(default_factory=list)
    contradicting_facts: list[str] = Field(default_factory=list)
    status: Literal["HYPOTHESIS", "REPORTED", "CONFIRMED", "CONTRADICTED", "UNKNOWN"] = "HYPOTHESIS"


class InvestigationTaskInput(BaseModel):
    title: str
    description: str
    priority: Literal["low", "medium", "high"] = "medium"
    status: Literal["pending", "completed"] = "pending"


class TimelineCorrection(BaseModel):
    event_type: str
    corrected_time: str
    reason: str


class ConversationTurn(BaseModel):
    speaker: str
    text: str
    timestamp: str
    source: str = "voice"


class InvestigationDecision(BaseModel):
    assistant_response: str = ""
    facts: list[FactItem] = Field(default_factory=list)
    timeline_events: list[TimelineEventInput] = Field(default_factory=list)
    hypotheses: list[HypothesisInput] = Field(default_factory=list)
    evidence_updates: list[EvidenceInput] = Field(default_factory=list)
    tasks: list[InvestigationTaskInput] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    severity_proposal: str | None = None
    risk_explanation: str = ""
    requires_confirmation: bool = False
    report_ready: bool = False
    incident_title: str | None = None
    incident_description: str | None = None
    timeline_correction: TimelineCorrection | None = None


class TaskUpdate(BaseModel):
    status: Literal["pending", "completed"] | None = None
    priority: Literal["low", "medium", "high"] | None = None


class EvidenceVerification(BaseModel):
    status: Literal["CONFIRMED", "REPORTED", "HYPOTHESIS", "UNKNOWN", "CONTRADICTED"]


class EvidenceCreate(BaseModel):
    title: str
    description: str
    evidence_type: str = "observation"
    status: Literal["REPORTED", "UNKNOWN"] = "REPORTED"


class TimelineEventUpdate(BaseModel):
    event_time: str
    description: str
    reason: str = Field(min_length=1, max_length=1000)


class IncidentState(BaseModel):
    id: str
    title: str
    description: str
    severity: str
    status: str
    risk_score: int
    created_at: str
    updated_at: str
    timeline: list[dict[str, Any]] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    hypotheses: list[dict[str, Any]] = Field(default_factory=list)
    tasks: list[dict[str, Any]] = Field(default_factory=list)
    audit: list[dict[str, Any]] = Field(default_factory=list)
    conversations: list[dict[str, Any]] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    risk_factors: list[str] = Field(default_factory=list)
    connection: dict[str, str] = Field(default_factory=dict)
