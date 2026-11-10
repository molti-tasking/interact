/**
 * Run one replay case against the real action and measure the result.
 *
 * The actions are imported as they are — same prompts, same structured
 * output schemas, same patch kernel — so a replay measures the code the app
 * runs. Only auth and tracing are stubbed (see `replay.eval.ts`).
 */

import {
  generateDesignProbesAction,
  previewDesignProbeOptionsAction,
  resolveDesignProbeAction,
  syncIntentFromFieldEditAction,
} from "@/app/actions/design-probe-actions";
import { refineSchemaFromIntentAction } from "@/app/actions/schema-actions";
import { findDisagreements, type CandidateDesign } from "interact/forms/probe-disagreement";
import {
  committeeStats,
  fieldsBeyondSummary,
  patchOpStats,
  purposePreservation,
  readyPreviewShare,
  replaySpill,
  schemaChange,
  touchedKeys,
  unmentionedChanges,
  unwantedChanges,
} from "interact/forms/replay-metrics";
import { applySchemaPatch, type PatchField, type SchemaPatch } from "interact/forms/schema-patch";
import { normalizeFieldKey } from "interact/forms/structured-intent";
import type { PortfolioSchema } from "@/lib/types";
import { withCallLog, type CallRecord } from "./call-log";
import type {
  CaseExpectation,
  GenerateProbesCase,
  PreviewCase,
  RefineCase,
  ReplayCase,
  ResolveCase,
  SyncIntentCase,
} from "./cases";

export interface CaseResult {
  id: string;
  op: ReplayCase["op"];
  source: string;
  /** For generate-probes: the strategy that was run */
  variant?: string;
  ok: boolean;
  error?: string;
  /** Wall time of the whole case */
  ms: number;
  calls: Omit<CallRecord, "output">[];
  /** Counts — see `summary.ts` for how they roll up */
  metrics: Record<string, number>;
  /** Field keys and sentences behind the counts, for reading a regression */
  details: Record<string, unknown>;
}

type Measured = Pick<CaseResult, "ok" | "error" | "metrics" | "details">;

const failed = (error: string | undefined): Measured => ({
  ok: false,
  error: error ?? "unknown error",
  metrics: {},
  details: {},
});

/** Patch measures shared by every operation that returns a schema patch. */
function patchMeasures(
  schema: PortfolioSchema,
  patch: SchemaPatch,
  expect: CaseExpectation | undefined,
) {
  const stats = patchOpStats(schema, patch);
  const { schema: after } = applySchemaPatch(schema, patch);
  const unmentioned = unmentionedChanges(schema, patch);
  const change = schemaChange(schema, after);
  const hasExpectation =
    !!expect &&
    (expect.mayChange !== undefined ||
      expect.mustKeep !== undefined ||
      expect.mayAdd !== undefined ||
      expect.noFormChange !== undefined);
  const unwanted = hasExpectation ? unwantedChanges(schema, after, expect!) : [];
  return {
    after,
    metrics: {
      ops: stats.ops,
      skippedUnknown: stats.skippedUnknown,
      skippedLocked: stats.skippedLocked,
      changedFields: touchedKeys(change).length,
      unmentionedFields: unmentioned.length,
      hasExpectation: hasExpectation ? 1 : 0,
      unwantedFields: unwanted.length,
    },
    details: {
      change,
      ...(unmentioned.length ? { unmentioned } : {}),
      ...(unwanted.length ? { unwanted } : {}),
    },
  };
}

