/**
 * Replay cases: recorded inputs of the LLM operations that change a form,
 * one JSON object per line (JSONL).
 *
 * A case holds what the operation was given (intent, schema, the probe or
 * edit) and, optionally, what must not happen (`expect`). It never holds the
 * model's answer: the harness asks the model again and measures the result,
 * so the same cases compare prompts and models over time.
 */

import fs from "node:fs";
import type {
  DesignProbeOption,
  PortfolioSchema,
  StructuredIntent,
} from "@/lib/types";
import type { ChangeExpectation } from "interact/forms/replay-metrics";

export const REPLAY_OPS = [
  "preview-probe-options",
  "resolve-probe",
  "refine-schema",
  "sync-intent",
  "generate-probes",
] as const;
export type ReplayOp = (typeof REPLAY_OPS)[number];

export interface CaseExpectation extends ChangeExpectation {
  /** The purpose text must come back exactly as it was */
  purposeUnchanged?: boolean;
}

interface CaseBase {
  /** Unique within a dataset */
  id: string;
  /** Where the case comes from: "seed", "fixture:<scenario>", "study:<code>" */
  source: string;
  note?: string;
  expect?: CaseExpectation;
}

export interface PreviewCase extends CaseBase {
  op: "preview-probe-options";
  input: {
    intent: StructuredIntent;
    schema: PortfolioSchema;
    probe: {
      text: string;
      explanation?: string;
      options: { value: string; label: string }[];
    };
    /**
     * The form some changes later. Each fresh preview is replayed on it to
     * see what it would spill onto, with and without scoping.
     */
    laterSchema?: PortfolioSchema;
  };
  /**
   * The previews as they were recorded (study exports): replayed on
   * `input.schema`, the form at the moment the creator answered. Measured
   * without calling the model, so `--offline` runs still report it.
   */
  recorded?: { options: DesignProbeOption[]; selected?: string | null };
}

export interface ResolveCase extends CaseBase {
  op: "resolve-probe";
  input: {
    intent: StructuredIntent;
    schema: PortfolioSchema;
    question: string;
    answer: string;
  };
}

export interface RefineCase extends CaseBase {
  op: "refine-schema";
  input: {
    previousIntent: StructuredIntent;
    intent: StructuredIntent;
    schema: PortfolioSchema;
    decisions?: { question: string; answer: string }[];
  };
}

export interface SyncIntentCase extends CaseBase {
  op: "sync-intent";
  input: {
    intent: StructuredIntent;
    schema: PortfolioSchema;
    editDescription: string;
    kind: "field-edit" | "design-decision";
  };
}

export interface GenerateProbesCase extends CaseBase {
  op: "generate-probes";
  input: {
    intent: StructuredIntent;
    schema: PortfolioSchema;
    existingQuestions?: string[];
    /** Default: both strategies are run and compared */
    strategies?: ("committee" | "prompted")[];
  };
}

export type ReplayCase =
  | PreviewCase
  | ResolveCase
  | RefineCase
  | SyncIntentCase
  | GenerateProbesCase;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function isIntent(v: unknown): v is StructuredIntent {
  return (
    isObject(v) &&
    ["purpose", "audience", "exclusions", "constraints"].every(
      (k) => isObject(v[k]) && typeof (v[k] as { content?: unknown }).content === "string",
    )
  );
}

function isSchema(v: unknown): v is PortfolioSchema {
  return isObject(v) && Array.isArray(v.fields) && Array.isArray(v.groups);
}

/** Why `value` isn't a valid case, or null when it is. */
export function caseProblem(value: unknown): string | null {
  if (!isObject(value)) return "not an object";
  if (typeof value.id !== "string" || !value.id) return "missing id";
  if (!REPLAY_OPS.includes(value.op as ReplayOp)) return `unknown op ${JSON.stringify(value.op)}`;
  const input = value.input;
  if (!isObject(input)) return "missing input";
  if (!isIntent(input.intent)) return "input.intent is not a structured intent";
  if (!isSchema(input.schema)) return "input.schema is not a schema";
  switch (value.op as ReplayOp) {
    case "preview-probe-options": {
      const probe = input.probe;
      if (!isObject(probe) || typeof probe.text !== "string" || !Array.isArray(probe.options)) {
        return "input.probe needs text and options";
      }
      if (input.laterSchema !== undefined && !isSchema(input.laterSchema)) {
        return "input.laterSchema is not a schema";
      }
      return null;
    }
    case "resolve-probe":
      return typeof input.question === "string" && typeof input.answer === "string"
        ? null
        : "input needs question and answer";
    case "refine-schema":
      return isIntent(input.previousIntent) ? null : "input.previousIntent is not a structured intent";
    case "sync-intent":
      return typeof input.editDescription === "string" ? null : "input needs editDescription";
    case "generate-probes":
      return null;
  }
}

/** Parse JSONL text. Blank lines and lines starting with `//` are skipped. */
export function parseCases(text: string, origin = "cases"): ReplayCase[] {
  const cases: ReplayCase[] = [];
  const ids = new Set<string>();
  text.split("\n").forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//")) return;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      throw new Error(`${origin}:${index + 1}: not valid JSON`);
    }
    const problem = caseProblem(value);
    if (problem) throw new Error(`${origin}:${index + 1}: ${problem}`);
    const c = value as ReplayCase;
    if (ids.has(c.id)) throw new Error(`${origin}:${index + 1}: duplicate id ${c.id}`);
    ids.add(c.id);
    cases.push(c);
  });
  return cases;
}

export function serializeCases(cases: readonly ReplayCase[]): string {
  return cases.map((c) => JSON.stringify(c)).join("\n") + "\n";
}

/** Read a `.jsonl` file, or every `.jsonl` file of a directory. */
export function readCases(path: string): ReplayCase[] {
  const stat = fs.statSync(path);
  const files = stat.isDirectory()
    ? fs
        .readdirSync(path)
        .filter((f) => f.endsWith(".jsonl"))
        .sort()
        .map((f) => `${path}/${f}`)
    : [path];
  const all = files.flatMap((file) => parseCases(fs.readFileSync(file, "utf8"), file));
  const ids = new Set<string>();
  for (const c of all) {
    if (ids.has(c.id)) throw new Error(`Duplicate case id across files: ${c.id}`);
    ids.add(c.id);
  }
  return all;
}
