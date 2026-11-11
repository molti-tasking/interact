/**
 * Deterministic measures of how well an automated change behaved — the
 * numbers the replay harness (`tests/evaluation/replay`) tracks across
 * prompt and model changes.
 *
 * They answer the pilot's complaints with counts instead of impressions:
 * - "the tool made changes I did not want" → fields changed outside what was
 *   expected, properties changed that the update didn't mention, locked
 *   fields a patch tried to touch;
 * - "an answer changed fields its preview didn't show" → what a preview
 *   spills onto when it is replayed on a later form, with and without
 *   scoping;
 * - purpose drift → sentences of the purpose an edit removed without
 *   naming them.
 *
 * Pure: schemas, patches and texts in, numbers out. No LLM, no I/O.
 */

import type { Field, PatchScope, PortfolioSchema, ProbeOptionPreview } from "./types";
import { applyProbeOption } from "./guards";
import { fieldTokens, voteEntropy, type DisagreementOp } from "./probe-disagreement";
import {
  applySchemaPatch,
  type PatchFieldUpdate,
  type SchemaPatch,
} from "./schema-patch";

// ---------------------------------------------------------------------------
// What changed between two schemas (by field key)
// ---------------------------------------------------------------------------

/** Properties of a field an automated change can alter. */
export type FieldProperty =
  | "label"
  | "type"
  | "options"
  | "scale"
  | "required"
  | "description"
  | "tooltip"
  | "section";

