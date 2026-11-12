/**
 * Which answers were given to an earlier version of a field?
 *
 * Every stored response carries the revision of the form it answered
 * (`schemaVersion`), and every change in the history the revision it
 * produced. When a field's wording, type or options changed after answers
 * to it were collected, those answers were given to a different question —
 * findings computed over all of them should say so.
 */

import type { Field, PortfolioSchema, SchemaDiff } from "./types";

export interface VersionedResponse {
  /** Revision of the form when the response was stored; null: unknown (older data) */
  schemaVersion: number | null;
  submittedAt?: string | null;
  data: Record<string, unknown>;
}

export interface VersionedChange {
  /** Revision the change produced; null: unknown (older history) */
  revision: number | null;
  createdAt: string;
  diff: SchemaDiff | null;
}

export type FieldChangeKind = "wording" | "type" | "options";

export interface FieldChange {
  kind: FieldChangeKind;
  before: string;
  after: string;
  at: string;
  /** Answers to this field given before the change */
  answersBefore: number;
}

export interface FieldChangeNotice {
  fieldId: string;
  fieldName: string;
  label: string;
  /** Oldest first */
  changes: FieldChange[];
  /** Answers given before the latest of these changes */
  answersBefore: number;
  /** All answers to the field */
  answers: number;
}

function answered(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function optionLabels(type: Field["type"] | undefined): string[] | null {
  return type?.kind === "select" ? type.options.map((o) => o.label) : null;
}

function describeType(type: Field["type"] | undefined): string {
  if (!type) return "";
  if (type.kind === "select") return type.multiple ? "choose several" : "choose one";
  return type.kind;
}

/** What a history entry changed about how one field asks, if anything. */
function askingChanges(
  before: Partial<Field>,
  after: Partial<Field>,
): Omit<FieldChange, "at" | "answersBefore">[] {
  const changes: Omit<FieldChange, "at" | "answersBefore">[] = [];
  if (
    typeof before.label === "string" &&
    typeof after.label === "string" &&
    before.label.trim() !== after.label.trim()
  ) {
    changes.push({ kind: "wording", before: before.label, after: after.label });
  }
  if (before.type && after.type) {
    const from = describeType(before.type);
    const to = describeType(after.type);
    if (from !== to) {
      changes.push({ kind: "type", before: from, after: to });
    } else {
      const a = optionLabels(before.type);
      const b = optionLabels(after.type);
      if (a && b && JSON.stringify(a) !== JSON.stringify(b)) {
        changes.push({ kind: "options", before: a.join(" | "), after: b.join(" | ") });
      }
    }
  }
  return changes;
}

/**
 * The fields of `schema` whose wording, type or options changed after
 * answers to them had been collected. Fields without such a change, and
 * changes made before the first answer, are left out.
 *
 * A response counts as "before" a change when its form version is lower
 * than the revision the change produced; where either is unknown (data from
 * before versions were stamped), by time.
 */
export function fieldChangesAfterResponses(
  schema: PortfolioSchema,
  changes: readonly VersionedChange[],
  responses: readonly VersionedResponse[],
): FieldChangeNotice[] {
  const ordered = [...changes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const notices: FieldChangeNotice[] = [];

  for (const field of schema.fields) {
    const answers = responses.filter((r) => answered(r.data[field.name]));
    if (answers.length === 0) continue;

    const found: FieldChange[] = [];
    for (const change of ordered) {
      const patch = change.diff?.modified?.find((m) => m.fieldId === field.id);
      if (!patch) continue;
      const kinds = askingChanges(patch.before, patch.after);
      if (kinds.length === 0) continue;
      const answersBefore = answers.filter((r) =>
        r.schemaVersion !== null && change.revision !== null
          ? r.schemaVersion < change.revision
          : !!r.submittedAt && r.submittedAt < change.createdAt,
      ).length;
      if (answersBefore === 0) continue;
      for (const kind of kinds) found.push({ ...kind, at: change.createdAt, answersBefore });
    }
    if (found.length === 0) continue;

    notices.push({
      fieldId: field.id,
      fieldName: field.name,
      label: field.label,
      changes: found,
      answersBefore: Math.max(...found.map((c) => c.answersBefore)),
      answers: answers.length,
    });
  }
  return notices;
}

// ---------------------------------------------------------------------------
// Before a change: which collected answers it affects (I6)
// ---------------------------------------------------------------------------

/**
 * What a change does to a field that existing answers depend on:
 * - `removed`: the field is gone;
 * - `type`: it asks differently (another kind, or one choice ↔ several);
 * - `label`: its wording changed;
 * - `key`: its key changed — stored answers are keyed by it, so they no
 *   longer belong to the field.
 */
export type DestructiveKind = "removed" | "type" | "label" | "key";

export interface DestructiveChange {
  fieldId: string;
  /** The field's key before the change: the key its answers are stored under */
  fieldName: string;
  /** Its label before the change */
  label: string;
  kinds: DestructiveKind[];
}

/**
 * The fields of `before` that `after` removes, retypes, relabels or rekeys.
 * Fields are matched by id; added fields are not destructive.
 */
export function destructiveChanges(
  before: PortfolioSchema,
  after: PortfolioSchema,
): DestructiveChange[] {
  const afterById = new Map(after.fields.map((f) => [f.id, f]));
  const out: DestructiveChange[] = [];
  for (const old of before.fields) {
    const now = afterById.get(old.id);
    const kinds: DestructiveKind[] = [];
    if (!now) {
      kinds.push("removed");
    } else {
      if (describeType(old.type) !== describeType(now.type)) kinds.push("type");
      if (old.label.trim() !== now.label.trim()) kinds.push("label");
      if (old.name !== now.name) kinds.push("key");
    }
    if (kinds.length) {
      out.push({ fieldId: old.id, fieldName: old.name, label: old.label, kinds });
    }
  }
  return out;
}

export interface ResponseImpact {
  /** Every destructive change, with the answers stored for its field */
  fields: (DestructiveChange & { answers: number })[];
  /** Responses with an answer to at least one of these fields */
  responses: number;
}

/**
 * How many collected responses a change from `before` to `after` affects:
 * those with an answer (non-empty) to a field it removes, retypes, relabels
 * or rekeys. Answers are looked up under the field's key before the change.
 */
export function affectedResponses(
  before: PortfolioSchema,
  after: PortfolioSchema,
  responses: readonly Pick<VersionedResponse, "data">[],
): ResponseImpact {
  const changes = destructiveChanges(before, after);
  const fields = changes.map((c) => ({
    ...c,
    answers: responses.filter((r) => answered(r.data[c.fieldName])).length,
  }));
  const responsesAffected = changes.length
    ? responses.filter((r) => changes.some((c) => answered(r.data[c.fieldName]))).length
    : 0;
  return { fields, responses: responsesAffected };
}
