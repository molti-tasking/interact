/**
 * Rating scales and Likert items.
 *
 * A scale stores a whole number from `min` to `max`. A Likert scale also
 * names every point (`points`, lowest first), so it renders as labelled
 * choices; consecutive items on the same Likert scale render as one grid.
 */

import type { Field, FieldType } from "../types";

export type ScaleType = Extract<FieldType, { kind: "scale" }>;

/** Points a scale may have (an 11-point 0–10 scale is the widest common one). */
export const MAX_SCALE_POINTS = 11;
/** Consecutive items on a scale with at most this many points share a grid. */
export const MAX_GRID_POINTS = 7;

/** How the LLM (or a preset) describes a scale. */
export interface ScaleSpec {
  /** A label for every point, lowest first */
  points?: string[];
  min?: number;
  max?: number;
  lowLabel?: string;
  highLabel?: string;
}

const int = (n: unknown): number | undefined =>
  typeof n === "number" && Number.isInteger(n) ? n : undefined;

/**
 * Build a scale type from a spec. Point labels win over min/max (the range
 * becomes `min`…`min + n − 1`, starting at 1 unless a min is given); without
 * labels it's a numeric scale, 1–5 by default. Details the spec leaves out
 * are taken from `existing`.
 */
export function scaleFromSpec(
  spec: ScaleSpec | undefined,
  existing?: ScaleType,
): ScaleType {
  const points = spec?.points?.map((p) => p.trim()).filter(Boolean) ?? [];
  if (points.length >= 2 && points.length <= MAX_SCALE_POINTS) {
    const min = int(spec?.min) ?? existing?.min ?? 1;
    return { kind: "scale", min, max: min + points.length - 1, points };
  }

  const min = int(spec?.min) ?? existing?.min ?? 1;
  let max = int(spec?.max) ?? existing?.max ?? min + 4;
  if (max <= min) max = min + 4;
  const low = spec?.lowLabel?.trim() ?? "";
  const high = spec?.highLabel?.trim() ?? "";
  const labels = low || high ? { low, high } : existing?.labels;
  return labels ? { kind: "scale", min, max, labels } : { kind: "scale", min, max };
}

/** The point labels when they match the range, otherwise null. */
export function likertPoints(type: FieldType): string[] | null {
  if (type.kind !== "scale" || !type.points) return null;
  return type.points.length === type.max - type.min + 1 ? type.points : null;
}

/** "Agree" for 4 on a 1–5 agreement scale; null for numeric scales. */
export function scalePointLabel(type: FieldType, value: number): string | null {
  const points = likertPoints(type);
  if (!points || type.kind !== "scale") return null;
  return points[value - type.min] ?? null;
}

const normalize = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** The number for a point label ("strongly agree" → 5), or null. */
export function scaleValueForLabel(type: FieldType, text: string): number | null {
  const points = likertPoints(type);
  if (!points || type.kind !== "scale") return null;
  const index = points.map(normalize).indexOf(normalize(text));
  return index === -1 ? null : type.min + index;
}

export interface ScaleChoice {
  value: number;
  /** The point's label, or its number on a numeric scale */
  label: string;
  /** End label of a numeric scale ("Not at all" on the first choice) */
  hint?: string;
}

/**
 * The answer choices of a scale that is answered by picking one of a few
 * whole numbers (up to `MAX_SCALE_POINTS`), otherwise null (a slider).
 */
export function scaleChoices(type: FieldType): ScaleChoice[] | null {
  if (type.kind !== "scale") return null;
  const { min, max } = type;
  const count = max - min + 1;
  if (!Number.isInteger(min) || !Number.isInteger(max)) return null;
  if (count < 2 || count > MAX_SCALE_POINTS) return null;

  const points = likertPoints(type);
  return Array.from({ length: count }, (_, i) => {
    const value = min + i;
    if (points) return { value, label: points[i] };
    const hint =
      i === 0 ? type.labels?.low : i === count - 1 ? type.labels?.high : undefined;
    return hint ? { value, label: String(value), hint } : { value, label: String(value) };
  });
}

function sameScale(a: ScaleType, b: ScaleType): boolean {
  return (
    a.min === b.min &&
    a.max === b.max &&
    JSON.stringify(a.points ?? null) === JSON.stringify(b.points ?? null) &&
    JSON.stringify(a.labels ?? null) === JSON.stringify(b.labels ?? null)
  );
}

function gridScale(field: Field): ScaleType | null {
  const choices = scaleChoices(field.type);
  return choices && choices.length <= MAX_GRID_POINTS && field.type.kind === "scale"
    ? field.type
    : null;
}

/**
 * Split fields into what the form renders: single fields, and runs of two or
 * more consecutive items on the same scale (Likert or a short numeric one),
 * which share one grid.
 */
export function groupLikertRuns(fields: readonly Field[]): (Field | Field[])[] {
  const blocks: (Field | Field[])[] = [];
  let run: Field[] = [];
  const flush = () => {
    if (run.length >= 2) blocks.push(run);
    else blocks.push(...run);
    run = [];
  };

  for (const field of fields) {
    const scale = gridScale(field);
    const runScale = run[0] && gridScale(run[0]);
    if (scale && runScale && sameScale(scale, runScale)) {
      run.push(field);
      continue;
    }
    flush();
    if (scale) run = [field];
    else blocks.push(field);
  }
  flush();
  return blocks;
}

/** Common Likert anchors, for the field editor. */
export const LIKERT_PRESETS: { label: string; points: string[] }[] = [
  {
    label: "Agreement · 5",
    points: ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"],
  },
  {
    label: "Agreement · 7",
    points: [
      "Strongly disagree",
      "Disagree",
      "Somewhat disagree",
      "Neutral",
      "Somewhat agree",
      "Agree",
      "Strongly agree",
    ],
  },
  {
    label: "Frequency · 5",
    points: ["Never", "Rarely", "Sometimes", "Often", "Always"],
  },
  {
    label: "Satisfaction · 5",
    points: [
      "Very dissatisfied",
      "Dissatisfied",
      "Neutral",
      "Satisfied",
      "Very satisfied",
    ],
  },
];
