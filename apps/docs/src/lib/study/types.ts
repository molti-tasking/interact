import { llmFallbackFromEnv } from "../llm-fallback";

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
  /**
   * "workshop": a facilitator moves the room through the phases (011).
   * "briefs": self-paced, one form per fixed brief (014) — the panel study.
   */
  mode: StudyMode;
  /** Brief keys of a briefs session, in their canonical order */
  briefs: string[];
  /** Time limit per task in a briefs session, in seconds */
  taskSeconds: number;
  /** Shown on the consent page of a briefs session */
  contact: StudyContact;
  /**
   * What the session runs with: recorded by the server when a briefs
   * session is opened (migration 015 refuses to open one without it), and
   * part of every export. Never set from the browser.
   */
  run: StudyRunSettings | null;
  /**
   * Wave 2: every task starts from somebody else's finished form (015).
   * Null: participants start from nothing (wave 1).
   */
  handoff: StudyHandoff | null;
  /**
   * After each task: self-ratings, free recall and "why" items before the
   * quiz (migration 017). Every briefs session created from 2026-11-13 on;
   * absent (false) in sessions created before, which keep their steps.
   */
  postTaskMeasures: boolean;
}

/** How questions are chosen (`PROBE_STRATEGY`). */
export const QUESTION_STRATEGIES = ["committee", "prompted"] as const;
export type QuestionStrategy = (typeof QUESTION_STRATEGIES)[number];

export interface StudyRunSettings {
  /** `LLM_MODEL_NAME` */
  model: string;
  /**
   * `LLM_FAST_MODEL_NAME`: the model for classification-style calls (intent
   * sync, conflict checks). The same as `model` unless set.
   */
  fastModel: string;
  /** `PROBE_STRATEGY` */
  questionStrategy: QuestionStrategy;
  /** `PROBE_COMMITTEE_SIZE` */
  committeeSize: number;
  recordedAt: string;
  /**
   * Anthropic's API behind the gateway, for calls the gateway turns away
   * (rate limit, budget, overload; `lib/llm-fallback.ts`). Absent: none.
   */
  fallback?: { model: string; fastModel: string };
  /**
   * `PROBE_ORDER=omissions`: likely omissions are asked before contested
   * changes (`QuestionOrder`). Absent: the contested order of the first
   * version and the pilot.
   */
  questionOrder?: "omissions";
}

/**
 * - "portfolio": the form with its intent and decision trail
 * - "form": the same form, fields only
 */
export const START_KINDS = ["portfolio", "form"] as const;
export type StartKind = (typeof START_KINDS)[number];

export interface StudyHandoff {
  /** The wave-1 session the forms come from (for the researcher's picker) */
  sourceSessionId: string | null;
  /** Per brief of this session: the wave-1 forms tasks start from */
  sources: Record<string, string[]>;
  starts: StartKind[];
}

export const STUDY_MODES = ["workshop", "briefs"] as const;
export type StudyMode = (typeof STUDY_MODES)[number];

/** Who runs the study: named on the consent page. */
export interface StudyContact {
  name: string;
  email: string;
  institution: string;
}

export const EMPTY_CONTACT: StudyContact = { name: "", email: "", institution: "" };

/**
 * - "full": the tool as is
 * - "no-probes": ablation without the elicitation question deck (no probes, no
 *   conflict checks); creating and editing the form works the same
 * - "baseline": the "silent baseline" — no probes and no intent portfolio;
 *   one description, one generated form, then free-text change requests to
 *   the same model, which does what it is told and nothing more (and the
 *   same direct editing of fields as in "full")
 * - "assistant": a general-purpose chat assistant next to the same canvas —
 *   no probes, no intent portfolio; it builds and changes the form with
 *   patches and decides by itself whether to ask, suggest or just build
 *   (2026-11-13)
 */
export const STUDY_CONDITIONS = ["full", "no-probes", "baseline", "assistant"] as const;
export type StudyCondition = (typeof STUDY_CONDITIONS)[number];

/** How a condition is named on the session page and in the docs. */
export function conditionLabel(condition: string | null | undefined): string {
  if (!condition || condition === "full") return "full";
  if (condition === "baseline") return "silent baseline";
  return condition;
}

