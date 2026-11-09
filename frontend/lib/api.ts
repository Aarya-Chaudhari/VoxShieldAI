import type {
  CompletenessGap, IncidentState, KnowledgeGraphEdge, KnowledgeGraphNode, TaskItem, TimelineEvent,
  VerificationStatus, WhatIfAnalysis,
} from "@/types/incident";

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000").replace(/\/$/, "");

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export function getWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  return url.toString();
}

export function getVoiceWebSocketUrl() {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/voice";
  return url.toString();
}

export function getIncidentState() {
  return requestJson<IncidentState>("/api/incident");
}

export function getInvestigationGraph() {
  return requestJson<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] }>("/api/investigation/graph");
}

export function getInvestigationCompleteness() {
  return requestJson<{ gaps: CompletenessGap[] }>("/api/investigation/completeness");
}

export function analyzeWhatIf(question: string) {
  return requestJson<WhatIfAnalysis>("/api/investigation/what-if", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

export function getHealth() {
  return requestJson<{
    status: string;
    providers: { prisma: string; timbre: string };
    investigation_engine: string;
  }>("/api/health");
}

export function sendTranscript(transcript: string) {
  return requestJson<{ decision: { assistant_response: string; report_ready: boolean }; state: IncidentState }>("/api/voice/transcript", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcript }),
  });
}

export function transcribeAudio(formData: FormData) {
  return requestJson<{ mode: string; status: string; transcript?: string; message?: string }>("/api/voice/stt", {
    method: "POST",
    body: formData,
  });
}

export function requestTTS(text: string) {
  return requestJson<{ mode: string; status: string; audio_base64: string; message?: string }>("/api/voice/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function updateTask(task: TaskItem, changes: { status?: TaskItem["status"]; priority?: TaskItem["priority"] }) {
  return requestJson<IncidentState>(`/api/tasks/${encodeURIComponent(task.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(changes),
  });
}

export function updateEvidenceStatus(id: string, status: VerificationStatus) {
  return requestJson<IncidentState>(`/api/evidence/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });
}

export function createEvidence(input: { title: string; description: string; evidence_type: string; status: "REPORTED" }) {
  return requestJson<IncidentState>("/api/evidence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateTimelineEvent(
  event: TimelineEvent,
  input: { event_time: string; description: string; reason: string },
) {
  return requestJson<IncidentState>(`/api/timeline/${encodeURIComponent(event.id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getReport() {
  const response = await fetch(`${API_BASE}/api/report`);
  if (!response.ok) {
    throw new Error(`Unable to generate report (${response.status} ${response.statusText})`);
  }
  return response.text();
}

export async function downloadReport() {
  const report = await getReport();
  return new Blob([report], { type: "text/markdown;charset=utf-8" });
}
