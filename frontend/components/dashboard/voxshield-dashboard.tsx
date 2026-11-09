"use client";

import {
  Activity, AlertTriangle, ArrowDownToLine, AudioLines, Bell, Check, CheckCircle2,
  ChevronDown, Circle, Clock3, FileText, Headphones, History, ListChecks, LoaderCircle,
  LockKeyhole, Mic, MicOff, Pause, Pencil, Plus, Radio, RefreshCw, Send, Shield,
  ShieldAlert, Sparkles, Volume2, VolumeX, X,
} from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  analyzeWhatIf, createEvidence, downloadReport, getHealth, getIncidentState, getInvestigationCompleteness,
  getInvestigationGraph, getReport, getVoiceWebSocketUrl, getWebSocketUrl, requestTTS, sendTranscript,
  transcribeAudio, updateEvidenceStatus, updateTask,
  updateTimelineEvent,
} from "@/lib/api";
import type {
  AuditEntry, CompletenessGap, EvidenceItem, Hypothesis, IncidentState, KnowledgeGraphEdge,
  KnowledgeGraphNode, TaskItem, TimelineEvent, VerificationStatus, WhatIfAnalysis,
} from "@/types/incident";

type ProviderStatus = { prisma: string; timbre: string; investigation: string };
type CopilotStatus = "ready" | "listening" | "processing" | "speaking";
type VoiceSessionState =
  | "IDLE"
  | "CONNECTING"
  | "LISTENING"
  | "PROCESSING"
  | "THINKING"
  | "SPEAKING"
  | "INTERRUPTED"
  | "RECONNECTING"
  | "ERROR";

const voiceSessionLabels: Record<VoiceSessionState, string> = {
  IDLE: "Conversation idle",
  CONNECTING: "Connecting microphone and Prisma…",
  LISTENING: "Listening · speak naturally",
  PROCESSING: "Prisma is finalizing the utterance…",
  THINKING: "Analyzing the finalized transcript…",
  SPEAKING: "Assistant is speaking",
  INTERRUPTED: "Assistant response interrupted",
  RECONNECTING: "Reconnecting voice session…",
  ERROR: "Voice session unavailable",
};

const verificationStyles: Record<VerificationStatus, string> = {
  CONFIRMED: "bg-emerald-400/10 text-emerald-300 ring-emerald-400/20",
  REPORTED: "bg-sky-400/10 text-sky-300 ring-sky-400/20",
  HYPOTHESIS: "bg-amber-400/10 text-amber-300 ring-amber-400/20",
  UNKNOWN: "bg-slate-400/10 text-slate-300 ring-slate-400/20",
  CONTRADICTED: "bg-rose-400/10 text-rose-300 ring-rose-400/20",
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function providerLabel(status: string) {
  if (status === "connected") return "CONNECTED";
  if (status === "not_configured") return "DEVELOPMENT MODE";
  if (status === "configured_not_verified") return "CONFIGURED · UNVERIFIED";
  if (status === "error") return "DISCONNECTED";
  return status.replaceAll("_", " ").toUpperCase();
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`inline-block h-2 w-2 rounded-full ${active ? "bg-emerald-400 shadow-[0_0_10px_#34d399]" : "bg-slate-500"}`} />;
}