export interface SchemaChange {
  added: string[];
  removed: string[];
  /** Field key → the properties that differ */
  updated: Record<string, FieldProperty[]>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function sectionOf(schema: PortfolioSchema, field: Field): string {
  return (
    (schema.groups ?? []).find((g) => g.fieldIds.includes(field.id))?.label.trim().toLowerCase() ??
    ""
  );
}

function changedProperties(
  before: Field,
  after: Field,
  beforeSchema: PortfolioSchema,
  afterSchema: PortfolioSchema,
): FieldProperty[] {
  const changed: FieldProperty[] = [];
  if (before.label !== after.label) changed.push("label");
  if (before.type.kind !== after.type.kind) {
    changed.push("type");
  } else if (!same(before.type, after.type)) {
    // Same kind, different details: name the detail
    changed.push(
      before.type.kind === "select" ? "options" : before.type.kind === "scale" ? "scale" : "type",
    );
  }
  if (before.required !== after.required) changed.push("required");
  if ((before.description ?? "") !== (after.description ?? "")) changed.push("description");
  if ((before.tooltip ?? "") !== (after.tooltip ?? "")) changed.push("tooltip");
  if (sectionOf(beforeSchema, before) !== sectionOf(afterSchema, after)) changed.push("section");
  return changed;
}

/** Fields added, removed and changed between two schemas, matched by key. */
export function schemaChange(before: PortfolioSchema, after: PortfolioSchema): SchemaChange {
  const beforeByName = new Map(before.fields.map((f) => [f.name, f]));
  const afterByName = new Map(after.fields.map((f) => [f.name, f]));
  const change: SchemaChange = { added: [], removed: [], updated: {} };
  for (const [name, field] of afterByName) {
    const previous = beforeByName.get(name);
    if (!previous) {
      change.added.push(name);
      continue;
    }
    const properties = changedProperties(previous, field, before, after);
    if (properties.length > 0) change.updated[name] = properties;
  }
  for (const name of beforeByName.keys()) {
    if (!afterByName.has(name)) change.removed.push(name);
  }
  return change;
}

/** Every field key a change touched. */
export function touchedKeys(change: SchemaChange): string[] {
  return [...change.added, ...change.removed, ...Object.keys(change.updated)];
}

// ---------------------------------------------------------------------------
// Patch ops: how many the form took, how many it refused
// ---------------------------------------------------------------------------

export interface PatchOpStats {
  /** Adds + updates + removals the patch asked for */
  ops: number;
  applied: number;
  /** Updates/removals of keys the form doesn't have */
  skippedUnknown: number;
  /** Ops on fields the creator locked */
  skippedLocked: number;
}

export function patchOpStats(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): PatchOpStats {
  const { applied, skipped } = applySchemaPatch(schema, patch, opts);
  const ops =
    (patch.addFields?.length ?? 0) +
    (patch.updateFields?.length ?? 0) +
    (patch.removeFieldKeys?.length ?? 0);
  return {
    ops,
    applied: applied.added.length + applied.updated.length + applied.removed.length,
    skippedUnknown: skipped.updated.length + skipped.removed.length,
    skippedLocked: skipped.locked.length,
  };
}

// ---------------------------------------------------------------------------
// Partial updates: did a field change in a way its update didn't mention?
// ---------------------------------------------------------------------------

/** The properties an update spells out (non-null), as `FieldProperty`s. */
function mentionedProperties(update: PatchFieldUpdate): Set<FieldProperty> {
  const mentioned = new Set<FieldProperty>();
  if (update.label != null) mentioned.add("label");
  if (update.type != null) mentioned.add("type");
  if (update.validation != null) mentioned.add("options");
  if (update.scale != null) mentioned.add("scale");
  if (update.required != null) mentioned.add("required");
  if (update.description != null) mentioned.add("description");
  if (update.tooltip != null) mentioned.add("tooltip");
  if (update.referenceTarget != null) mentioned.add("type");
  // A new type brings its own details
  if (mentioned.has("type")) {
    mentioned.add("options");
    mentioned.add("scale");
  }
  return mentioned;
}

export interface UnmentionedChange {
  key: string;
  properties: FieldProperty[];
}

/**
 * Existing fields whose properties changed although the patch didn't say
 * so: a property its update left null, or a field an "add" overwrote
 * because its key was taken. With partial updates this should be empty —
 * anything here is a change beyond what the patch states.
 */
export function unmentionedChanges(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  opts: { validTargetIds?: Iterable<string> } = {},
): UnmentionedChange[] {
  const { schema: after } = applySchemaPatch(schema, patch, opts);
  const change = schemaChange(schema, after);

  const mentioned = new Map<string, Set<FieldProperty>>();
  const mention = (key: string, properties: Iterable<FieldProperty>) => {
    const set = mentioned.get(key) ?? new Set<FieldProperty>();
    for (const p of properties) set.add(p);
    mentioned.set(key, set);
  };
  for (const update of patch.updateFields ?? []) mention(update.key, mentionedProperties(update));
  // An add whose key already exists overwrites that field. The patch set
  // out to add something, not to change a field — so nothing it does to the
  // existing field counts as mentioned.
  for (const placement of patch.sections ?? []) {
    for (const key of placement.fieldKeys) mention(key, ["section"]);
  }

  const result: UnmentionedChange[] = [];
  for (const [key, properties] of Object.entries(change.updated)) {
    const allowed = mentioned.get(key) ?? new Set<FieldProperty>();
    const extra = properties.filter((p) => !allowed.has(p));
    if (extra.length > 0) result.push({ key, properties: extra });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Summaries: does the one-line preview name what it changes?
// ---------------------------------------------------------------------------

/**
 * Fields a change touches that its summary doesn't name. A field counts as
 * named when the summary shares a content word with its label or key
 * ("Adds session length and goal" names `sessionLength` and "Training goal").
 * A heuristic: it under-reports for summaries that happen to share a word,
 * and over-reports for summaries that describe a group ("Adds contact details").
 */
export function fieldsBeyondSummary(
  summary: string,
  before: PortfolioSchema,
  after: PortfolioSchema,
): string[] {
  const summaryTokens = fieldTokens(summary);
  const change = schemaChange(before, after);
  const fieldByName = new Map(
    [...before.fields, ...after.fields].map((f) => [f.name, f] as const),
  );
  return touchedKeys(change).filter((key) => {
    const field = fieldByName.get(key);
    const tokens = new Set([...fieldTokens(key), ...fieldTokens(field?.label ?? "")]);
    for (const t of tokens) if (summaryTokens.has(t)) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Replaying a preview on a later form
// ---------------------------------------------------------------------------

export interface ReplaySpill {
  /**
   * Fields the raw patch changes on the later form that the preview didn't
   * show — what happened in the pilot (5 of 112 answers), before scoping.
   */
  unscoped: string[];
  /** The same after scoping (`applyProbeOption`) — must be empty */
  scoped: string[];
  /** Ops scoping dropped on the later form */
  dropped: string[];
  /** Locked fields the patch tried to touch on the later form */
  locked: string[];
}

function outsideScope(change: SchemaChange, scope: PatchScope): string[] {
  const shown = new Set([...scope.added, ...scope.updated, ...scope.removed]);
  return touchedKeys(change).filter((key) => !shown.has(key));
}

/**
 * Replay a preview computed on one form onto a later state of it. The
 * preview's scope is what the creator was shown; a preview without one
 * (from before scoping) gets the scope it has on `base`.
 */
export function replaySpill(
  base: PortfolioSchema,
  preview: Pick<ProbeOptionPreview, "schemaPatch" | "scope">,
  later: PortfolioSchema,
  opts: { validTargetIds?: Iterable<string> } = {},
): ReplaySpill {
  const scope: PatchScope =
    preview.scope ??
    (() => {
      const { applied } = applySchemaPatch(base, preview.schemaPatch, opts);
      return { added: applied.added, updated: applied.updated, removed: applied.removed };
    })();

  const raw = applySchemaPatch(later, preview.schemaPatch, opts);
  const guarded = applyProbeOption(later, { schemaPatch: preview.schemaPatch, scope }, opts);
  return {
    unscoped: outsideScope(schemaChange(later, raw.schema), scope),
    scoped: outsideScope(schemaChange(later, guarded.schema), scope),
    dropped: guarded.dropped,
    locked: guarded.locked,
  };
}

// ---------------------------------------------------------------------------
// Expectations: changes the case says must not happen
// ---------------------------------------------------------------------------

export interface ChangeExpectation {
  /** Existing fields the change may alter or remove; others must stay */
  mayChange?: string[];
  /** Fields that must still be there, unchanged */
  mustKeep?: string[];
  /** false: the change must not add fields */
  mayAdd?: boolean;
  /** The form must stay exactly as it is */
  noFormChange?: boolean;
}

/** Field keys a change touched against the case's expectations. */
export function unwantedChanges(
  before: PortfolioSchema,
  after: PortfolioSchema,
  expect: ChangeExpectation,
): string[] {
  const change = schemaChange(before, after);
  const existing = [...change.removed, ...Object.keys(change.updated)];
  const unwanted = new Set<string>();
  if (expect.noFormChange) for (const key of touchedKeys(change)) unwanted.add(key);
  if (expect.mayChange) {
    const allowed = new Set(expect.mayChange);
    for (const key of existing) if (!allowed.has(key)) unwanted.add(key);
  }
  for (const key of expect.mustKeep ?? []) if (existing.includes(key)) unwanted.add(key);
  if (expect.mayAdd === false) for (const key of change.added) unwanted.add(key);
  return [...unwanted];
}

// ---------------------------------------------------------------------------
// Purpose: what an edit kept of the creator's text
// ---------------------------------------------------------------------------

/** Sentences (and list lines) of a text, whitespace squashed. */
export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.match(/[^.!?…]+[.!?…]+["')\]]*|[^.!?…]+$/g) ?? [])
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export interface PurposePreservation {
  /** Sentences of the previous purpose */
  sentences: number;
  /** Sentences no longer there verbatim that the edit didn't name */
  lost: string[];
  /** Characters added relative to the previous purpose */
  grownBy: number;
  preserved: boolean;
}

/**
 * Whether an edit to the purpose kept the creator's text: every sentence of
 * `before` must still be in `after` verbatim, except the one sentence a
 * "replace" edit named (`target`).
 */
export function purposePreservation(
  before: string,
  after: string,
  target?: string | null,
): PurposePreservation {
  const squashedAfter = after.replace(/\s+/g, " ");
  const named = (target ?? "").replace(/\s+/g, " ").trim();
  const all = sentences(before);
  const lost = all.filter((s) => {
    if (squashedAfter.includes(s)) return false;
    // The sentence the edit set out to replace (or part of it) isn't a loss
    return !(named && (named.includes(s) || s.includes(named)));
  });
  return {
    sentences: all.length,
    lost,
    grownBy: after.trim().length - before.trim().length,
    preserved: lost.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Committee
// ---------------------------------------------------------------------------

export interface CommitteeStats {
  ops: number;
  /** Mean binary vote entropy of the ops (bits) */
  meanEntropy: number;
  /** Ops every draft agreed on (entropy 0) */
  unanimous: number;
}

export function committeeStats(
  ops: readonly Pick<DisagreementOp, "votes" | "voters">[],
): CommitteeStats {
  const entropies = ops.map((op) => voteEntropy(op.votes, op.voters));
  return {
    ops: ops.length,
    meanEntropy: mean(entropies),
    unanimous: entropies.filter((e) => e === 0).length,
  };
}

/** Share of probes whose every option already has a preview. */
export function readyPreviewShare(
  probes: readonly { options: readonly { preview?: unknown }[] }[],
): number {
  if (probes.length === 0) return 0;
  const ready = probes.filter(
    (p) => p.options.length > 0 && p.options.every((o) => !!o.preview),
  ).length;
  return ready / probes.length;
}

// ---------------------------------------------------------------------------
// Small statistics
// ---------------------------------------------------------------------------

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

/** Nearest-rank percentile (p in 0–100). */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** `part / whole`, 0 for an empty whole. */
export function share(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
