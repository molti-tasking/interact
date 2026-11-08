/**
 * Study mode (workshop sessions, migration 011): phases, settings and the
 * state the participant shell polls.
 */

export const STUDY_PHASES = [
  "lobby",
  "create",
  "answer",
  "review",
  "questionnaire",
  "done",
] as const;

export type StudyPhase = (typeof STUDY_PHASES)[number];

export function isStudyPhase(value: unknown): value is StudyPhase {
  return STUDY_PHASES.includes(value as StudyPhase);
}

/** The phase after `phase`, or null at the end. */
export function nextPhase(phase: StudyPhase): StudyPhase | null {
  const i = STUDY_PHASES.indexOf(phase);
  return STUDY_PHASES[i + 1] ?? null;
}

export function previousPhase(phase: StudyPhase): StudyPhase | null {
  const i = STUDY_PHASES.indexOf(phase);
  return i > 0 ? STUDY_PHASES[i - 1] : null;
}

interface PhaseCopy {
  /** Stepper label */
  label: string;
  /** "What to do now", shown in the participant's phase bar */
  instruction: string;
}

export const PHASE_COPY: Record<StudyPhase, PhaseCopy> = {
  lobby: {
    label: "Welcome",
    instruction: "Waiting for the facilitator to start the workshop.",
  },
  create: {
    label: "Create",
    instruction:
      "Create a form about your hobby — something you would like to ask other people.",
  },
  answer: {
    label: "Answer",
    instruction: "Fill in everyone else's forms as yourself. Answer honestly.",
  },
  review: {
    label: "Refine",
    instruction:
      "Read the answers to your form, then change the form wherever they show it could ask better.",
  },
  questionnaire: {
    label: "Reflect",
    instruction: "Tell us how it went — a short questionnaire.",
  },
  done: {
    label: "Done",
    instruction: "Thank you for taking part!",
  },
};

export interface StudySettings {
  /** Voice input (dictation, "Talk") — off by default in a shared room */
  allowVoice: boolean;
  /** Findings appear from this many responses (default app: 20) */
  findingsMinResponses: number;
  /**
   * Conditions assigned to panel participants (balanced, migration 013),
   * e.g. ["full", "no-probes"]. Empty: everyone gets the full tool.
   */
  conditions: StudyCondition[];
}

/**
 * - "full": the tool as is
 * - "no-probes": ablation without the design probe deck (no probes, no
 *   conflict checks); creating and editing the form works the same
 */
export const STUDY_CONDITIONS = ["full", "no-probes"] as const;
export type StudyCondition = (typeof STUDY_CONDITIONS)[number];

function isCondition(value: unknown): value is StudyCondition {
  return STUDY_CONDITIONS.includes(value as StudyCondition);
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  allowVoice: false,
  findingsMinResponses: 3,
  conditions: [],
};

/** Planned seconds per phase (soft deadline) */
export type PhaseDurations = Partial<Record<StudyPhase, number>>;

export const DEFAULT_PHASE_DURATIONS: PhaseDurations = {
  create: 900,
  answer: 1800,
  review: 900,
  questionnaire: 600,
};

export interface StudySession {
  id: string;
  name: string;
  join_code: string;
  space_id: string | null;
  phase: StudyPhase;
  phase_started_at: string;
  phase_ends_at: string | null;
  phase_durations: PhaseDurations;
  settings: StudySettings;
  created_at: string;
}

interface StudyParticipantSelf {
  id: string;
  display_name: string;
  portfolio_id: string | null;
  joined_at: string;
  /** Assigned condition (migration 013); null/absent = full tool */
  condition?: string | null;
  /** e.g. "prolific" when they joined from a panel link */
  external_source?: string | null;
}

/** `get_my_study_state()`: everything the participant shell needs */
export interface MyStudyState {
  session: Omit<StudySession, "space_id" | "created_at">;
  participant: StudyParticipantSelf;
  participant_count: number;
  /**
   * Panel participants, once the session is done: where to return
   * (migration 013 — the link carries the completion code, so it is never
   * sent earlier)
   */
  completion_url?: string | null;
  /** Server clock at the time of the poll (countdowns ignore client skew) */
  server_now: string;
}

export function parseSettings(value: unknown): StudySettings {
  const raw = (value ?? {}) as Partial<StudySettings>;
  return {
    allowVoice:
      typeof raw.allowVoice === "boolean"
        ? raw.allowVoice
        : DEFAULT_STUDY_SETTINGS.allowVoice,
    findingsMinResponses:
      typeof raw.findingsMinResponses === "number" && raw.findingsMinResponses > 0
        ? raw.findingsMinResponses
        : DEFAULT_STUDY_SETTINGS.findingsMinResponses,
    conditions: Array.isArray(raw.conditions)
      ? raw.conditions.filter(isCondition)
      : DEFAULT_STUDY_SETTINGS.conditions,
  };
}

/**
 * Only absolute https links: the URL is put in front of participants
 * (the database enforces the same).
 */
export function safeCompletionUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Panel parameters from a join link. Prolific appends
 * `PROLIFIC_PID`, `STUDY_ID` and `SESSION_ID`; null when the link has no
 * participant id.
 */
export function panelParams(
  params: { get(name: string): string | null },
): { source: "prolific"; externalId: string; studyId: string | null; sessionId: string | null } | null {
  const pid = params.get("PROLIFIC_PID")?.trim();
  if (!pid || !/^[A-Za-z0-9_-]{1,64}$/.test(pid)) return null;
  return {
    source: "prolific",
    externalId: pid,
    studyId: params.get("STUDY_ID")?.trim() || null,
    sessionId: params.get("SESSION_ID")?.trim() || null,
  };
}

/** A stable shuffle per participant: spreads order effects in the answer gallery. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const random = () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Seconds left until `endsAt`, using the server/client clock offset. */
export function secondsLeft(
  endsAt: string | null,
  clockOffsetMs: number,
  nowMs: number = Date.now(),
): number | null {
  if (!endsAt) return null;
  return Math.round((new Date(endsAt).getTime() - (nowMs + clockOffsetMs)) / 1000);
}

export function formatCountdown(seconds: number): string {
  const sign = seconds < 0 ? "−" : "";
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return `${sign}${m}:${s.toString().padStart(2, "0")}`;
}
