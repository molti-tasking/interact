const STUDY_LOG_KEY = "jit-dsd-study-log";

interface StudyEvent {
  eventId: string;
  sessionId: string;
  timestamp: string;
  eventType: string;
  payload: Record<string, unknown>;
}

let sessionId: string | null = null;

function getSessionId(): string {
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  return sessionId;
}

function log(eventType: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;

  const event: StudyEvent = {
    eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: getSessionId(),
    timestamp: new Date().toISOString(),
    eventType,
    payload,
  };

  const existing = localStorage.getItem(STUDY_LOG_KEY) || "";
  const line = JSON.stringify(event);
  localStorage.setItem(STUDY_LOG_KEY, existing ? `${existing}\n${line}` : line);
}

function getLog(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(STUDY_LOG_KEY) || "";
}

function clearLog(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STUDY_LOG_KEY);
}

function downloadLog(): void {
  if (typeof window === "undefined") return;
  const data = getLog();
  const blob = new Blob([data], { type: "application/jsonl" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jit-dsd-study-${new Date().toISOString().slice(0, 10)}.jsonl`;
  a.click();
  URL.revokeObjectURL(url);
}

export const studyLogger = { log, getLog, clearLog, downloadLog };
