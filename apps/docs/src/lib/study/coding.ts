/**
 * Analysis files for a briefs session (the panel study).
 *
 * The primary measure is the share of a brief's requirement list that a
 * participant's final form covers, coded by two raters who don't know the
 * condition. So the export is split:
 *
 *   for the raters   coding-forms.md, coding-requirements.csv, coding-fields.csv
 *                    — forms under a code, no participant, no condition
 *   for the analyst  coding-key.csv (code → participant, condition, timings),
 *                    participants.csv (questionnaire, quiz)
 *
 * Form codes are a hash of the task id: the same form keeps its code across
 * exports, and sorting by code mixes the conditions.
 */

import type { StudyExport } from "@/hooks/query/study";
import {
  pairwiseOverlaps,
  summarizeDiversity,
  type FormFields,
} from "interact/forms/form-diversity";
import type { BriefDefinition } from "./briefs.server";
import { parseCsv, toCsv } from "./export";
import { briefSteps, parseRunSettings, parseSettings, type StudyRunSettings } from "./types";
import {
  ATTENTION_ITEM,
  BRIEFS_INSTRUMENT,
  BRIEFS_QUESTIONNAIRE,
  ncs6Score,
  quizInstrument,
  quizScore,
  ratingsInstrument,
  recallInstrument,
  susScore,
  whyInstrument,
  type QuizAnswer,
  type QuizItem,
} from "./instruments";
import type { WhyItem } from "./why-fields";

interface CodedField {
  /** The field's key (its name in the schema) */
  key: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
}

export interface CodedForm {
  code: string;
  taskId: string;
  participantId: string;
  portfolioId: string | null;
  position: number;
  brief: string;
  /** The creator's first description, verbatim */
  firstPrompt: string;
  fields: CodedField[];
}

/** FNV-1a → six base-36 characters */
export function formCode(taskId: string): string {
  let h = 2166136261;
  for (let i = 0; i < taskId.length; i++) {
    h ^= taskId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, "0").slice(-6);
}

interface RawField {
  name?: string;
  label?: string;
  required?: boolean;
  description?: string;
  type?: {
    kind?: string;
    multiple?: boolean;
    options?: { label?: string }[];
    min?: number;
    max?: number;
  };
}

function describeType(type: RawField["type"]): string {
  if (!type?.kind) return "";
  if (type.kind === "select") {
    const options = (type.options ?? []).map((o) => o.label ?? "").join(" | ");
    return `${type.multiple ? "choose several" : "choose one"}: ${options}`;
  }
  if (type.kind === "scale") return `scale ${type.min ?? ""}–${type.max ?? ""}`;
  return type.kind;
}

function fieldsOf(schema: unknown): CodedField[] {
  const fields = (schema as { fields?: RawField[] } | null)?.fields ?? [];
  return fields.map((f) => ({
    key: f.name ?? f.label ?? "",
    label: f.label ?? "",
    type: describeType(f.type),
    required: !!f.required,
    description: f.description ?? "",
  }));
}

/**
 * Every finished task as a form to code, sorted by code. The form is the
 * snapshot taken when the task ended (the stored form may have changed
 * since); the first prompt is the logged `first_prompt` of that form.
 */
