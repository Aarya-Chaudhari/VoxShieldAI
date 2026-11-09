export type VerificationStatus = 'CONFIRMED' | 'REPORTED' | 'HYPOTHESIS' | 'UNKNOWN' | 'CONTRADICTED';

export interface TimelineEvent {
  id: string;
  event_time: string;
  description: string;
  event_type: string;
  source: string;
  confidence: number;
  verification_status: VerificationStatus;
  original_statement?: string | null;
}

export interface EvidenceItem {
  id: string;
  title: string;
  description: string;
  evidence_type: string;
  status: VerificationStatus;
  source: string;
  linked_event_ids?: string[];
}

export interface Hypothesis {
  id: string;
  title: string;
  explanation: string;
  confidence: number;
  supporting_facts: string[];
  contradicting_facts: string[];
  status: VerificationStatus | 'HYPOTHESIS';
}

export interface TaskItem {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed';
}

export interface AuditEntry {
  id: string;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  reason: string | null;
  source_message_id: string | null;
  timestamp: string;
}

export interface ConversationMessage {
  id: string;
  speaker: 'analyst' | 'assistant';
  text: string;
  timestamp: string;
  source: string;
}

export interface IncidentState {
  id: string;
  title: string;
  description: string;
  severity: string;
  status: string;
  risk_score: number;
  created_at: string;
  updated_at: string;
  timeline: TimelineEvent[];
  evidence: EvidenceItem[];
  hypotheses: Hypothesis[];
  tasks: TaskItem[];
  audit: AuditEntry[];
  messages: ConversationMessage[];
  questions: string[];
  risk_factors: string[];
  connection: { status: string; prisma: string; timbre: string; investigation?: string };
}

export interface KnowledgeGraphNode {
  id: string;
  type: 'timeline' | 'entity' | 'evidence' | 'hypothesis' | 'task';
  label: string;
  status: string;
  source_references: string[];
  source_text: string;
  confidence: number | null;
}

export interface KnowledgeGraphEdge {
  id: string;
  source: string;
  target: string;
  relationship: string;
  status: string;
  explanation: string;
  source_references: string[];
}

export interface CompletenessGap {
  id: string;
  title: string;
  question: string;
  rationale: string;
  priority: 'low' | 'medium' | 'high';
  existing_task_id: string | null;
  status: string;
}

export interface WhatIfAnalysis {
  scenario_only: true;
  incident_state_changed: false;
  assumption: string;
  analysis: string;
  follow_up_checks: string[];
  source_references: string[];
}