function isCondition(value: unknown): value is StudyCondition {
  return STUDY_CONDITIONS.includes(value as StudyCondition);
}

export const DEFAULT_STUDY_SETTINGS: StudySettings = {
  allowVoice: false,
  findingsMinResponses: 3,
  conditions: [],
  mode: "workshop",
  briefs: [],
  taskSeconds: 720,
  contact: EMPTY_CONTACT,
  run: null,
  handoff: null,
  postTaskMeasures: false,
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

/** A participant's place in a briefs session (migration 014) */
export interface StudyProgress {
  step: string;
  step_started_at: string;
  outcome: "completed" | "declined" | null;
}

/** One brief of a participant, in their order */
export interface StudyTask {
  position: number;
  brief: string;
  portfolio_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  /** Wave 2: what the task's form started as; null/absent: from nothing */
  start_kind?: StartKind | null;
}

/** `get_my_study_state()`: everything the participant shell needs */
export interface MyStudyState {
  session: Omit<StudySession, "space_id" | "created_at">;
  participant: StudyParticipantSelf;
  /** Briefs sessions only */
  progress?: StudyProgress | null;
  tasks?: StudyTask[];
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
    mode: raw.mode === "briefs" ? "briefs" : "workshop",
    briefs: Array.isArray(raw.briefs)
      ? raw.briefs.filter((b): b is string => typeof b === "string" && !!b)
      : DEFAULT_STUDY_SETTINGS.briefs,
    taskSeconds:
      typeof raw.taskSeconds === "number" && raw.taskSeconds >= 60
        ? Math.round(raw.taskSeconds)
        : DEFAULT_STUDY_SETTINGS.taskSeconds,
    contact: {
      name: typeof raw.contact?.name === "string" ? raw.contact.name : "",
      email: typeof raw.contact?.email === "string" ? raw.contact.email : "",
      institution:
        typeof raw.contact?.institution === "string" ? raw.contact.institution : "",
    },
    run: parseRunSettings(raw.run),
    handoff: parseHandoff(raw.handoff),
    postTaskMeasures: raw.postTaskMeasures === true,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRunSettings(value: unknown): StudyRunSettings | null {
  const raw = (value ?? null) as Partial<StudyRunSettings> | null;
  if (!raw || typeof raw !== "object") return null;
  const size = Number(raw.committeeSize);
  if (
    typeof raw.model !== "string" ||
    !raw.model.trim() ||
    !QUESTION_STRATEGIES.includes(raw.questionStrategy as QuestionStrategy) ||
    !Number.isInteger(size) ||
    size < 1
  ) {
    return null;
  }
  return {
    model: raw.model.trim(),
    fastModel:
      typeof raw.fastModel === "string" && raw.fastModel.trim()
        ? raw.fastModel.trim()
        : raw.model.trim(),
    questionStrategy: raw.questionStrategy as QuestionStrategy,
    committeeSize: size,
    recordedAt: typeof raw.recordedAt === "string" ? raw.recordedAt : "",
    ...(raw.fallback &&
    typeof raw.fallback.model === "string" &&
    typeof raw.fallback.fastModel === "string"
      ? { fallback: { model: raw.fallback.model, fastModel: raw.fallback.fastModel } }
      : {}),
    ...(raw.questionOrder === "omissions" ? { questionOrder: "omissions" as const } : {}),
  };
}

export function parseHandoff(value: unknown): StudyHandoff | null {
  const raw = (value ?? null) as Partial<StudyHandoff> | null;
  if (!raw || typeof raw !== "object" || !raw.sources || typeof raw.sources !== "object") {
    return null;
  }
  const sources: Record<string, string[]> = {};
  for (const [brief, ids] of Object.entries(raw.sources)) {
    if (!Array.isArray(ids)) continue;
    const valid = [...new Set(ids.filter((id): id is string => typeof id === "string" && UUID.test(id)))];
    if (valid.length) sources[brief] = valid;
  }
  const starts = Array.isArray(raw.starts)
    ? START_KINDS.filter((kind) => raw.starts!.includes(kind))
    : [];
  return {
    sourceSessionId:
      typeof raw.sourceSessionId === "string" && UUID.test(raw.sourceSessionId)
        ? raw.sourceSessionId
        : null,
    sources,
    starts: starts.length ? starts : [...START_KINDS],
  };
}

/**
 * The run settings a server would record, from its environment — or what
 * is missing. All three must be set explicitly: a default that changes with
 * a deployment is not something a study can report.
 */
export function runSettingsFromEnv(
  env: Record<string, string | undefined>,
  now: Date = new Date(),
): { run: StudyRunSettings; missing: [] } | { run: null; missing: string[] } {
  const model = env.LLM_MODEL_NAME?.trim() ?? "";
  const strategy = env.PROBE_STRATEGY?.trim() ?? "";
  const size = env.PROBE_COMMITTEE_SIZE?.trim() ?? "";
  const missing = [
    (!model || model === "default") && "LLM_MODEL_NAME",
    !QUESTION_STRATEGIES.includes(strategy as QuestionStrategy) &&
      "PROBE_STRATEGY (committee or prompted)",
    !/^[2-6]$/.test(size) && "PROBE_COMMITTEE_SIZE (2 to 6)",
  ].filter((name): name is string => !!name);
  if (missing.length) return { run: null, missing };
  const { fallback } = llmFallbackFromEnv(env);
  return {
    run: {
      model,
      fastModel: env.LLM_FAST_MODEL_NAME?.trim() || model,
      questionStrategy: strategy as QuestionStrategy,
      committeeSize: Number(size),
      recordedAt: now.toISOString(),
      ...(fallback ? { fallback } : {}),
      ...(env.PROBE_ORDER?.trim() === "omissions" ? { questionOrder: "omissions" as const } : {}),
    },
    missing: [],
  };
}

// ---------------------------------------------------------------------------
// Briefs sessions: steps
// ---------------------------------------------------------------------------

/** The steps after a task, before its quiz, in sessions with post-task measures */
export const POST_TASK_STEPS = ["ratings", "recall", "why"] as const;
export type PostTaskStep = (typeof POST_TASK_STEPS)[number];

/**
 * The steps of a briefs session with `tasks` tasks — the same list as
 * `study_steps()` in migration 017, which is the one that decides.
 */
export function briefSteps(tasks: number, postTaskMeasures = false): string[] {
  const steps = ["consent", "intro"];
  for (let i = 1; i <= tasks; i++) {
    steps.push(`brief:${i}`, `task:${i}`);
    if (postTaskMeasures) steps.push(...POST_TASK_STEPS.map((step) => `${step}:${i}`));
    steps.push(`quiz:${i}`);
  }
  return [...steps, "questionnaire", "done"];
}

/**
 * What the consent page says a briefs session takes, in minutes: the tasks'
 * time limits, plus consent, intro, situations and the questionnaire
 * (11 minutes), plus, in sessions with post-task measures, about 5.5
 * minutes per task for ratings (0.5), recall (2), the "why" items (2) and
 * the quiz (1). Sessions created before keep the figure they showed (the
 * runbook has the breakdown).
 */
export function studyMinutes(
  settings: Pick<StudySettings, "taskSeconds" | "postTaskMeasures">,
  tasks: number,
): number {
  const perTask = settings.taskSeconds / 60 + (settings.postTaskMeasures ? 5.5 : 0);
  return Math.round(perTask * tasks + 11);
}

type PositionedStep = "brief" | "task" | PostTaskStep | "quiz";

export type BriefStep =
  | { kind: "consent" | "intro" | "questionnaire" | "done" }
  | { kind: PositionedStep; position: number };

export function parseBriefStep(step: string): BriefStep | null {
  if (step === "consent" || step === "intro" || step === "questionnaire" || step === "done") {
    return { kind: step };
  }
  const match = /^(brief|task|ratings|recall|why|quiz):(\d+)$/.exec(step);
  if (!match) return null;
  return { kind: match[1] as PositionedStep, position: Number(match[2]) };
}

/** The briefs in the order a participant with `order` gets them (Latin square). */
export function briefOrder(briefs: readonly string[], order: number): string[] {
  return briefs.map((_, i) => briefs[(i + order) % briefs.length]);
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
