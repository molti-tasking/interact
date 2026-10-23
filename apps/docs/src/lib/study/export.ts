/**
 * Turn a session export (see `useStudyExport`) into analysis files: the full
 * JSON bundle plus flat CSVs for the interaction log and questionnaires.
 */

import type { StudyExport } from "@/hooks/query/study";
import { CDN_DIMENSIONS, FINAL_QUESTIONNAIRE, susScore } from "./instruments";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "string" ? value : Array.isArray(value) ? value.join("; ") : JSON.stringify(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

function participantNames(data: StudyExport): Map<string, string> {
  return new Map(data.participants.map((p) => [p.id, p.display_name]));
}

/** One row per interaction event, oldest first. */
export function eventsCsv(data: StudyExport): string {
  const names = participantNames(data);
  return toCsv(
    ["id", "created_at", "client_at", "participant", "phase", "type", "portfolio_id", "payload"],
    data.events.map((e) => [
      e.id,
      e.created_at,
      e.client_at,
      e.participant_id ? names.get(e.participant_id) ?? e.participant_id : "facilitator",
      e.phase,
      e.type,
      e.portfolio_id,
      e.payload,
    ]),
  );
}

/** One row per questionnaire: SUS score, every item, CDN items in order. */
export function questionnaireCsv(data: StudyExport): string {
  const names = participantNames(data);
  const items = FINAL_QUESTIONNAIRE.fields.map((f) => f.name);
  return toCsv(
    ["participant", "instrument", "submitted_at", "sus_score", ...items],
    data.questionnaires.map((q) => {
      const answers = (q.answers ?? {}) as Record<string, unknown>;
      return [
        names.get(q.participant_id) ?? q.participant_id,
        q.instrument,
        q.submitted_at,
        susScore(answers),
        ...items.map((name) => answers[name]),
      ];
    }),
  );
}

/** Which questionnaire columns are CDN items (and reverse-scored). */
export function cdnCodebookCsv(): string {
  return toCsv(
    ["item", "dimension", "reverse_scored"],
    CDN_DIMENSIONS.map((d) => [d.name, d.dimension, d.reverse]),
  );
}

/** Forms per participant at each snapshot + final: field counts over time. */
export function formsCsv(data: StudyExport): string {
  const names = participantNames(data);
  const fieldCount = (schema: unknown) =>
    ((schema as { fields?: unknown[] } | null)?.fields ?? []).length;
  const rows: unknown[][] = data.snapshots.map((s) => [
    s.participant_id ? names.get(s.participant_id) ?? s.participant_id : "",
    s.portfolio_id,
    s.label,
    s.created_at,
    s.title,
    fieldCount(s.schema),
    s.revision,
  ]);
  for (const p of data.participants) {
    const portfolio = data.portfolios.find((f) => f.id === p.portfolio_id);
    if (!portfolio) continue;
    rows.push([
      p.display_name,
      portfolio.id,
      "final",
      data.exportedAt,
      portfolio.title,
      fieldCount(portfolio.schema),
      portfolio.revision,
    ]);
  }
  return toCsv(
    ["participant", "portfolio_id", "label", "at", "title", "field_count", "revision"],
    rows,
  );
}