function purposeMeasures(
  before: string,
  after: string | undefined,
  calls: CallRecord[],
  expect: CaseExpectation | undefined,
) {
  const next = after ?? before;
  // The edit the model returned — its target is the one sentence it may drop
  const edit = calls
    .map((c) => (c.output as { purposeEdit?: { op?: string; target?: string } } | undefined)?.purposeEdit)
    .find(Boolean);
  const kept = purposePreservation(before, next, edit?.op === "replace" ? edit.target : null);
  const changed = next.trim() !== before.trim();
  return {
    metrics: {
      purposeSentences: kept.sentences,
      purposeLost: kept.lost.length,
      purposePreserved: kept.preserved ? 1 : 0,
      purposeChanged: changed ? 1 : 0,
      purposeGrownBy: kept.grownBy,
      purposeExpectedUnchanged: expect?.purposeUnchanged ? 1 : 0,
      purposeUnwantedChange: expect?.purposeUnchanged && changed ? 1 : 0,
    },
    details: {
      ...(kept.lost.length ? { lostSentences: kept.lost } : {}),
      ...(edit ? { purposeEditOp: edit.op } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

/** What the recorded previews did — no model call, so also run offline. */
export function recordedPreviewMeasures(c: PreviewCase): Pick<Measured, "metrics" | "details"> {
  const metrics: Record<string, number> = {};
  const details: Record<string, unknown> = {};
  const selected = c.recorded?.options.find(
    (o) => o.value === c.recorded?.selected && o.preview,
  );
  if (!selected?.preview) return { metrics, details };

  const { schema } = c.input;
  const existing = new Set(schema.fields.map((f) => f.name));
  // An "add" whose key exists by the time of the answer overwrites that field
  const overwrites = (selected.preview.schemaPatch.addFields ?? [])
    .map((f) => f.key)
    .filter((key) => existing.has(key) && !selected.preview!.scope?.updated.includes(key));
  metrics.recordedAnswers = 1;
  metrics.recordedAddOverwrites = overwrites.length > 0 ? 1 : 0;
  if (overwrites.length) details.recordedAddOverwrites = overwrites;

  if (selected.preview.scope) {
    const spill = replaySpill(schema, selected.preview, schema);
    metrics.recordedScoped = 1;
    metrics.recordedUnscopedSpill = spill.unscoped.length > 0 ? 1 : 0;
    metrics.recordedScopedSpill = spill.scoped.length > 0 ? 1 : 0;
    if (spill.unscoped.length) details.recordedUnscopedSpill = spill.unscoped;
  }
  return { metrics, details };
}

async function runPreview(c: PreviewCase): Promise<Measured> {
  const { intent, schema, probe, laterSchema } = c.input;
  const response = await previewDesignProbeOptionsAction({ intent, currentSchema: schema, probe });
  if (!response.success || !response.options) return failed(response.error);

  const metrics: Record<string, number> = {
    options: response.options.length,
    previews: 0,
    ops: 0,
    skippedUnknown: 0,
    skippedLocked: 0,
    optionsChanging: 0,
    optionsUnmentioned: 0,
    optionsBeyondSummary: 0,
    replayed: 0,
    unscopedSpillOptions: 0,
    scopedSpillOptions: 0,
    droppedOps: 0,
  };
  const perOption: Record<string, unknown>[] = [];

  for (const option of response.options) {
    if (!option.preview) continue;
    metrics.previews++;
    const { schemaPatch, summary } = option.preview;
    const stats = patchOpStats(schema, schemaPatch);
    metrics.ops += stats.ops;
    metrics.skippedUnknown += stats.skippedUnknown;
    metrics.skippedLocked += stats.skippedLocked;

    const { schema: after } = applySchemaPatch(schema, schemaPatch);
    const touched = touchedKeys(schemaChange(schema, after));
    const unmentioned = unmentionedChanges(schema, schemaPatch);
    const beyond = fieldsBeyondSummary(summary, schema, after);
    if (touched.length > 0) metrics.optionsChanging++;
    if (unmentioned.length > 0) metrics.optionsUnmentioned++;
    if (beyond.length > 0) metrics.optionsBeyondSummary++;

    const detail: Record<string, unknown> = { value: option.value, summary, touched };
    if (unmentioned.length) detail.unmentioned = unmentioned;
    if (beyond.length) detail.beyondSummary = beyond;

    if (laterSchema && touched.length > 0) {
      const spill = replaySpill(schema, option.preview, laterSchema);
      metrics.replayed++;
      if (spill.unscoped.length > 0) metrics.unscopedSpillOptions++;
      if (spill.scoped.length > 0) metrics.scopedSpillOptions++;
      metrics.droppedOps += spill.dropped.length;
      if (spill.unscoped.length || spill.dropped.length) detail.spill = spill;
    }
    perOption.push(detail);
  }

  const recorded = recordedPreviewMeasures(c);
  return {
    ok: true,
    metrics: { ...metrics, ...recorded.metrics },
    details: { options: perOption, ...recorded.details },
  };
}

async function runResolve(c: ResolveCase, calls: CallRecord[]): Promise<Measured> {
  const { intent, schema, question, answer } = c.input;
  const response = await resolveDesignProbeAction({
    intent,
    currentSchema: schema,
    interactionText: question,
    selectedOptionLabel: answer,
    maxFollowUps: 1,
  });
  if (!response.success || !response.result) return failed(response.error);
  const patch = patchMeasures(schema, response.result.schemaPatch ?? {}, c.expect);
  const purpose = purposeMeasures(
    intent.purpose.content,
    response.result.updatedPurpose,
    calls,
    c.expect,
  );
  return {
    ok: true,
    metrics: { ...patch.metrics, ...purpose.metrics },
    details: { ...patch.details, ...purpose.details },
  };
}

async function runRefine(c: RefineCase): Promise<Measured> {
  const { previousIntent, intent, schema, decisions } = c.input;
  const response = await refineSchemaFromIntentAction({
    previousIntent,
    intent,
    currentSchema: schema,
    decisions,
  });
  if (!response.success || !response.result) return failed(response.error);
  const patch = patchMeasures(schema, response.result.schemaPatch, c.expect);
  return { ok: true, metrics: patch.metrics, details: patch.details };
}

async function runSync(c: SyncIntentCase, calls: CallRecord[]): Promise<Measured> {
  const { intent, schema, editDescription, kind } = c.input;
  const response = await syncIntentFromFieldEditAction({
    intent,
    currentSchema: schema,
    editDescription,
    kind,
  });
  if (!response.success) return failed(response.error);
  const purpose = purposeMeasures(
    intent.purpose.content,
    response.shouldUpdate ? response.updatedPurpose : undefined,
    calls,
    c.expect,
  );
  return { ok: true, metrics: purpose.metrics, details: purpose.details };
}

/** The committee's drafts, read back from the calls the action made. */
function committeeDrafts(schema: PortfolioSchema, calls: CallRecord[]): CandidateDesign[] {
  const existing = new Set(schema.fields.map((f) => f.name));
  return calls
    .filter((c) => c.functionId === "design-probe-committee")
    .map((c) => (c.output as { fields?: PatchField[] } | undefined)?.fields)
    .filter((fields): fields is PatchField[] => Array.isArray(fields))
    .map((fields) => ({
      // Same key handling as `draftCandidate` in design-probe-actions.ts
      fields: fields.slice(0, 15).map((f, i) => ({
        ...f,
        key: existing.has(f.key) ? f.key : normalizeFieldKey(f.key || f.label, `field${i + 1}`),
      })),
    }));
}

async function runGenerate(
  c: GenerateProbesCase,
  strategy: "committee" | "prompted",
  calls: CallRecord[],
): Promise<Measured> {
  const { intent, schema, existingQuestions } = c.input;
  // Read by the action when it picks its strategy; generate cases of one
  // strategy run together, never interleaved with the other (see the runner)
  process.env.PROBE_STRATEGY = strategy;
  const response = await generateDesignProbesAction(
    intent,
    5,
    undefined,
    undefined,
    schema,
    existingQuestions,
  );
  if (!response.success || !response.interactions) return failed(response.error);

  const probes = response.interactions;
  const fromCommittee = probes.filter((p) => p.source === "committee").length;
  const metrics: Record<string, number> = {
    probes: probes.length,
    readyPreviewShare: readyPreviewShare(probes),
    committeeProbes: fromCommittee,
    fellBack: strategy === "committee" && fromCommittee === 0 ? 1 : 0,
  };
  const details: Record<string, unknown> = { questions: probes.map((p) => p.text) };

  if (strategy === "committee") {
    const drafts = committeeDrafts(schema, calls);
    const ops = drafts.length >= 2 ? findDisagreements(schema, drafts) : [];
    const stats = committeeStats(ops);
    metrics.drafts = drafts.length;
    metrics.committeeOps = stats.ops;
    metrics.committeeMeanEntropy = stats.meanEntropy;
    metrics.committeeUnanimousOps = stats.unanimous;
    details.ops = ops.map(({ ref, summary, votes, voters }) => `${ref}: ${summary} (${votes}/${voters})`);
  }
  return { ok: true, metrics, details };
}

// ---------------------------------------------------------------------------

/** Run one case (one strategy for generate-probes) and time it. */
export async function executeCase(
  c: ReplayCase,
  variant?: "committee" | "prompted",
): Promise<CaseResult> {
  const started = Date.now();
  let measured: Measured;
  let calls: CallRecord[] = [];
  try {
    const run = await withCallLog((live) => {
      calls = live;
      return dispatch(c, variant, live);
    });
    measured = run.value;
  } catch (error) {
    measured = failed(error instanceof Error ? error.message : String(error));
  }
  return {
    id: c.id,
    op: c.op,
    source: c.source,
    ...(variant ? { variant } : {}),
    ...measured,
    ms: Date.now() - started,
    calls: calls.map((call) => {
      const { output, ...rest } = call;
      void output;
      return rest;
    }),
  };
}

function dispatch(
  c: ReplayCase,
  variant: "committee" | "prompted" | undefined,
  calls: CallRecord[],
): Promise<Measured> {
  switch (c.op) {
    case "preview-probe-options":
      return runPreview(c);
    case "resolve-probe":
      return runResolve(c, calls);
    case "refine-schema":
      return runRefine(c);
    case "sync-intent":
      return runSync(c, calls);
    case "generate-probes":
      return runGenerate(c, variant ?? "committee", calls);
  }
}
