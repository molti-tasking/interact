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
import type { BriefDefinition } from "./briefs.server";
import { toCsv } from "./export";
import {
  ATTENTION_ITEM,
  BRIEFS_INSTRUMENT,
  BRIEFS_QUESTIONNAIRE,
  quizInstrument,
  quizScore,
  susScore,
  type QuizAnswer,
  type QuizItem,
} from "./instruments";

interface CodedField {
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
    ],
    rows,
  );
}

/** One row per participant: assignment, outcome, questionnaire. */
export function participantsCsv(data: StudyExport): string {
  const assignment = new Map(data.assignments.map((a) => [a.participant_id, a]));
  const progress = new Map(data.progress.map((p) => [p.participant_id, p]));
  const items = BRIEFS_QUESTIONNAIRE.fields.map((f) => f.name);
  const rows = data.participants.map((p) => {
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
      answers ? (Number(answers[ATTENTION_ITEM.name]) === ATTENTION_ITEM.expected ? 1 : 0) : null,
      ...items.map((name) => answers?.[name]),
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
      "attention_passed",
      ...items,
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