export function codedForms(data: StudyExport): CodedForm[] {
  const completed = new Set(
    data.progress.filter((p) => p.outcome === "completed").map((p) => p.participant_id),
  );
  return data.tasks
    .filter((t) => t.finished_at && completed.has(t.participant_id))
    .map((task): CodedForm => {
      const snapshot = data.snapshots.find(
        (s) =>
          s.participant_id === task.participant_id &&
          s.label === `task:${task.position}:${task.brief}`,
      );
      const portfolio = data.portfolios.find((p) => p.id === task.portfolio_id);
      const prompt = data.events.find(
        (e) => e.type === "first_prompt" && e.portfolio_id === task.portfolio_id,
      );
      return {
        code: formCode(task.id),
        taskId: task.id,
        participantId: task.participant_id,
        portfolioId: task.portfolio_id,
        position: task.position,
        brief: task.brief,
        firstPrompt: String((prompt?.payload as { text?: unknown } | null)?.text ?? ""),
        fields: fieldsOf(snapshot?.schema ?? portfolio?.schema),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

type Briefs = Record<string, BriefDefinition>;

/** For the raters: every form with its first description, under its code. */
export function codingFormsMarkdown(data: StudyExport, briefs: Briefs): string {
  const forms = codedForms(data);
  const parts = [
    "# Forms to code",
    "",
    `${forms.length} forms. Code each one in coding-requirements.csv and coding-fields.csv.`,
    "",
  ];
  for (const form of forms) {
    const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");
    parts.push(
      `## Form ${form.code}`,
      "",
      `Situation: ${briefs[form.brief]?.title ?? form.brief}`,
      "",
      "First description, as typed:",
      "",
      ...(form.firstPrompt || "(none)").split("\n").map((line) => `> ${line}`),
      "",
      "Final form:",
      "",
      "| # | Question | Answer type | Required | Help text |",
      "|---|---|---|---|---|",
      ...form.fields.map(
        (f, i) =>
          `| ${i + 1} | ${cell(f.label)} | ${cell(f.type)} | ${f.required ? "yes" : "no"} | ${cell(f.description)} |`,
      ),
      "",
    );
  }
  return parts.join("\n");
}

/**
 * For the raters: one row per form and requirement. `in_first_prompt` and
 * `in_final_form` take 1 or 0; `covered_by` the number(s) of the question
 * that covers it.
 */
export function codingRequirementsCsv(data: StudyExport, briefs: Briefs): string {
  const rows: unknown[][] = [];
  for (const form of codedForms(data)) {
    for (const requirement of briefs[form.brief]?.requirements ?? []) {
      rows.push([form.code, form.brief, requirement.id, requirement.text, "", "", "", ""]);
    }
  }
  return toCsv(
    [
      "form",
      "situation",
      "requirement_id",
      "requirement",
      "in_first_prompt",
      "in_final_form",
      "covered_by",
      "notes",
    ],
    rows,
  );
}

/**
 * For the raters: one row per question of each form. `requirement_id` takes
 * the requirement the question serves, or "none" — the unnecessary fields.
 */
export function codingFieldsCsv(data: StudyExport): string {
  const rows: unknown[][] = [];
  for (const form of codedForms(data)) {
    form.fields.forEach((f, i) =>
      rows.push([form.code, form.brief, i + 1, f.label, f.type, f.required ? 1 : 0, "", ""]),
    );
  }
  return toCsv(
    ["form", "situation", "question_no", "question", "answer_type", "required", "requirement_id", "notes"],
    rows,
  );
}

function seconds(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);
}

interface StoredQuiz {
  items?: QuizItem[];
  answers?: Record<string, QuizAnswer>;
}

/**
 * For the analyst, never for the raters: which participant and condition a
 * form code belongs to, with what was logged about the task.
 */
export function codingKeyCsv(data: StudyExport): string {
  const names = new Map(data.participants.map((p) => [p.id, p.display_name]));
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const countEvents = (portfolioId: string | null, type: string) =>
    data.events.filter((e) => e.portfolio_id === portfolioId && e.type === type).length;

  const rows = codedForms(data).map((form) => {
    const task = data.tasks.find((t) => t.id === form.taskId)!;
    const a = assignment.get(form.participantId);
    const quiz = data.questionnaires.find(
      (q) =>
        q.participant_id === form.participantId &&
        q.instrument === quizInstrument(form.position),
    )?.answers as StoredQuiz | undefined;
    const probes = data.designProbes.filter((p) => p.portfolio_id === form.portfolioId);
    return [
      form.code,
      names.get(form.participantId) ?? form.participantId,
      a?.condition ?? "",
      a?.task_order ?? "",
      form.position,
      form.brief,
      form.portfolioId,
      task.start_kind ?? "",
      task.source_portfolio_id ?? "",
      seconds(task.started_at, task.finished_at),
      task.finished_by,
      form.fields.length,
      form.firstPrompt.length,
      probes.length,
      probes.filter((p) => p.status === "resolved").length,
      countEvents(form.portfolioId, "chat_message"),
      countEvents(form.portfolioId, "field_saved") +
        countEvents(form.portfolioId, "fields_added") +
        countEvents(form.portfolioId, "field_removed"),
      countEvents(form.portfolioId, "brief_opened"),
      quiz?.items ? quizScore(quiz.items, quiz.answers ?? {}) : null,
      ...postTaskValues(taskMeasures(data, form)),
    ];
  });
  return toCsv(
    [
      "form",
      "participant",
      "condition",
      "order",
      "position",
      "situation",
      "portfolio_id",
      "start_kind",
      "source_portfolio_id",
      "task_seconds",
      "finished_by",
      "field_count",
      "first_prompt_chars",
      "probes_shown",
      "probes_answered",
      "chat_messages",
      "direct_edits",
      "situation_reopened",
      "quiz_score",
      // Appended 2026-11-13, so earlier columns keep their positions
      ...POST_TASK_COLUMNS,
    ],
    rows,
  );
}

/** One row per participant: assignment, outcome, questionnaire. */
export function participantsCsv(data: StudyExport): string {
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const progress = new Map(data.progress.map((p) => [p.participant_id, p]));
  const items = BRIEFS_QUESTIONNAIRE.fields.map((f) => f.name);
  const settings = parseSettings(data.session.settings);
  const positions = Math.max(
    settings.briefs.length,
    ...data.tasks.map((t) => t.position),
    0,
  );
  const steps = briefSteps(positions, settings.postTaskMeasures).filter((step) => step !== "done");
  const perTask = Array.from({ length: positions }, (_, i) => i + 1);
  const rows = data.participants.map((p) => {
    const timings = stepSeconds(data, p.id);
    const a = assignment.get(p.id);
    const pr = progress.get(p.id);
    const answers = (data.questionnaires.find(
      (q) => q.participant_id === p.id && q.instrument === BRIEFS_INSTRUMENT,
    )?.answers ?? null) as Record<string, unknown> | null;
    return [
      p.display_name,
      a?.condition ?? "",
      a?.task_order ?? "",
      pr?.outcome ?? "incomplete",
      pr?.step ?? "",
      seconds(p.joined_at, pr?.completed_at ?? null),
      answers ? susScore(answers) : null,
      answers ? ncs6Score(answers) : null,
      answers ? (Number(answers[ATTENTION_ITEM.name]) === ATTENTION_ITEM.expected ? 1 : 0) : null,
      ...items.map((name) => answers?.[name]),
      ...steps.map((step) => timings.get(step) ?? null),
      ...perTask.flatMap((position) => {
        const task = data.tasks.find((t) => t.participant_id === p.id && t.position === position);
        const m = taskMeasures(data, {
          participantId: p.id,
          position,
          portfolioId: task?.portfolio_id ?? null,
        });
        return [m.know, m.confident, m.whyOrigins, m.assistantTurns, m.questionSentences, m.patches];
      }),
    ];
  });
  return toCsv(
    [
      "participant",
      "condition",
      "order",
      "outcome",
      "last_step",
      "total_seconds",
      "sus_score",
      "ncs6_score",
      "attention_passed",
      ...items,
      // Appended 2026-11-13: seconds per step (server clock), then per task
      ...steps.map((step) => `seconds_${step.replace(":", "_")}`),
      ...perTask.flatMap((position) =>
        [
          "rating_know",
          "rating_confident",
          "why_origins",
          "assistant_turns",
          "assistant_question_sentences",
          "assistant_patches",
        ].map((name) => `t${position}_${name}`),
      ),
    ],
    rows,
  );
}

/**
 * Cohen's kappa for two raters' codes of the same items (any labels).
 * Null when there is nothing to compare; 1 when both used a single,
 * identical label throughout.
 */
export function cohenKappa(a: readonly string[], b: readonly string[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n === 0) return null;
  const labels = [...new Set([...a.slice(0, n), ...b.slice(0, n)])];
  let agree = 0;
  for (let i = 0; i < n; i++) if (a[i] === b[i]) agree++;
  const observed = agree / n;
  const expected = labels.reduce((sum, label) => {
    const pa = a.slice(0, n).filter((x) => x === label).length / n;
    const pb = b.slice(0, n).filter((x) => x === label).length / n;
    return sum + pa * pb;
  }, 0);
  if (expected === 1) return 1;
  return (observed - expected) / (1 - expected);
}

/**
 * Weighted kappa for two raters' ordinal codes (e.g. the why sheet's
 * `score`, 0–2). `categories` in order; disagreements count by distance:
 * linear weights 1 − |i − j| / (k − 1), quadratic 1 − ((i − j) / (k − 1))².
 * Pairs with a code outside `categories` are left out. Null when there is
 * nothing to compare; 1 when chance agreement is already perfect.
 */
export function weightedKappa(
  a: readonly string[],
  b: readonly string[],
  categories: readonly string[],
  weights: "linear" | "quadratic" = "linear",
): number | null {
  const k = categories.length;
  const index = new Map(categories.map((c, i) => [c, i]));
  const pairs: [number, number][] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = index.get(a[i]);
    const y = index.get(b[i]);
    if (x !== undefined && y !== undefined) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n === 0 || k < 2) return null;
  const w = (i: number, j: number) => {
    const d = Math.abs(i - j) / (k - 1);
    return weights === "linear" ? 1 - d : 1 - d * d;
  };
  const pa = Array(k).fill(0);
  const pb = Array(k).fill(0);
  let observed = 0;
  for (const [x, y] of pairs) {
    pa[x] += 1 / n;
    pb[y] += 1 / n;
    observed += w(x, y) / n;
  }
  let expected = 0;
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) expected += w(i, j) * pa[i] * pb[j];
  if (expected === 1) return 1;
  return (observed - expected) / (1 - expected);
}

// ---------------------------------------------------------------------------
// Answered elicitation questions
// ---------------------------------------------------------------------------

interface AnsweredPayload {
  id?: string;
  text?: string;
  source?: string;
  option?: string;
  position?: number | null;
  modelPosition?: number | null;
  optionCount?: number;
  noChange?: boolean | null;
  unchangedAnswer?: boolean;
  typed?: boolean;
  answerSource?: string;
}

interface PreviewedPayload {
  ownerId?: string;
  option?: string;
  ms?: number;
}

const flag = (value: boolean | null | undefined) => (value == null ? "" : value ? 1 : 0);

/**
 * For the analyst: one row per answered elicitation question (the
 * `probe_answered` log events — an answer that was applied).
 *
 * - `displayed_position`: where the chosen answer was on the card, 0 = first.
 *   The order is drawn at random when the question is stored; a typed answer
 *   is last. `model_position` is where the model had it (empty: the added
 *   unchanged answer, a typed answer, or a question from before the order
 *   was randomised).
 * - `unchanged_answer`: 1 when the answer left the form as it was.
 * - `typed`: 1 when the creator wrote the answer.
 * - `preview_viewed_first`, `preview_viewed_ms`: whether the chosen answer's
 *   preview was looked at on the form (hover or focus, 300 ms or longer)
 *   before it was applied, and for how long in total.
 * - `answers_previewed`: how many different answers of the question were
 *   previewed that way before the answer.
 */
export function questionAnswersCsv(data: StudyExport): string {
  const names = new Map(data.participants.map((p) => [p.id, p.display_name]));
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const taskOf = new Map(data.tasks.map((t) => [t.portfolio_id, t]));
  // Oldest first: an answer only counts previews that came before it
  const events = [...data.events].sort((a, b) => Number(a.id) - Number(b.id));

  const rows: unknown[][] = [];
  events.forEach((event, index) => {
    if (event.type !== "probe_answered") return;
    const payload = (event.payload ?? {}) as AnsweredPayload;
    const before = events.slice(0, index).filter(
      (e) => e.participant_id === event.participant_id && e.portfolio_id === event.portfolio_id,
    );
    const previews = before
      .filter((e) => e.type === "option_previewed")
      .map((e) => (e.payload ?? {}) as PreviewedPayload)
      .filter((p) => p.ownerId === payload.id);
    const ofChosen = previews.filter((p) => p.option === payload.option);
    const shown = before.find(
      (e) => e.type === "probe_shown" && (e.payload as { id?: string } | null)?.id === payload.id,
    );
    const task = taskOf.get(event.portfolio_id);
    const a = event.participant_id ? assignment.get(event.participant_id) : undefined;
    const typed = payload.typed ?? payload.answerSource === "custom";
    rows.push([
      event.participant_id ? names.get(event.participant_id) ?? event.participant_id : "",
      a?.condition ?? "",
      task ? formCode(task.id) : "",
      task?.brief ?? "",
      task?.position ?? "",
      payload.id ?? "",
      payload.text ?? "",
      payload.source ?? "",
      payload.option ?? "",
      payload.position ?? "",
      payload.modelPosition ?? "",
      payload.optionCount ?? "",
      flag(payload.noChange),
      flag(typed),
      flag(ofChosen.length > 0),
      ofChosen.reduce((sum, p) => sum + (p.ms ?? 0), 0),
      new Set(previews.map((p) => p.option)).size,
      shown ? seconds(shown.created_at, event.created_at) : "",
      event.created_at,
    ]);
  });
  return toCsv(
    [
      "participant",
      "condition",
      "form",
      "situation",
      "position",
      "question_id",
      "question",
      "question_source",
      "answer",
      "displayed_position",
      "model_position",
      "answer_count",
      "unchanged_answer",
      "typed",
      "preview_viewed_first",
      "preview_viewed_ms",
      "answers_previewed",
      "seconds_since_shown",
      "answered_at",
    ],
    rows,
  );
}

// ---------------------------------------------------------------------------
// Form diversity
// ---------------------------------------------------------------------------

interface DiversityGroup {
  situation: string;
  condition: string;
  startKind: string;
  forms: FormFields[];
}

/** The finished forms per situation and arm (condition, and starting point in wave 2). */
function diversityGroups(data: StudyExport): DiversityGroup[] {
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const tasks = new Map(data.tasks.map((t) => [t.id, t]));
  const groups = new Map<string, DiversityGroup>();
  for (const form of codedForms(data)) {
    const condition = assignment.get(form.participantId)?.condition ?? "";
    const startKind = tasks.get(form.taskId)?.start_kind ?? "";
    const key = [form.brief, condition, startKind].join("|");
    const group =
      groups.get(key) ?? { situation: form.brief, condition, startKind, forms: [] };
    group.forms.push({
      id: form.code,
      fields: form.fields.map((f) => ({ key: f.key, label: f.label })),
    });
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.situation.localeCompare(b.situation) ||
      a.condition.localeCompare(b.condition) ||
      a.startKind.localeCompare(b.startKind),
  );
}

const round = (value: number | null) => (value === null ? "" : Math.round(value * 1000) / 1000);

/**
 * For the analyst: how alike the finished forms of one arm are, per
 * situation — the mean pairwise overlap of their field sets (Jaccard, fields
 * matched as committee drafts are aligned). `diversity` = 1 − mean overlap.
 * If suggested answers steer everyone to the same fields, the arm that had
 * them shows a higher overlap.
 */
export function formDiversityCsv(data: StudyExport): string {
  return toCsv(
    [
      "situation",
      "condition",
      "start_kind",
      "forms",
      "pairs",
      "mean_overlap",
      "min_overlap",
      "max_overlap",
      "diversity",
      "mean_fields",
    ],
    diversityGroups(data).map((group) => {
      const summary = summarizeDiversity(group.forms);
      return [
        group.situation,
        group.condition,
        group.startKind,
        summary.forms,
        summary.pairs,
        round(summary.meanOverlap),
        round(summary.minOverlap),
        round(summary.maxOverlap),
        round(summary.meanOverlap === null ? null : 1 - summary.meanOverlap),
        round(summary.meanFields),
      ];
    }),
  );
}

/** For the analyst: the overlap of every pair of forms within an arm. */
export function formDiversityPairsCsv(data: StudyExport): string {
  const rows: unknown[][] = [];
  for (const group of diversityGroups(data)) {
    for (const pair of pairwiseOverlaps(group.forms)) {
      rows.push([
        group.situation,
        group.condition,
        group.startKind,
        pair.a,
        pair.b,
        round(pair.overlap),
      ]);
    }
  }
  return toCsv(["situation", "condition", "start_kind", "form_a", "form_b", "overlap"], rows);
}

// ---------------------------------------------------------------------------
// What the session ran with
// ---------------------------------------------------------------------------

/** The run settings recorded in the session (null: never opened, or a workshop). */
export function sessionRun(data: Pick<StudyExport, "session">): StudyRunSettings | null {
  return parseRunSettings((data.session.settings as { run?: unknown } | null)?.run);
}

const RUN_COLUMNS = ["model", "question_strategy", "committee_size"];

/**
 * A CSV with the session's model, question strategy and committee size as
 * its last three columns, on every row — so no file leaves the study
 * without saying what produced it. Existing columns keep their names and
 * positions.
 */
export function withRunColumns(csv: string, run: StudyRunSettings | null): string {
  const [header, ...rows] = parseCsv(csv);
  if (!header) return csv;
  const values = run ? [run.model, run.questionStrategy, run.committeeSize] : ["", "", ""];
  return toCsv(
    [...header, ...RUN_COLUMNS],
    rows.map((row) => [...row, ...values]),
  );
}

/** The same, for a Markdown file: a line under the title. */
export function withRunLine(markdown: string, run: StudyRunSettings | null): string {
  const line = run
    ? `Run: model ${run.model} · ${run.questionStrategy} questions · committee of ${run.committeeSize}`
    : "Run: not recorded";
  const [title, ...rest] = markdown.split("\n");
  return [title, "", line, ...rest].join("\n");
}

// ---------------------------------------------------------------------------
// After each task: ratings, free recall, why (sessions with post-task
// measures, 2026-11-13), and the assistant arm's turns
// ---------------------------------------------------------------------------

function answersOf(
  data: StudyExport,
  participantId: string,
  instrument: string,
): Record<string, unknown> | null {
  const row = data.questionnaires.find(
    (q) => q.participant_id === participantId && q.instrument === instrument,
  );
  return (row?.answers ?? null) as Record<string, unknown> | null;
}

/**
 * Seconds each step of a participant took, by the server's clock: from
 * entering it (`joined` for consent, `step_entered` for the rest) to
 * entering the next. The last step reached has none.
 */
export function stepSeconds(data: StudyExport, participantId: string): Map<string, number> {
  const entries = data.events
    .filter(
      (e) =>
        e.participant_id === participantId &&
        (e.type === "joined" || e.type === "step_entered"),
    )
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((e) => ({ step: e.type === "joined" ? "consent" : (e.phase ?? ""), at: e.created_at }));
  const out = new Map<string, number>();
  entries.forEach((entry, i) => {
    const next = entries[i + 1];
    if (next) out.set(entry.step, seconds(entry.at, next.at) ?? 0);
  });
  return out;
}

interface TurnPayload {
  turn?: number;
  reply?: string;
  replyChars?: number;
  questionSentences?: number;
  patchOps?: number | null;
  added?: number;
  changed?: number;
  removed?: number;
  latencyMs?: number;
  promptVersion?: string;
}

interface TaskMeasures {
  know: number | null;
  confident: number | null;
  recallLines: number | null;
  /** e.g. "participant;system;system", sorted; empty without why items */
  whyOrigins: string;
  seconds: { ratings: number | null; recall: number | null; why: number | null; quiz: number | null };
  /** Assistant arm only (empty otherwise) */
  assistantTurns: number | "";
  questionSentences: number | "";
  patches: number | "";
}

function taskMeasures(
  data: StudyExport,
  form: { participantId: string; position: number; portfolioId: string | null },
): TaskMeasures {
  const { participantId, position, portfolioId } = form;
  const ratings = answersOf(data, participantId, ratingsInstrument(position));
  const recall = answersOf(data, participantId, recallInstrument(position));
  const why = answersOf(data, participantId, whyInstrument(position));
  const timings = stepSeconds(data, participantId);
  const number = (value: unknown) => (typeof value === "number" ? value : null);
  const lines = Array.isArray(recall?.lines) ? (recall.lines as unknown[]) : null;
  const items = Array.isArray(why?.items) ? (why.items as WhyItem[]) : [];

  const condition = data.assignments.find((a) => a.participant_id === participantId)?.condition;
  const turns = data.events
    .filter((e) => e.type === "assistant_turn" && e.participant_id === participantId && e.portfolio_id === portfolioId)
    .map((e) => (e.payload ?? {}) as TurnPayload);
  const assistant = condition === "assistant";
  return {
    know: number(ratings?.know),
    confident: number(ratings?.confident),
    recallLines: lines ? lines.length : null,
    whyOrigins: items.map((item) => item.origin).sort().join(";"),
    seconds: {
      ratings: timings.get(`ratings:${position}`) ?? null,
      recall: timings.get(`recall:${position}`) ?? null,
      why: timings.get(`why:${position}`) ?? null,
      quiz: timings.get(`quiz:${position}`) ?? null,
    },
    assistantTurns: assistant ? turns.length : "",
    questionSentences: assistant ? turns.reduce((sum, t) => sum + (t.questionSentences ?? 0), 0) : "",
    patches: assistant ? turns.filter((t) => (t.patchOps ?? 0) > 0).length : "",
  };
}

const POST_TASK_COLUMNS = [
  "rating_know",
  "rating_confident",
  "recall_lines",
  "ratings_seconds",
  "recall_seconds",
  "why_seconds",
  "quiz_seconds",
  "why_origins",
  "assistant_turns",
  "assistant_question_sentences",
  "assistant_patches",
];

function postTaskValues(m: TaskMeasures): unknown[] {
  return [
    m.know,
    m.confident,
    m.recallLines,
    m.seconds.ratings,
    m.seconds.recall,
    m.seconds.why,
    m.seconds.quiz,
    m.whyOrigins,
    m.assistantTurns,
    m.questionSentences,
    m.patches,
  ];
}

/**
 * For the raters: one row per line of free recall ("List everything your
 * form asks"). `matches_field`: the number of the question in
 * coding-forms.md the line names, or "none"; `requirement_id`: the
 * requirement it names, or "none". See docs/study/coding-guide.md.
 */
export function codingRecallCsv(data: StudyExport): string {
  const rows: unknown[][] = [];
  for (const form of codedForms(data)) {
    const answers = answersOf(data, form.participantId, recallInstrument(form.position));
    const lines = Array.isArray(answers?.lines) ? (answers.lines as unknown[]) : [];
    lines.forEach((line, i) => rows.push([form.code, form.brief, i + 1, String(line), "", ""]));
  }
  return toCsv(["form", "situation", "line_no", "text", "matches_field", "requirement_id"], rows);
}

/**
 * For the raters: one row per "Why does your form ask this?" item. `score`:
 * 0 = no or wrong reason, 1 = plausible but generic, 2 = tied to the
 * situation. Where the field came from is not in this file (it is in the
 * key).
 */
export function codingWhyCsv(data: StudyExport): string {
  const rows: unknown[][] = [];
  for (const form of codedForms(data)) {
    const answers = answersOf(data, form.participantId, whyInstrument(form.position));
    const items = Array.isArray(answers?.items) ? (answers.items as (WhyItem & { answer?: string })[]) : [];
    items.forEach((item, i) => rows.push([form.code, form.brief, i + 1, item.label, item.answer ?? "", ""]));
  }
  return toCsv(["form", "situation", "item_no", "field_label", "answer", "score"], rows);
}

/**
 * For the analyst: the why items with where each field came from (system,
 * participant, inherited), to join with the raters' scores on form and
 * item_no.
 */
export function whyKeyCsv(data: StudyExport): string {
  const rows: unknown[][] = [];
  for (const form of codedForms(data)) {
    const answers = answersOf(data, form.participantId, whyInstrument(form.position));
    const items = Array.isArray(answers?.items) ? (answers.items as WhyItem[]) : [];
    items.forEach((item, i) => rows.push([form.code, i + 1, item.fieldId, item.label, item.origin]));
  }
  return toCsv(["form", "item_no", "field_id", "field_label", "origin"], rows);
}

/** For the analyst: one row per turn of the assistant arm, oldest first. */
export function assistantTurnsCsv(data: StudyExport): string {
  const names = new Map(data.participants.map((p) => [p.id, p.display_name]));
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const taskOf = new Map(data.tasks.map((t) => [t.portfolio_id, t]));
  const events = [...data.events].sort((a, b) => Number(a.id) - Number(b.id));
  const rows: unknown[][] = [];
  events.forEach((event, index) => {
    if (event.type !== "assistant_turn") return;
    const payload = (event.payload ?? {}) as TurnPayload;
    const task = event.portfolio_id ? taskOf.get(event.portfolio_id) : undefined;
    // The participant's message that started this turn
    const message = events
      .slice(0, index)
      .reverse()
      .find(
        (e) =>
          e.type === "assistant_message" &&
          e.participant_id === event.participant_id &&
          e.portfolio_id === event.portfolio_id &&
          (e.payload as { turn?: number } | null)?.turn === payload.turn,
      );
    rows.push([
      event.participant_id ? names.get(event.participant_id) ?? event.participant_id : "",
      event.participant_id ? assignment.get(event.participant_id)?.condition ?? "" : "",
      task ? formCode(task.id) : "",
      task?.brief ?? "",
      task?.position ?? "",
      payload.turn ?? "",
      payload.replyChars ?? payload.reply?.length ?? "",
      payload.questionSentences ?? "",
      payload.patchOps ?? "",
      payload.added ?? "",
      payload.changed ?? "",
      payload.removed ?? "",
      payload.latencyMs ?? "",
      payload.promptVersion ?? "",
      String((message?.payload as { text?: unknown } | null)?.text ?? ""),
      payload.reply ?? "",
      event.created_at,
    ]);
  });
  return toCsv(
    [
      "participant",
      "condition",
      "form",
      "situation",
      "position",
      "turn",
      "reply_chars",
      "question_sentences",
      "patch_ops",
      "fields_added",
      "fields_changed",
      "fields_removed",
      "latency_ms",
      "prompt_version",
      "message",
      "reply",
      "created_at",
    ],
    rows,
  );
}