function VerificationPill({ status }: { status: VerificationStatus }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold tracking-wide ring-1 ${verificationStyles[status]}`}>
      {status}
    </span>
  );
}

function graphStatusColor(status: string) {
  if (status === "CONFIRMED" || status === "completed") return "#34d399";
  if (status === "HYPOTHESIS") return "#fbbf24";
  if (status === "UNKNOWN" || status === "pending") return "#94a3b8";
  if (status === "CONTRADICTED") return "#fb7185";
  return "#67e8f9";
}

async function recordingToWav(recording: Blob) {
  const decoder = new AudioContext();
  const decoded = await decoder.decodeAudioData(await recording.arrayBuffer());
  await decoder.close();

  const sampleRate = 16000;
  const frameCount = Math.ceil(decoded.duration * sampleRate);
  const offline = new OfflineAudioContext(1, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const audio = await offline.startRendering();
  const pcm = audio.getChannelData(0);
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index]));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function VoxShieldDashboard() {
  const [incident, setIncident] = useState<IncidentState | null>(null);
  const [providerStatus, setProviderStatus] = useState<ProviderStatus>({
    prisma: "not_configured",
    timbre: "not_configured",
    investigation: "rules_based_development_fallback",
  });
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [copilotStatus, setCopilotStatus] = useState<CopilotStatus>("ready");
  const [voiceSessionState, setVoiceSessionState] = useState<VoiceSessionState>("IDLE");
  const [audioLevel, setAudioLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [userText, setUserText] = useState("");
  const [lastTranscript, setLastTranscript] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [reportContent, setReportContent] = useState("");
  const [graphData, setGraphData] = useState<{ nodes: KnowledgeGraphNode[]; edges: KnowledgeGraphEdge[] } | null>(null);
  const [completenessGaps, setCompletenessGaps] = useState<CompletenessGap[]>([]);
  const [whatIfQuestion, setWhatIfQuestion] = useState("");
  const [whatIfResult, setWhatIfResult] = useState<WhatIfAnalysis | null>(null);
  const [whatIfBusy, setWhatIfBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connecting to the investigation workspace");
  const [errorMessage, setErrorMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [addEvidenceOpen, setAddEvidenceOpen] = useState(false);
  const [evidenceTitle, setEvidenceTitle] = useState("");
  const [evidenceDescription, setEvidenceDescription] = useState("");
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [editTime, setEditTime] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editReason, setEditReason] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const voiceSessionActiveRef = useRef(false);
  const voiceReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const mutedRef = useRef(muted);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSpeechRef = useRef(false);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const microphoneSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const intentionalVoiceCloseRef = useRef(false);
  const seenVoiceSegmentsRef = useRef(new Set<string>());
  const voiceTranscriptQueueRef = useRef<string[]>([]);
  const processingVoiceQueueRef = useRef(false);
  const speakingRef = useRef(false);
  const interruptFramesRef = useRef(0);
  const lastWaveformUpdateRef = useRef(0);
  const playbackGenerationRef = useRef(0);
  const playbackCompletionRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
    if (audioRef.current) audioRef.current.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!incident) return;
    let disposed = false;
    void Promise.all([getInvestigationGraph(), getInvestigationCompleteness()])
      .then(([graph, completeness]) => {
        if (disposed) return;
        setGraphData(graph);
        setCompletenessGaps(completeness.gaps);
      })
      .catch((error) => {
        if (!disposed) setErrorMessage(error instanceof Error ? error.message : "Unable to load investigation intelligence.");
      });
    return () => { disposed = true; };
  }, [incident?.updated_at]);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;

    const loadWorkspace = async () => {
      try {
        const [state, health] = await Promise.all([getIncidentState(), getHealth()]);
        if (disposed) return;
        setIncident(state);
        setProviderStatus({ ...health.providers, investigation: health.investigation_engine });
        setStatusMessage("Incident state loaded");
      } catch (error) {
        if (!disposed) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to load the investigation workspace.");
          setStatusMessage("Backend unavailable");
        }
      }
    };

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(getWebSocketUrl());
      socketRef.current = socket;
      socket.onopen = () => {
        retryDelay = 1000;
        setConnectionStatus("connected");
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as { type?: string; payload?: unknown };
          if (message.type === "incident.updated" && message.payload && typeof message.payload === "object" && "id" in message.payload) {
            setIncident(message.payload as IncidentState);
          } else if (message.type === "assistant.response" && message.payload && typeof message.payload === "object" && "text" in message.payload) {
            setAssistantText(String(message.payload.text));
          } else if (message.type === "connection.status" && message.payload && typeof message.payload === "object") {
            const payload = message.payload as Partial<ProviderStatus> & { status?: string };
            if (payload.status) setConnectionStatus(payload.status);
            if (payload.prisma || payload.timbre) {
              setProviderStatus((current) => ({ ...current, ...payload }));
            }
          } else if (message.type === "error" && message.payload && typeof message.payload === "object" && "message" in message.payload) {
            setErrorMessage(String(message.payload.message));
          }
        } catch {
          setErrorMessage("Received an invalid message from the backend.");
        }
      };
      socket.onerror = () => setConnectionStatus("error");
      socket.onclose = () => {
        if (disposed) return;
        setConnectionStatus("reconnecting");
        reconnectTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 15000);
      };
    };

    void loadWorkspace();
    startupTimer = setTimeout(connect, 0);
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (startupTimer) clearTimeout(startupTimer);
      socketRef.current?.close();
      socketRef.current = null;
      intentionalVoiceCloseRef.current = true;
      voiceSessionActiveRef.current = false;
      if (voiceReconnectTimerRef.current) clearTimeout(voiceReconnectTimerRef.current);
      voiceReconnectTimerRef.current = null;
      voiceSocketRef.current?.close();
      voiceSocketRef.current = null;
      playbackGenerationRef.current += 1;
      speakingRef.current = false;
      audioRef.current?.pause();
      playbackCompletionRef.current?.();
      playbackCompletionRef.current = null;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      workletRef.current?.disconnect();
      microphoneSourceRef.current?.disconnect();
      silentGainRef.current?.disconnect();
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
    };
  }, []);

  const runAction = async (label: string, action: () => Promise<IncidentState>) => {
    setBusyAction(label);
    setErrorMessage("");
    try {
      setIncident(await action());
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusyAction("");
    }
  };

  const processTranscript = async (text: string) => {
    const transcript = text.trim();
    if (!transcript) return;
    setLastTranscript(transcript);
    setCopilotStatus("processing");
    setStatusMessage("Analyzing the analyst statement");
    setErrorMessage("");
    try {
      const result = await sendTranscript(transcript);
      setIncident(result.state);
      setAssistantText(result.decision.assistant_response);
      setStatusMessage("Investigation updated");
      if (result.decision.report_ready) void handleReportView();
      if (voiceSocketRef.current?.readyState === WebSocket.OPEN && result.decision.assistant_response.trim()) {
        await playAssistant(result.decision.assistant_response, true);
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to process the statement.");
      setStatusMessage("Statement was not recorded");
    } finally {
      const sessionActive = voiceSocketRef.current?.readyState === WebSocket.OPEN;
      setCopilotStatus(sessionActive ? "listening" : "ready");
      if (sessionActive) setVoiceSessionState("LISTENING");
    }
  };

  const processVoiceQueue = async () => {
    if (processingVoiceQueueRef.current) return;
    processingVoiceQueueRef.current = true;
    try {
      while (voiceTranscriptQueueRef.current.length > 0) {
        const transcript = voiceTranscriptQueueRef.current.shift();
        if (transcript) await processTranscript(transcript);
      }
    } finally {
      processingVoiceQueueRef.current = false;
      if (voiceTranscriptQueueRef.current.length > 0) void processVoiceQueue();
    }
  };

  const handleVoiceSocketMessage = (socket: WebSocket, event: MessageEvent) => {
    let message: {
      type?: string;
      state?: VoiceSessionState;
      text?: string;
      segment_id?: string | null;
      message?: string;
    };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      setErrorMessage("Received an invalid message from the Prisma streaming session.");
      return;
    }

    if (message.type === "session.ready") {
      setProviderStatus((current) => ({ ...current, prisma: "connected" }));
      setVoiceSessionState("LISTENING");
      setStatusMessage("Conversation active · speak naturally");
    } else if (message.type === "session.state" && message.state) {
      if (message.state === "PROCESSING") setVoiceSessionState("PROCESSING");
      else if (socket.readyState === WebSocket.OPEN && !processingVoiceQueueRef.current) {
        setVoiceSessionState("LISTENING");
      }
    } else if (message.type === "transcript.final" && message.text?.trim()) {
      const segmentId = message.segment_id;
      if (segmentId && seenVoiceSegmentsRef.current.has(segmentId)) return;
      if (segmentId) {
        seenVoiceSegmentsRef.current.add(segmentId);
        if (seenVoiceSegmentsRef.current.size > 1000) seenVoiceSegmentsRef.current.clear();
      }
      if (voiceTranscriptQueueRef.current.length >= 20) {
        setErrorMessage("Voice transcript queue is full. Pause speaking while the assistant processes earlier turns.");
        return;
      }
      voiceTranscriptQueueRef.current.push(message.text.trim());
      setLastTranscript(message.text.trim());
      setVoiceSessionState("THINKING");
      void processVoiceQueue();
    } else if (message.type === "session.error") {
      stopSpeaking();
      voiceSessionActiveRef.current = false;
      if (voiceReconnectTimerRef.current) clearTimeout(voiceReconnectTimerRef.current);
      voiceReconnectTimerRef.current = null;
      setErrorMessage(message.message || "Prisma voice session failed.");
      setProviderStatus((current) => ({ ...current, prisma: "error" }));
      setVoiceSessionState("ERROR");
      setListening(false);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      workletRef.current?.disconnect();
      workletRef.current = null;
      microphoneSourceRef.current?.disconnect();
      microphoneSourceRef.current = null;
      silentGainRef.current?.disconnect();
      silentGainRef.current = null;
      if (audioContextRef.current && audioContextRef.current.state !== "closed") {
        void audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
  };

  const connectVoiceSocket = (sampleRate: number, attempt = 0): Promise<void> => {
    const socket = new WebSocket(getVoiceWebSocketUrl());
    socket.binaryType = "arraybuffer";
    voiceSocketRef.current = socket;

    return new Promise<void>((resolve, reject) => {
      let ready = false;
      let retries = attempt;
      let stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;
      const timeout = setTimeout(() => {
        if (!ready) {
          reject(new Error("Timed out connecting to Prisma."));
          socket.close();
        }
      }, 15000);

      socket.onopen = () => socket.send(JSON.stringify({
        type: "start",
        language_code: "en-IN",
        sample_rate: sampleRate,
      }));
      socket.onmessage = (event) => {
        handleVoiceSocketMessage(socket, event);
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; message?: string };
          if (message.type === "session.ready" && !ready) {
            ready = true;
            clearTimeout(timeout);
            stableConnectionTimer = setTimeout(() => {
              retries = 0;
              stableConnectionTimer = null;
            }, 30000);
            resolve();
          } else if (message.type === "session.error" && !ready) {
            clearTimeout(timeout);
            reject(new Error(message.message || "Prisma could not start the voice session."));
          }
        } catch {
          clearTimeout(timeout);
          reject(new Error("Received an invalid Prisma session response."));
        }
      };
      socket.onerror = () => {
        if (!ready) {
          clearTimeout(timeout);
          reject(new Error("Unable to connect to the voice streaming endpoint."));
          socket.close();
        }
      };
      socket.onclose = () => {
        clearTimeout(timeout);
        if (stableConnectionTimer) clearTimeout(stableConnectionTimer);
        if (voiceSocketRef.current === socket) voiceSocketRef.current = null;
        if (!ready) reject(new Error("Prisma disconnected before the voice session was ready."));
        if (intentionalVoiceCloseRef.current || !voiceSessionActiveRef.current) return;

        if (retries >= 3) {
          voiceSessionActiveRef.current = false;
          setVoiceSessionState("ERROR");
          setListening(false);
          setStatusMessage("Voice reconnect attempts ended · use text input or restart the conversation");
          setErrorMessage("Prisma voice connection could not be restored after three attempts.");
          return;
        }

        const delay = 1000 * (2 ** retries);
        retries += 1;
        setVoiceSessionState("RECONNECTING");
        setStatusMessage(`Voice connection lost · reconnecting in ${Math.round(delay / 1000)}s`);
        voiceReconnectTimerRef.current = setTimeout(() => {
          voiceReconnectTimerRef.current = null;
          if (voiceSessionActiveRef.current) {
            void connectVoiceSocket(sampleRate, retries).catch(() => {
              if (voiceSessionActiveRef.current) {
                setStatusMessage("Voice reconnect failed · trying again");
              }
            });
          }
        }, delay);
      };
    });
  };

  const startConversation = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") {
      setErrorMessage("Continuous voice is not supported by this browser. Use typed updates or single-turn recording.");
      setVoiceSessionState("ERROR");
      return;
    }

    setVoiceSessionState("CONNECTING");
    setErrorMessage("");
    intentionalVoiceCloseRef.current = false;
    seenVoiceSegmentsRef.current.clear();
    voiceTranscriptQueueRef.current = [];

    let audioContext: AudioContext | null = null;
    let microphone: MediaStream | null = null;
    try {
      audioContext = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = audioContext;
      await audioContext.resume();
      await audioContext.audioWorklet.addModule("/pcm-capture-worklet.js");
      if (![8000, 16000, 44100, 48000].includes(audioContext.sampleRate)) {
        throw new Error(`Unsupported microphone sample rate: ${audioContext.sampleRate} Hz.`);
      }

      microphone = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: audioContext.sampleRate,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = microphone;
      voiceSessionActiveRef.current = true;
      await connectVoiceSocket(audioContext.sampleRate);

      const source = audioContext.createMediaStreamSource(microphone);
      const worklet = new AudioWorkletNode(audioContext, "pcm-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
      });
      const silentGain = audioContext.createGain();
      silentGain.gain.value = 0;
      worklet.port.onmessage = ({ data }: MessageEvent<{ frame: ArrayBuffer; rms: number }>) => {
        const activeSocket = voiceSocketRef.current;
        if (activeSocket?.readyState !== WebSocket.OPEN) return;
        if (activeSocket.bufferedAmount > 256 * 1024) {
          setErrorMessage("Voice audio is backing up on the network. End and restart the conversation.");
          setVoiceSessionState("ERROR");
          voiceSessionActiveRef.current = false;
          activeSocket.close();
          return;
        }
        activeSocket.send(data.frame);
        const now = performance.now();
        if (now - lastWaveformUpdateRef.current > 50) {
          lastWaveformUpdateRef.current = now;
          setAudioLevel(data.rms);
        }
        if (speakingRef.current && data.rms > 0.075) {
          interruptFramesRef.current += 1;
          if (interruptFramesRef.current >= 8) stopSpeaking(true);
        } else {
          interruptFramesRef.current = 0;
        }
      };
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(audioContext.destination);
      microphoneSourceRef.current = source;
      workletRef.current = worklet;
      silentGainRef.current = silentGain;
      setListening(true);
      setCopilotStatus("listening");
      setVoiceSessionState("LISTENING");
      setStatusMessage("Conversation active · speak naturally");
    } catch (error) {
      const cancelled = intentionalVoiceCloseRef.current;
      intentionalVoiceCloseRef.current = true;
      voiceSessionActiveRef.current = false;
      if (voiceReconnectTimerRef.current) clearTimeout(voiceReconnectTimerRef.current);
      voiceReconnectTimerRef.current = null;
      voiceSocketRef.current?.close();
      voiceSocketRef.current = null;
      microphone?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      workletRef.current?.disconnect();
      microphoneSourceRef.current?.disconnect();
      silentGainRef.current?.disconnect();
      if (audioContext && audioContext.state !== "closed") await audioContext.close();
      audioContextRef.current = null;
      setListening(false);
      if (cancelled) return;
      setVoiceSessionState("ERROR");
      setErrorMessage(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access or use typed updates."
        : error instanceof Error ? error.message : "Unable to start continuous voice.");
      setStatusMessage("Voice session unavailable · text and single-turn input remain available");
    }
  };

  const endConversation = () => {
    intentionalVoiceCloseRef.current = true;
    voiceSessionActiveRef.current = false;
    if (voiceReconnectTimerRef.current) clearTimeout(voiceReconnectTimerRef.current);
    voiceReconnectTimerRef.current = null;
    const socket = voiceSocketRef.current;
    voiceSocketRef.current = null;
    if (speakingRef.current || playbackCompletionRef.current) stopSpeaking();
    else playbackGenerationRef.current += 1;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop" }));
    }
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    workletRef.current?.disconnect();
    workletRef.current = null;
    microphoneSourceRef.current?.disconnect();
    microphoneSourceRef.current = null;
    silentGainRef.current?.disconnect();
    silentGainRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    setListening(false);
    setCopilotStatus("ready");
    setVoiceSessionState("IDLE");
    setStatusMessage("Conversation ended");
  };

  const handleSendText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const transcript = userText.trim();
    if (!transcript || copilotStatus === "processing") return;
    setUserText("");
    await processTranscript(transcript);
  };

  const handleRecordingStop = async () => {
    setListening(false);
    setCopilotStatus("processing");
    setStatusMessage("Preparing audio for Prisma");
    if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
    if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
    if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      void audioContextRef.current.close();
    }
    audioContextRef.current = null;
    const stream = streamRef.current;
    const recording = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || "audio/webm" });
    try {
      const wav = await recordingToWav(recording);
      const formData = new FormData();
      formData.append("file", wav, "analyst-recording.wav");
      const result = await transcribeAudio(formData);
      if (result.status !== "ok" || !result.transcript?.trim()) {
        setStatusMessage(result.message || "Prisma did not return a transcript.");
        return;
      }
      setProviderStatus((current) => ({ ...current, prisma: "connected" }));
      await processTranscript(result.transcript);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Audio transcription failed.");
      setStatusMessage("Voice input failed");
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      recorderRef.current = null;
      if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
      setListening(false);
      setCopilotStatus("ready");
    }
  };

  const handleVoiceRecord = async () => {
    if (listening) {
      recorderRef.current?.stop();
      setStatusMessage("Finishing recording");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErrorMessage("This browser does not support microphone recording. Use the text input instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => void handleRecordingStop();
      recorder.onerror = () => {
        setErrorMessage("Microphone recording failed. Check browser permissions and try again.");
        stream.getTracks().forEach((track) => track.stop());
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current);
        if (recordingTimeoutRef.current) clearTimeout(recordingTimeoutRef.current);
        setListening(false);
        setCopilotStatus("ready");
      };
      recorder.start();
      hasSpeechRef.current = false;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const detectTurnEnd = () => {
        if (recorder.state !== "recording") return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          energy += amplitude * amplitude;
        }
        const rms = Math.sqrt(energy / samples.length);
        if (rms > 0.025) {
          hasSpeechRef.current = true;
          if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
          silenceTimeoutRef.current = null;
        } else if (hasSpeechRef.current && !silenceTimeoutRef.current) {
          silenceTimeoutRef.current = setTimeout(() => {
            if (recorder.state === "recording") {
              setStatusMessage("Turn ended after a pause · finalizing transcript");
              recorder.stop();
            }
          }, 1600);
        }
        animationFrameRef.current = requestAnimationFrame(detectTurnEnd);
      };
      detectTurnEnd();
      recordingTimeoutRef.current = setTimeout(() => {
        if (recorder.state === "recording") {
          setStatusMessage("Maximum recording time reached · finalizing transcript");
          recorder.stop();
        }
      }, 27000);
      setListening(true);
      setCopilotStatus("listening");
      setStatusMessage("Listening · recording finishes after a pause or 27 seconds");
      setErrorMessage("");
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      const message = error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access or use the text input."
        : error instanceof Error ? error.message : "Microphone is unavailable.";
      setErrorMessage(message);
      setStatusMessage("Microphone unavailable");
      setCopilotStatus("ready");
    }
  };

  const playAssistant = async (text = assistantText, waitForEnd = false) => {
    if (!text) return;
    const generation = ++playbackGenerationRef.current;
    setErrorMessage("");
    setStatusMessage("Requesting Timbre speech");
    try {
      const result = await requestTTS(text);
      if (generation !== playbackGenerationRef.current
        || (waitForEnd && voiceSocketRef.current?.readyState !== WebSocket.OPEN)) return;
      if (result.status !== "ok" || !result.audio_base64) {
        setProviderStatus((current) => ({ ...current, timbre: "not_configured" }));
        setStatusMessage(result.message || "Speech playback is unavailable in development mode.");
        if (waitForEnd) setErrorMessage("Automatic speech is unavailable. Use Play assistant response after checking the Timbre connection.");
        return;
      }
      setProviderStatus((current) => ({ ...current, timbre: "connected" }));
      const audio = new Audio(`data:audio/wav;base64,${result.audio_base64}`);
      audio.muted = mutedRef.current;
      audioRef.current?.pause();
      audioRef.current = audio;
      speakingRef.current = true;
      interruptFramesRef.current = 0;
      setCopilotStatus("speaking");
      setVoiceSessionState("SPEAKING");
      const playbackEnded = waitForEnd
        ? new Promise<void>((resolve) => { playbackCompletionRef.current = resolve; })
        : null;
      const completePlayback = () => {
        if (generation !== playbackGenerationRef.current) return;
        speakingRef.current = false;
        audioRef.current = null;
        setCopilotStatus(voiceSocketRef.current?.readyState === WebSocket.OPEN ? "listening" : "ready");
        if (voiceSocketRef.current?.readyState === WebSocket.OPEN) setVoiceSessionState("LISTENING");
        setStatusMessage("Playback finished · listening");
        playbackCompletionRef.current?.();
        playbackCompletionRef.current = null;
      };
      audio.onended = completePlayback;
      audio.onerror = () => {
        setErrorMessage("The generated audio could not be played. Select Play assistant response to retry.");
        completePlayback();
      };
      await audio.play();
      if (generation !== playbackGenerationRef.current) return;
      setStatusMessage("Playing assistant response");
      if (playbackEnded) await playbackEnded;
    } catch (error) {
      if (generation !== playbackGenerationRef.current) return;
      speakingRef.current = false;
      playbackCompletionRef.current?.();
      playbackCompletionRef.current = null;
      setProviderStatus((current) => ({ ...current, timbre: "error" }));
      const blocked = error instanceof DOMException && error.name === "NotAllowedError";
      setErrorMessage(blocked
        ? "The browser blocked automatic speech. Select Play assistant response to enable or retry playback."
        : error instanceof Error ? error.message : "Timbre speech generation failed.");
      setCopilotStatus(voiceSocketRef.current?.readyState === WebSocket.OPEN ? "listening" : "ready");
      if (voiceSocketRef.current?.readyState === WebSocket.OPEN) setVoiceSessionState("LISTENING");
    }
  };

  const stopSpeaking = (interrupted = false) => {
    playbackGenerationRef.current += 1;
    speakingRef.current = false;
    audioRef.current?.pause();
    audioRef.current = null;
    playbackCompletionRef.current?.();
    playbackCompletionRef.current = null;
    const sessionActive = voiceSocketRef.current?.readyState === WebSocket.OPEN;
    setCopilotStatus(sessionActive ? "listening" : "ready");
    setVoiceSessionState(interrupted ? "INTERRUPTED" : sessionActive ? "LISTENING" : "IDLE");
    setStatusMessage(interrupted ? "Assistant speech interrupted · listening for your update" : "Playback stopped");
  };

  const handleReportDownload = async () => {
    setBusyAction("report");
    setErrorMessage("");
    try {
      const blob = await downloadReport();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "voxshield-investigation-report.md";
      link.click();
      URL.revokeObjectURL(url);
      setStatusMessage("Investigation report downloaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Report generation failed.");
    } finally {
      setBusyAction("");
    }
  };

  const handleWhatIf = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const question = whatIfQuestion.trim();
    if (!question || whatIfBusy) return;
    setWhatIfBusy(true);
    setErrorMessage("");
    try {
      setWhatIfResult(await analyzeWhatIf(question));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to analyze this scenario.");
    } finally {
      setWhatIfBusy(false);
    }
  };

  const handleReportView = async () => {
    setBusyAction("report-preview");
    setErrorMessage("");
    document.getElementById("reports")?.scrollIntoView({ behavior: "smooth", block: "start" });
    try {
      setReportContent(await getReport());
      setStatusMessage("Current investigation report loaded");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Report generation failed.");
    } finally {
      setBusyAction("");
    }
  };

  const handleAddEvidence = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!evidenceTitle.trim() || !evidenceDescription.trim()) return;
    setBusyAction("evidence");
    setErrorMessage("");
    try {
      setIncident(await createEvidence({
        title: evidenceTitle.trim(),
        description: evidenceDescription.trim(),
        evidence_type: "analyst_observation",
        status: "REPORTED",
      }));
      setEvidenceTitle("");
      setEvidenceDescription("");
      setAddEvidenceOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to add evidence.");
    } finally {
      setBusyAction("");
    }
  };

  const handleTimelineCorrection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingEvent || !editTime || !editReason.trim()) return;
    await runAction("timeline", () => updateTimelineEvent(editingEvent, {
      event_time: new Date(editTime).toISOString(),
      description: editDescription.trim(),
      reason: editReason.trim(),
    }));
    setEditingEvent(null);
  };

  const startTimelineCorrection = (event: TimelineEvent) => {
    setEditingEvent(event);
    setEditTime(localDateTime(event.event_time));
    setEditDescription(event.description);
    setEditReason("");
  };

  const state = incident;
  const confirmedCount = state?.evidence.filter((item) => item.status === "CONFIRMED").length ?? 0;
  const evidenceProgress = state?.evidence.length ? Math.round((confirmedCount / state.evidence.length) * 100) : 0;
  const latestActivity = state?.audit.slice(-3).reverse() ?? [];
  const graphNodesByType = (["timeline", "entity", "evidence", "hypothesis", "task"] as const).map((type) => ({
    type,
    nodes: graphData?.nodes.filter((node) => node.type === type) ?? [],
  }));
  const graphHeight = Math.max(240, ...graphNodesByType.map(({ nodes }) => 34 + nodes.length * 62));
  const graphPositions = new Map<string, { x: number; y: number }>();
  graphNodesByType.forEach(({ type, nodes }, column) => {
    nodes.forEach((node, index) => graphPositions.set(node.id, { x: 82 + column * 168, y: 30 + index * 62 }));
  });
  const connectionRows: { label: string; status: string; active: boolean }[] = [
    { label: "API / WebSocket", status: connectionStatus, active: connectionStatus === "connected" },
    { label: "Gnani Prisma", status: providerStatus.prisma, active: providerStatus.prisma === "connected" },
    { label: "Gnani Timbre", status: providerStatus.timbre, active: providerStatus.timbre === "connected" },
    { label: "Investigation engine", status: providerStatus.investigation, active: providerStatus.investigation === "connected" },
  ];

  return (
    <div className="min-h-screen bg-[#07101d] text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-[1800px]">
        <aside className="hidden w-[228px] shrink-0 border-r border-white/[0.06] bg-[#091321] px-4 py-6 lg:flex lg:flex-col">
          <a href="#overview" className="mb-9 flex items-center gap-3 px-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300 ring-1 ring-cyan-300/15">
              <Shield className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-[15px] font-semibold tracking-[0.12em]">VOXSHIELD</span>
              <span className="mt-0.5 block text-[10px] font-medium tracking-[0.18em] text-slate-500">SECURITY OPERATIONS</span>
            </span>
          </a>
          <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.16em] text-slate-500">WORKSPACE</p>
          <nav className="space-y-1">
            <a href="#overview" className="nav-link nav-link-active"><Activity size={17} /> Overview</a>
            <a href="#timeline" className="nav-link"><ShieldAlert size={17} /> Active incident</a>
            <a href="#audit" className="nav-link"><History size={17} /> Investigation history</a>
            <button type="button" onClick={() => void handleReportView()} className="nav-link w-full text-left"><FileText size={17} /> Reports</button>
            <a href="#settings" className="nav-link"><LockKeyhole size={17} /> Settings</a>
          </nav>
          <div className="mt-auto rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center justify-between text-xs font-medium text-slate-300">
              <span>Workspace health</span><StatusDot active={connectionStatus === "connected"} />
            </div>
            <div className="mt-2 text-[11px] leading-5 text-slate-500">
              {connectionStatus === "connected" ? "Backend is reachable" : `Backend ${connectionStatus}`}
            </div>
            <div className="mt-4 h-1 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${evidenceProgress}%` }} />
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-500">
              <span>Evidence verified</span><span>{evidenceProgress}%</span>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-9 lg:py-7">
          <header className="mb-7 flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-5">
            <div>
              <div className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                <span>Security operations</span><span>/</span><span className="text-slate-300">Investigation workspace</span>
              </div>
              <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Incident overview</h1>
              <p className="mt-1 text-xs text-slate-500">Live investigation workspace · {state?.id || "Loading incident"}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-3 py-2 text-[11px] text-slate-300">
                <StatusDot active={connectionStatus === "connected"} />
                API {connectionStatus === "connected" ? "connected" : connectionStatus}
              </div>
              <button
                type="button"
                onClick={() => setNotificationOpen((value) => !value)}
                aria-label="Toggle recent activity"
                className="relative rounded-xl border border-white/[0.08] bg-white/[0.025] p-2.5 text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
              >
                <Bell size={16} />
                {latestActivity.length > 0 && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-cyan-300" />}
              </button>
              <a href="#settings" aria-label="Workspace settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700/70 text-xs font-semibold text-slate-200 ring-1 ring-white/10">
                VS
              </a>
            </div>
          </header>

          {notificationOpen && (
            <div className="mb-5 rounded-2xl border border-white/[0.08] bg-[#0d1928] p-4">
              <div className="mb-3 flex items-center justify-between text-sm font-medium">
                Recent activity <button type="button" onClick={() => setNotificationOpen(false)} aria-label="Close activity" className="text-slate-500 hover:text-white"><X size={16} /></button>
              </div>
              {latestActivity.length ? latestActivity.map((item) => (
                <div key={item.id} className="border-t border-white/[0.06] py-2 text-xs text-slate-400">
                  <span className="text-slate-200">{item.action}</span> · {formatTimestamp(item.timestamp)}
                </div>
              )) : <p className="text-xs text-slate-500">No recent changes recorded.</p>}
            </div>
          )}

          {errorMessage && (
            <div role="alert" className="mb-5 flex items-start justify-between gap-4 rounded-xl border border-rose-400/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200">
              <span>{errorMessage}</span>
              <button type="button" onClick={() => setErrorMessage("")} aria-label="Dismiss error"><X size={16} /></button>
            </div>
          )}

          {!state ? (
            <section className="rounded-2xl border border-white/[0.07] bg-[#0d1928] p-8">
              <div className="flex items-center gap-3 text-sm text-slate-300">
                {connectionStatus === "connecting" ? <LoaderCircle className="animate-spin text-cyan-300" size={18} /> : <AlertTriangle className="text-amber-300" size={18} />}
                {errorMessage || "Loading incident state from the backend…"}
              </div>
              {connectionStatus !== "connected" && <button type="button" onClick={() => window.location.reload()} className="mt-4 text-xs text-cyan-300 hover:text-cyan-200">Retry connection</button>}
            </section>
          ) : (
            <>
              <section id="overview" className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div className="metric-card xl:col-span-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="metric-label">Active incident</p>
                      <h2 className="mt-2 text-lg font-semibold leading-snug">{state.title}</h2>
                      <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">{state.description}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase ${state.severity === "critical" ? "bg-rose-400/10 text-rose-300" : state.severity === "high" ? "bg-orange-400/10 text-orange-300" : "bg-amber-400/10 text-amber-300"}`}>
                      {state.severity}
                    </span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-white/[0.06] pt-3 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1.5"><Shield size={13} /> {state.id}</span>
                    <span className="inline-flex items-center gap-1.5"><Circle size={10} className="fill-cyan-300 text-cyan-300" /> {state.status}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock3 size={13} /> Updated {formatTimestamp(state.updated_at)}</span>
                  </div>
                </div>
                <div className="metric-card">
                  <div className="flex items-center justify-between"><p className="metric-label">Risk score</p><Activity size={16} className="text-cyan-300" /></div>
                  <div className="mt-3 flex items-end gap-2"><span className="text-3xl font-semibold tabular-nums">{state.risk_score}</span><span className="mb-1 text-xs text-slate-500">/ 100</span></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-amber-300" style={{ width: `${Math.min(state.risk_score, 100)}%` }} /></div>
                  <p className="mt-2 text-[10px] text-slate-500">Indicative prioritization · not a verified risk measure</p>
                </div>
                <div className="metric-card">
                  <div className="flex items-center justify-between"><p className="metric-label">Evidence verified</p><CheckCircle2 size={16} className="text-emerald-300" /></div>
                  <div className="mt-3 flex items-end gap-2"><span className="text-3xl font-semibold tabular-nums">{confirmedCount}</span><span className="mb-1 text-xs text-slate-500">of {state.evidence.length} items</span></div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400 transition-all" style={{ width: `${evidenceProgress}%` }} /></div>
                  <p className="mt-2 text-[10px] text-slate-500">Only explicit analyst verification counts</p>
                </div>
              </section>

              <section aria-label="Provider connectivity" className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-white/[0.06] bg-[#0a1523] px-4 py-3 text-[10px]">
                <span className="font-semibold tracking-wide text-slate-400">INTEGRATIONS</span>
                <span className="flex items-center gap-2 text-slate-300"><StatusDot active={connectionStatus === "connected"} /> Backend <b className="font-medium text-slate-400">{connectionStatus.toUpperCase()}</b></span>
                <span className="flex items-center gap-2 text-slate-300"><StatusDot active={providerStatus.prisma === "connected"} /> Prisma <b className={`font-medium ${providerStatus.prisma === "connected" ? "text-emerald-300" : "text-amber-300"}`}>{providerLabel(providerStatus.prisma)}</b></span>
                <span className="flex items-center gap-2 text-slate-300"><StatusDot active={providerStatus.timbre === "connected"} /> Timbre <b className={`font-medium ${providerStatus.timbre === "connected" ? "text-emerald-300" : "text-amber-300"}`}>{providerLabel(providerStatus.timbre)}</b></span>
                <span className="flex items-center gap-2 text-slate-300"><StatusDot active={providerStatus.investigation === "connected"} /> Analysis <b className="font-medium text-slate-400">{providerLabel(providerStatus.investigation)}</b></span>
              </section>

              <section className="mb-5 overflow-hidden rounded-2xl border border-cyan-300/15 bg-[radial-gradient(ellipse_at_75%_0%,rgba(14,116,144,0.12),transparent_55%),#0c1827]">
                <div className="grid gap-6 p-5 md:grid-cols-[1fr_auto] md:items-center md:p-7">
                  <div>
                    <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold tracking-[0.12em] text-cyan-200/80">
                      <AudioLines size={15} /> VOICE INVESTIGATION COPILOT
                      <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[9px] tracking-normal text-slate-400">
                        {providerStatus.prisma === "not_configured" ? "TEXT FALLBACK AVAILABLE" : "PRISMA"}
                      </span>
                    </div>
                    <h2 className="text-lg font-semibold">Talk through the incident</h2>
                    <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
                      Add an analyst statement. Updates are saved as reported unless an analyst explicitly verifies evidence.
                    </p>
                    <div className="mt-5 flex min-h-[52px] items-center gap-1.5" aria-hidden="true">
                      {Array.from({ length: 42 }, (_, index) => (
                        <span
                          key={index}
                          className={`wave-bar ${voiceSessionState === "LISTENING" || voiceSessionState === "SPEAKING" ? "wave-active" : ""}`}
                          style={{
                            height: `${voiceSessionState === "LISTENING"
                              ? 6 + Math.min(audioLevel * 450, 34) * (0.45 + ((index * 7) % 11) / 20)
                              : 8 + ((index * 17 + 11) % 28)}px`,
                            animationDelay: `${(index % 9) * 75}ms`,
                          }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
                      <span className={`h-1.5 w-1.5 rounded-full ${voiceSessionState === "PROCESSING" || voiceSessionState === "THINKING" || copilotStatus === "processing" ? "animate-pulse bg-amber-300" : voiceSessionState === "LISTENING" ? "animate-pulse bg-rose-400" : voiceSessionState === "ERROR" ? "bg-rose-400" : "bg-emerald-400"}`} />
                      {voiceSessionState !== "IDLE" ? voiceSessionLabels[voiceSessionState] : copilotStatus === "processing" ? "Processing the latest turn…" : copilotStatus === "speaking" ? "Assistant is speaking" : statusMessage}
                    </div>
                  </div>
                  <div className="flex flex-row items-center justify-center gap-2 md:flex-col">
                    <button
                      type="button"
                      onClick={() => listening ? endConversation() : void startConversation()}
                      disabled={voiceSessionState === "CONNECTING"}
                      aria-label={listening ? "End conversation" : "Start conversation"}
                      className={`flex min-h-[50px] items-center justify-center gap-2 rounded-2xl px-4 text-xs font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50 ${listening ? "bg-rose-500 text-white shadow-rose-950/50 hover:bg-rose-400" : "bg-cyan-300 text-[#06111f] shadow-cyan-950/30 hover:bg-cyan-200"}`}
                    >
                      {listening ? <MicOff size={18} /> : <Mic size={18} />}
                      {listening ? "End conversation" : voiceSessionState === "CONNECTING" ? "Connecting…" : "Start conversation"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleVoiceRecord()}
                      disabled={listening || voiceSessionState === "CONNECTING" || copilotStatus === "processing"}
                      className="rounded-xl border border-white/[0.08] px-3 py-2 text-[10px] text-slate-400 transition hover:border-cyan-300/20 hover:text-cyan-200 disabled:opacity-40"
                    >Record one turn (fallback)</button>
                    <button type="button" onClick={() => void playAssistant()} disabled={!assistantText || copilotStatus === "processing"} aria-label="Play assistant response" className="icon-control"><Volume2 size={17} /></button>
                    <button type="button" onClick={() => stopSpeaking()} disabled={copilotStatus !== "speaking"} aria-label="Interrupt assistant speech" className="icon-control disabled:opacity-40"><Pause size={17} /></button>
                    <button type="button" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute audio" : "Mute audio"} className="icon-control">
                      {muted ? <VolumeX size={17} /> : <Headphones size={17} />}
                    </button>
                  </div>
                </div>
                <div className="grid gap-4 border-t border-white/[0.06] px-5 py-4 md:grid-cols-2 md:px-7">
                  <div className="rounded-xl bg-black/15 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Mic size={12} /> Latest transcript</div>
                    <p className="text-xs leading-5 text-slate-300">{lastTranscript || "Your transcript will appear here after a voice or text turn."}</p>
                  </div>
                  <div className="rounded-xl bg-black/15 p-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500"><Sparkles size={12} /> Investigation response</div>
                    <p className="text-xs leading-5 text-slate-200">{assistantText || "The investigation assistant is ready for an analyst update."}</p>
                  </div>
                </div>
                <form onSubmit={handleSendText} className="flex flex-col gap-2 border-t border-white/[0.06] p-4 sm:flex-row sm:p-5 md:px-7">
                  <input
                    value={userText}
                    onChange={(event) => setUserText(event.target.value)}
                    disabled={copilotStatus === "processing"}
                    placeholder="Type an incident update or ask what to investigate next…"
                    aria-label="Incident update"
                    className="min-w-0 flex-1 rounded-xl border border-white/[0.08] bg-[#081321] px-4 py-3 text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-300/40"
                  />
                  <button type="submit" disabled={!userText.trim() || copilotStatus === "processing"} className="flex items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-xs font-semibold text-[#071321] transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-40">
                    {copilotStatus === "processing" ? <LoaderCircle className="animate-spin" size={15} /> : <Send size={14} />} Add update
                  </button>
                </form>
              </section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.8fr)]">
                <div className="space-y-5">
                  <section id="timeline" className="panel-card">
                    <div className="panel-heading">
                      <div><h2>Incident timeline</h2><p>Chronological sequence · reported facts remain unverified</p></div>
                      <span className="panel-count">{state.timeline.length} events</span>
                    </div>
                    {state.timeline.length ? (
                      <div className="mt-4 space-y-0">
                        {state.timeline.map((event: TimelineEvent, index) => (
                          <article key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                            {index < state.timeline.length - 1 && <span className="absolute bottom-0 left-[7px] top-3 w-px bg-slate-700/70" />}
                            <span className={`relative z-10 mt-1.5 h-[15px] w-[15px] shrink-0 rounded-full border-[3px] ${event.verification_status === "CONFIRMED" ? "border-emerald-400 bg-[#0d1928]" : "border-cyan-300/70 bg-[#0d1928]"}`} />
                            <div className="min-w-0 flex-1 rounded-xl border border-white/[0.055] bg-white/[0.018] p-3.5">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <h3 className="text-xs font-medium leading-5 text-slate-100">{event.description}</h3>
                                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
                                    <span>{formatTimestamp(event.event_time)}</span><span>Source: {event.source}</span>
                                    <span>{Math.round(event.confidence * 100)}% extraction confidence</span>
                                  </div>
                                </div>
                                <VerificationPill status={event.verification_status} />
                              </div>
                              <details className="mt-2 text-[10px]">
                                <summary className="cursor-pointer text-cyan-300/80 hover:text-cyan-200">Inspect source statement</summary>
                                <p className="mt-2 rounded-lg bg-black/20 p-2.5 leading-5 text-slate-400">{event.original_statement || "No source statement was saved for this event."}</p>
                              </details>
                              <button type="button" onClick={() => startTimelineCorrection(event)} className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-slate-500 transition hover:text-cyan-200"><Pencil size={11} /> Correct event</button>
                              {editingEvent?.id === event.id && (
                                <form onSubmit={handleTimelineCorrection} className="mt-3 grid gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3">
                                  <label className="text-[10px] text-slate-400">Event time<input type="datetime-local" value={editTime} onChange={(e) => setEditTime(e.target.value)} required className="mt-1 block w-full rounded-lg border border-white/10 bg-[#07101d] px-2.5 py-2 text-xs text-slate-200" /></label>
                                  <label className="text-[10px] text-slate-400">Description<input value={editDescription} onChange={(e) => setEditDescription(e.target.value)} required className="mt-1 block w-full rounded-lg border border-white/10 bg-[#07101d] px-2.5 py-2 text-xs text-slate-200" /></label>
                                  <label className="text-[10px] text-slate-400">Correction reason<input value={editReason} onChange={(e) => setEditReason(e.target.value)} required placeholder="Why is this being corrected?" className="mt-1 block w-full rounded-lg border border-white/10 bg-[#07101d] px-2.5 py-2 text-xs text-slate-200 placeholder:text-slate-600" /></label>
                                  <div className="flex justify-end gap-2">
                                    <button type="button" onClick={() => setEditingEvent(null)} className="rounded-lg px-3 py-2 text-[10px] text-slate-400 hover:bg-white/5">Cancel</button>
                                    <button type="submit" disabled={busyAction === "timeline"} className="rounded-lg bg-cyan-300 px-3 py-2 text-[10px] font-semibold text-slate-950 disabled:opacity-50">{busyAction === "timeline" ? "Saving…" : "Save correction"}</button>
                                  </div>
                                </form>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : <p className="empty-state">No timeline events have been recorded.</p>}
                  </section>

                  <section id="evidence" className="panel-card">
                    <div className="panel-heading">
                      <div><h2>Evidence locker</h2><p>Verification is a deliberate analyst action</p></div>
                      <button type="button" onClick={() => setAddEvidenceOpen((value) => !value)} className="subtle-button"><Plus size={14} /> Add evidence</button>
                    </div>
                    {addEvidenceOpen && (
                      <form onSubmit={handleAddEvidence} className="mt-4 grid gap-2 rounded-xl border border-white/[0.07] bg-black/10 p-3 sm:grid-cols-2">
                        <input value={evidenceTitle} onChange={(e) => setEvidenceTitle(e.target.value)} required placeholder="Evidence title" className="form-field" />
                        <input value={evidenceDescription} onChange={(e) => setEvidenceDescription(e.target.value)} required placeholder="Description or source" className="form-field" />
                        <div className="flex items-center justify-between sm:col-span-2">
                          <span className="text-[10px] text-slate-500">New observations are labeled REPORTED.</span>
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setAddEvidenceOpen(false)} className="subtle-button">Cancel</button>
                            <button type="submit" disabled={busyAction === "evidence"} className="subtle-button bg-cyan-300 text-slate-950 hover:bg-cyan-200">{busyAction === "evidence" ? "Saving…" : "Save evidence"}</button>
                          </div>
                        </div>
                      </form>
                    )}
                    {state.evidence.length ? (
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {state.evidence.map((item: EvidenceItem) => (
                          <article key={item.id} className="rounded-xl border border-white/[0.055] bg-white/[0.018] p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 gap-2.5">
                                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-700/35 text-slate-300"><FileText size={15} /></span>
                                <div className="min-w-0"><h3 className="text-xs font-medium text-slate-200">{item.title}</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">{item.description}</p></div>
                              </div>
                              <VerificationPill status={item.status} />
                            </div>
                            <div className="mt-3 flex items-center justify-between border-t border-white/[0.05] pt-2">
                              <span className="text-[10px] text-slate-600">{item.evidence_type} · {item.source}</span>
                              {item.status !== "CONFIRMED" && (
                                <button
                                  type="button"
                                  disabled={busyAction === `evidence-${item.id}`}
                                  onClick={() => void runAction(`evidence-${item.id}`, () => updateEvidenceStatus(item.id, "CONFIRMED"))}
                                  className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
                                ><Check size={12} /> Mark confirmed</button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : <p className="empty-state">No evidence has been added.</p>}
                  </section>

                  <section className="panel-card">
                    <div className="panel-heading"><div><h2>Working hypotheses</h2><p>Analytical possibilities · never auto-confirmed</p></div><Sparkles size={17} className="text-amber-300" /></div>
                    {state.hypotheses.length ? (
                      <div className="mt-4 space-y-2.5">
                        {state.hypotheses.map((item: Hypothesis) => (
                          <article key={item.id} className="rounded-xl border border-amber-300/10 bg-amber-300/[0.025] p-3.5">
                            <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-xs font-medium text-amber-100">{item.title}</h3><div className="flex items-center gap-2"><span className="text-[10px] text-slate-400">{Math.round(item.confidence * 100)}% confidence</span><VerificationPill status={item.status} /></div></div>
                            <p className="mt-2 text-[11px] leading-5 text-slate-400">{item.explanation}</p>
                            <div className="mt-3 grid gap-2 sm:grid-cols-2">
                              <div className="rounded-lg bg-emerald-400/[0.04] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-300/70">Supporting</div>{item.supporting_facts.length ? item.supporting_facts.map((fact, i) => <p key={i} className="mt-1 text-[10px] leading-4 text-slate-400">{fact}</p>) : <p className="mt-1 text-[10px] text-slate-600">None recorded</p>}</div>
                              <div className="rounded-lg bg-rose-400/[0.035] p-2.5"><div className="text-[9px] font-semibold uppercase tracking-wide text-rose-300/70">Contradicting</div>{item.contradicting_facts.length ? item.contradicting_facts.map((fact, i) => <p key={i} className="mt-1 text-[10px] leading-4 text-slate-400">{fact}</p>) : <p className="mt-1 text-[10px] text-slate-600">None recorded</p>}</div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : <p className="empty-state">No hypotheses recorded. Inferences from future updates will remain labeled HYPOTHESIS.</p>}
                  </section>
                </div>

                <div className="space-y-5">
                  <section id="tasks" className="panel-card">
                    <div className="panel-heading"><div><h2>Investigation tasks</h2><p>Next steps based on current gaps</p></div><ListChecks size={17} className="text-cyan-300" /></div>
                    {state.tasks.length ? (
                      <div className="mt-4 space-y-2">
                        {state.tasks.map((task: TaskItem) => (
                          <article key={task.id} className="rounded-xl border border-white/[0.055] bg-white/[0.018] p-3.5">
                            <div className="flex items-start gap-2.5">
                              <button type="button" aria-label={task.status === "completed" ? "Mark task pending" : "Mark task completed"} onClick={() => void runAction(`task-${task.id}`, () => updateTask(task, { status: task.status === "completed" ? "pending" : "completed" }))} className="mt-0.5 text-slate-500 hover:text-emerald-300">
                                {task.status === "completed" ? <CheckCircle2 size={17} className="text-emerald-300" /> : <Circle size={17} />}
                              </button>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className={`text-xs font-medium ${task.status === "completed" ? "text-slate-500 line-through" : "text-slate-200"}`}>{task.title}</h3>
                                  <select aria-label={`Priority for ${task.title}`} value={task.priority} onChange={(event) => void runAction(`task-${task.id}`, () => updateTask(task, { priority: event.target.value as TaskItem["priority"] }))} className={`rounded-md border-0 bg-slate-800/70 px-2 py-1 text-[9px] font-medium ${task.priority === "high" ? "text-rose-300" : task.priority === "medium" ? "text-amber-300" : "text-slate-400"}`}>
                                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                                  </select>
                                </div>
                                <p className="mt-1.5 text-[10px] leading-4 text-slate-500">{task.description}</p>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : <p className="empty-state">No investigation tasks are currently open.</p>}
                    <details className="mt-4 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-300">Investigation knowledge graph · {graphData?.nodes.length ?? 0} nodes</summary>
                      {graphData?.nodes.length ? (
                        <>
                          <div className="mt-3 overflow-x-auto rounded-lg bg-[#081321] p-2">
                            <svg viewBox={`0 0 850 ${graphHeight}`} role="img" aria-label="Incident knowledge graph" className="min-w-[760px] w-full">
                              {graphData.edges.map((edge) => {
                                const source = graphPositions.get(edge.source);
                                const target = graphPositions.get(edge.target);
                                if (!source || !target) return null;
                                return (
                                  <line key={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={graphStatusColor(edge.status)} strokeOpacity="0.45" strokeWidth="1.5">
                                    <title>{`${edge.relationship}: ${edge.explanation} Source references: ${edge.source_references.join(", ")}`}</title>
                                  </line>
                                );
                              })}
                              {graphNodesByType.flatMap(({ type, nodes }) => nodes.map((node) => {
                                const position = graphPositions.get(node.id);
                                if (!position) return null;
                                const color = graphStatusColor(node.status);
                                return (
                                  <g key={node.id}>
                                    <rect x={position.x - 72} y={position.y - 20} width="144" height="40" rx="8" fill="#101d2c" stroke={color} strokeOpacity="0.7" />
                                    <circle cx={position.x - 60} cy={position.y} r="4" fill={color} />
                                    <text x={position.x - 50} y={position.y - 2} fill="#e2e8f0" fontSize="9">{node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label}</text>
                                    <text x={position.x - 50} y={position.y + 11} fill="#8292a7" fontSize="7">{`${type} · ${node.status}`}</text>
                                    <title>{`${node.label} | ${type} | ${node.status} | Source: ${node.source_references.join(", ")}`}</title>
                                  </g>
                                );
                              }))}
                            </svg>
                          </div>
                          <p className="mt-2 text-[9px] text-slate-500">Relationships are shown only when supported by persisted event links, source text, or explicit hypothesis support.</p>
                          {graphData.edges.length > 0 && (
                            <div className="mt-3 space-y-1.5">
                              {graphData.edges.map((edge) => (
                                <p key={edge.id} className="text-[9px] leading-4 text-slate-500">
                                  <span className="text-slate-300">{edge.relationship}</span> · {edge.explanation} <span className="text-slate-600">Source: {edge.source_references.join(", ")}</span>
                                </p>
                              ))}
                            </div>
                          )}
                        </>
                      ) : <p className="mt-3 text-[10px] text-slate-500">Graph data is loading or no incident nodes are available.</p>}
                    </details>

                    <details className="mt-2 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-300">Investigation gaps · {completenessGaps.length} open</summary>
                      {completenessGaps.length ? (
                        <div className="mt-3 space-y-2">
                          {completenessGaps.map((gap) => (
                            <article key={gap.id} className="rounded-lg border border-white/[0.05] bg-white/[0.02] p-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <h3 className="text-[10px] font-medium text-slate-200">{gap.title}</h3>
                                <span className={`shrink-0 text-[9px] uppercase ${gap.priority === "high" ? "text-rose-300" : "text-amber-300"}`}>{gap.priority}</span>
                              </div>
                              <p className="mt-1 text-[10px] leading-4 text-cyan-100/80">{gap.question}</p>
                              <p className="mt-1 text-[9px] leading-4 text-slate-500">{gap.rationale}</p>
                              {gap.existing_task_id && <p className="mt-1 text-[9px] text-slate-600">Related open task already exists; no duplicate task was created.</p>}
                            </article>
                          ))}
                        </div>
                      ) : <p className="mt-3 text-[10px] text-slate-500">No gaps were identified by the current completeness checks.</p>}
                    </details>

                    <details className="mt-2 rounded-xl border border-white/[0.06] bg-black/10 p-3">
                      <summary className="cursor-pointer text-xs font-medium text-slate-300">What-if scenario analysis</summary>
                      <p className="mt-2 text-[9px] leading-4 text-slate-500">Scenario-only analysis. It does not update the incident, timeline, evidence, or tasks.</p>
                      <form onSubmit={handleWhatIf} className="mt-3 space-y-2">
                        <textarea
                          value={whatIfQuestion}
                          onChange={(event) => setWhatIfQuestion(event.target.value)}
                          maxLength={1000}
                          required
                          placeholder="What if the successful login was legitimate?"
                          aria-label="What-if scenario"
                          className="form-field min-h-16 resize-y"
                        />
                        <button type="submit" disabled={!whatIfQuestion.trim() || whatIfBusy} className="subtle-button disabled:opacity-40">
                          {whatIfBusy ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />} Analyze scenario
                        </button>
                      </form>
                      {whatIfResult && (
                        <div className="mt-3 rounded-lg border border-amber-300/10 bg-amber-300/[0.025] p-2.5">
                          <p className="text-[9px] font-semibold uppercase tracking-wide text-amber-200">Scenario only · actual incident unchanged</p>
                          <p className="mt-1 text-[10px] font-medium text-slate-200">{whatIfResult.assumption}</p>
                          <p className="mt-1 text-[10px] leading-4 text-slate-400">{whatIfResult.analysis}</p>
                          <ul className="mt-2 list-disc space-y-1 pl-4 text-[9px] leading-4 text-slate-500">
                            {whatIfResult.follow_up_checks.map((check) => <li key={check}>{check}</li>)}
                          </ul>
                          <p className="mt-2 text-[8px] text-slate-600">References: {whatIfResult.source_references.join(", ") || "No timeline references"}</p>
                        </div>
                      )}
                    </details>
                    <button type="button" onClick={() => { setUserText("What should we investigate next?"); document.querySelector<HTMLInputElement>('input[aria-label="Incident update"]')?.focus(); }} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.1] py-2.5 text-[10px] text-slate-500 transition hover:border-cyan-300/20 hover:text-cyan-200"><Sparkles size={12} /> Suggest next steps</button>
                  </section>

                  <section id="reports" className="panel-card">
                    <div className="panel-heading"><div><h2>Investigation report</h2><p>Generated from persisted incident state</p></div><FileText size={17} className="text-slate-400" /></div>
                    <p className="mt-3 text-[11px] leading-5 text-slate-500">Separates confirmed evidence, analyst reports, unknowns, hypotheses, open tasks, and corrections.</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" onClick={() => void handleReportView()} disabled={busyAction === "report-preview"} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.04] py-2.5 text-xs font-medium text-cyan-100 transition hover:border-cyan-300/30 disabled:opacity-50">
                        {busyAction === "report-preview" ? <LoaderCircle className="animate-spin" size={14} /> : <FileText size={14} />} View report
                      </button>
                      <button type="button" onClick={() => void handleReportDownload()} disabled={busyAction === "report"} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.025] py-2.5 text-xs font-medium text-slate-200 transition hover:border-cyan-300/20 hover:bg-cyan-300/[0.04] disabled:opacity-50">
                        {busyAction === "report" ? <LoaderCircle className="animate-spin" size={14} /> : <ArrowDownToLine size={14} />} Download
                      </button>
                    </div>
                    {reportContent ? (
                      <pre aria-label="Current investigation report" className="mt-4 max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/20 p-4 text-[11px] leading-5 text-slate-300">{reportContent}</pre>
                    ) : (
                      <p className="mt-3 text-[10px] text-slate-600">Select “View report” to read the current report here.</p>
                    )}
                  </section>

                  <section id="settings" className="panel-card">
                    <div className="panel-heading"><div><h2>Connection settings</h2><p>Live status from the backend</p></div><Radio size={17} className="text-slate-400" /></div>
                    <div className="mt-4 space-y-3">
                      {connectionRows.map(({ label, status, active }) => (
                        <div key={label} className="flex items-center justify-between gap-3 text-[10px]">
                          <span className="text-slate-400">{label}</span>
                          <span className={`flex items-center gap-2 ${active ? "text-emerald-300" : "text-amber-300"}`}><StatusDot active={active} />{providerLabel(status)}</span>
                        </div>
                      ))}
                    </div>
                    <p className="mt-4 border-t border-white/[0.06] pt-3 text-[9px] leading-4 text-slate-600">Provider status becomes CONNECTED only after a successful provider request. Development fallback is labeled and does not create simulated transcripts or audio.</p>
                  </section>
                </div>
              </div>
              <section id="audit" className="panel-card mt-5">
                <div className="panel-heading"><div><h2>Recent audit trail</h2><p>Latest 3 state changes with their source statements</p></div><History size={17} className="text-slate-400" /></div>
                {state.audit.length ? (
                  <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {[...state.audit].reverse().slice(0, 3).map((item: AuditEntry) => {
                      const source = state.messages.find((message) => message.id === item.source_message_id);
                      return (
                        <article key={item.id} className="rounded-xl border border-white/[0.055] bg-white/[0.018] p-3">
                          <div className="flex items-start justify-between gap-3"><h3 className="text-[11px] font-medium text-slate-200">{item.action.replaceAll(".", " ")}</h3><time className="shrink-0 text-[9px] text-slate-600">{formatTimestamp(item.timestamp)}</time></div>
                          <p className="mt-1.5 break-words text-[10px] leading-4 text-slate-500">{item.previous_value || "—"} <span className="px-1 text-slate-700">→</span> {item.new_value || "—"}</p>
                          {item.reason && <p className="mt-1 text-[10px] leading-4 text-slate-500">{item.reason}</p>}
                          {source && <details className="mt-2"><summary className="cursor-pointer text-[9px] text-cyan-300/70">View source transcript</summary><p className="mt-1 rounded-lg bg-black/20 p-2 text-[10px] leading-4 text-slate-400">{source.text}</p></details>}
                        </article>
                      );
                    })}
                  </div>
                ) : <p className="empty-state">No changes have been recorded in this session.</p>}
              </section>
            </>
          )}

          <footer className="mt-7 flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] pt-4 text-[9px] text-slate-600">
            <span>VOXSHIELD · Incident data is analyst-reported unless explicitly verified.</span>
            <span className="inline-flex items-center gap-1.5"><RefreshCw size={10} /> Live updates via WebSocket</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
