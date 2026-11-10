/**
 * "Fill from text" for respondents: turning the values a model extracted
 * from a respondent's own description into form values — and only into
 * values the form can hold.
 *
 * The typing is the voice data-entry logic (`buildResponseEntry`). That
 * keeps answers "as spoken" when they don't fit (a choice that isn't an
 * option, an unreadable date), which is right for a table a creator reviews
 * later, but not for a form the respondent is about to submit: here such a
 * value is left out and reported, so the respondent picks it themselves.
 */

import type { PortfolioSchema } from "@/lib/types";
import {
  buildResponseEntry,
  dictatableFields,
  getAtPath,
  setAtPath,
  type DictatableField,
  type ValueIssue,
} from "@/lib/voice/data-entry";

export interface PrefilledValue {
  /** Dotted path of the field ("address.city") */
  key: string;
  path: string[];
  label: string;
  value: unknown;
}

export interface PrefillIssue extends ValueIssue {
  label: string;
}

export interface PrefillResult {
  /** Values to put into the form, each to be checked by the respondent */
  filled: PrefilledValue[];
  /** What was found in the text but couldn't be used as is */
  issues: PrefillIssue[];
  /** Labels of required questions the text didn't answer */
  missingRequired: string[];
}

/** Fields a text can fill: not uploads, and not links to other tables. */
export function prefillableFields(schema: PortfolioSchema): DictatableField[] {
  return dictatableFields(schema).filter(
    ({ field }) => field.type.kind !== "file" && field.type.kind !== "reference",
  );
}

function deleteAtPath(data: Record<string, unknown>, path: string[]): void {
  let cur: unknown = data;
  for (const segment of path.slice(0, -1)) {
    if (!cur || typeof cur !== "object") return;
    cur = (cur as Record<string, unknown>)[segment];
  }
  if (cur && typeof cur === "object") {
    delete (cur as Record<string, unknown>)[path[path.length - 1]];
  }
}

export function prefillFromValues(
  schema: PortfolioSchema,
  values: { field: string; value: string }[],
  options: { now?: Date } = {},
): PrefillResult {
  const fields = prefillableFields(schema);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  // Bare child names are accepted when unambiguous, like data entry does
  const bare = new Map<string, DictatableField[]>();
  for (const f of fields) {
    bare.set(f.field.name, [...(bare.get(f.field.name) ?? []), f]);
  }
  const usable = values.filter(
    (v) => byKey.has(v.field) || bare.get(v.field)?.length === 1,
  );

  const built = buildResponseEntry(schema, usable, options);
  const data = structuredClone(built.data);

  // Values kept "as spoken" don't belong in a form about to be submitted
  for (const issue of built.issues) {
    const target = byKey.get(issue.field);
    if (!target) continue;
    const { type } = target.field;
    if (issue.reason === "unparsed-date") {
      deleteAtPath(data, target.path);
    } else if (issue.reason === "not-an-option" && type.kind === "select") {
      const allowed = new Set(type.options.map((o) => o.value));
      const current = getAtPath(data, target.path);
      if (Array.isArray(current)) {
        const kept = current.filter((v) => allowed.has(String(v)));
        if (kept.length > 0) setAtPath(data, target.path, kept);
        else deleteAtPath(data, target.path);
      } else {
        deleteAtPath(data, target.path);
      }
    }
  }

  const filled: PrefilledValue[] = [];
  for (const f of fields) {
    const value = getAtPath(data, f.path);
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    filled.push({ key: f.key, path: f.path, label: f.label, value });
  }

  const filledKeys = new Set(filled.map((f) => f.key));
  return {
    filled,
    issues: built.issues.map((issue) => ({
      ...issue,
      label: byKey.get(issue.field)?.label ?? issue.field,
    })),
    missingRequired: fields
      .filter((f) => f.field.required && !filledKeys.has(f.key))
      .map((f) => f.label),
  };
}

/** What happened to a value, in words for the respondent. */
export function describePrefillIssue(issue: PrefillIssue): string {
  const said = `"${issue.value}"`;
  switch (issue.reason) {
    case "not-an-option":
      return `${issue.label}: ${said} isn't one of the choices — please pick one.`;
    case "unparsed-date":
      return `${issue.label}: couldn't read ${said} as a date.`;
    case "clamped":
      return `${issue.label}: ${said} is outside the scale — the nearest end was used.`;
    case "unsupported":
      return `${issue.label}: can't be filled from text.`;
    default:
      return `${issue.label}: couldn't use ${said}.`;
  }
}
