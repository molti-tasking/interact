"use client";

import { resolveDesignProbeAction } from "@/app/actions/design-probe-actions";
import { routeUtteranceAction } from "@/app/actions/route-utterance-actions";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { applyCommitToCache } from "@/hooks/query/portfolios";
import { invalidateResponseLists } from "@/hooks/query/responses-new";
import { commitPortfolioChange, type CommitResult } from "@/lib/engine/commit";
import { mergeIntentChange, mergeSchemaChange } from "@/lib/engine/merge";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
import { createClient } from "@/lib/supabase/client";
import type {
  PortfolioSchema,
  SchemaDiff,
  SectionKey,
  StructuredIntent,
} from "@/lib/types";
import {
  buildResponseEntry,
  dictatableFields,
  resolveReferenceFields,
  type AmbiguousReference,
  type CreatedReference,
  type ReferenceIO,
  type ValueIssue,
} from "@/lib/voice/data-entry";
import {
  referenceEntryFieldName,
  referenceLabelFor,
  type ReferenceCandidate,
} from "@/lib/voice/reference-resolution";
import { trackActivity } from "@/lib/workspace-activity";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

export type UtteranceEventKind = "processing" | "result" | "system" | "error";

export interface UtteranceState {
  intent: StructuredIntent;
  schema: PortfolioSchema;
  /**
   * Portfolio revision this state was read at. Lets `sync` adopt newer
   * server state even while utterances are queued.
   */
  revision?: number;
}

interface ProcessParams {
  text: string;
  /** Review-mode utterances are applied through the smart path once confirmed. */
  mode: "append" | "smart";
  actor: string;
  onEvent: (kind: UtteranceEventKind, text: string) => void;
  /**
   * Fired whenever an utterance produces a new schema, with the field-level
   * diff and the strategy that produced it. Drives the ambient water animation
   * in record mode; optional so non-visual callers can ignore it.
   */
  onSchemaChange?: (diff: SchemaDiff, strategyKind: string) => void;
  /** A schema/intent change was committed (e.g. to offer Undo). */
  onCommit?: (result: CommitResult, label: string) => void;
}

export interface SiblingPortfolio {
  id: string;
  title: string;
}

/** Thrown inside a job when the processor was cancelled meanwhile. */
class UtteranceCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "UtteranceCancelled";
  }
}

/** Cancellation guard of one queued utterance. */
interface Job {
  isActive: () => boolean;
  /** Throws `UtteranceCancelled` once the processor was cancelled. */
  assertActive: () => void;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

function describeIssue(issue: ValueIssue, label: string): string {
  switch (issue.reason) {
    case "unparsed":
      return `couldn't read "${issue.value}" for ${label} — left it empty`;
    case "not-an-option":
      return `"${issue.value}" isn't an option of ${label} — kept as said`;
    case "unparsed-date":
      return `"${issue.value}" isn't a recognizable date for ${label} — kept as said`;
    case "clamped":
      return `${label} "${issue.value}" was outside the scale — set to the nearest end`;
    case "unsupported":
      return `${label} can't be filled by voice`;
  }
}

/**
 * Serialized voice-utterance processor for record mode.
 *
 * All utterances flow through a single promise chain, so a phrase spoken
 * while the previous one is still processing is queued instead of racing it.
 * Each utterance is interpreted against a snapshot of the freshest known
 * state; schema/intent writes go through `commitPortfolioChange` with a
 * three-way merge (snapshot → our result, replayed onto the database state),
 * so edits made meanwhile in another tab or by another user are kept.
 *
 * `cancel()` (also run on unmount) drops queued utterances; results of LLM
 * calls already in flight are discarded instead of applied.
 */
export function useUtteranceProcessor(
  portfolioId: string,
  initialState: UtteranceState,
  options?: {
    /**
     * Other portfolios in the same space — candidate targets for reference
     * fields when a dictated schema edit links this table to another.
     */
    siblings?: SiblingPortfolio[];
  },
) {
  const pipeline = usePipelineGenerate(portfolioId);
  const queryClient = useQueryClient();

  // Ref mirror so callbacks stay referentially stable across re-renders.
  const siblings = options?.siblings;
  const siblingsRef = useRef<SiblingPortfolio[]>(siblings ?? []);
  useEffect(() => {
    siblingsRef.current = siblings ?? [];
  }, [siblings]);

  // Freshest known intent+schema: from sync() and completed work.
  const stateRef = useRef<UtteranceState>(initialState);
  // Tail of the processing chain — new utterances append here.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // Bumped by cancel(); jobs from an older epoch are dropped.
  const epochRef = useRef(0);
  // Ref mirror of the queue length so sync() can check it without re-renders.
  const queueLengthRef = useRef(0);
  const [queueLength, setQueueLength] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Adopt external state (e.g. a fresh portfolio fetch): always when idle,
   * and while busy whenever it is a newer revision than what we hold —
   * queued utterances then start from it. (Jobs already running keep their
   * own snapshot; their commits merge onto whatever is current.)
   */
  const sync = useCallback((state: UtteranceState) => {
    const current = stateRef.current;
    const newer =
      state.revision != null &&
      (current.revision == null || state.revision > current.revision);
    if (queueLengthRef.current === 0 || newer) {
      stateRef.current = state;
    }
  }, []);

  /** Adopt a committed portfolio unless something newer was synced meanwhile. */
  const adoptCommitted = useCallback((result: CommitResult) => {
    const { portfolio } = result;
    const current = stateRef.current;
    if (current.revision == null || portfolio.revision >= current.revision) {
      stateRef.current = {
        intent: portfolio.intent,
        schema: portfolio.schema,
        revision: portfolio.revision,
      };
    }
  }, []);

  const applyIntentSections = useCallback(
    (
      base: StructuredIntent,
      sections: { section: SectionKey; mergedContent: string }[],
    ) => {
      const now = new Date().toISOString();
      const next: StructuredIntent = { ...base };
      for (const { section, mergedContent } of sections) {
        next[section] = { content: mergedContent, updatedAt: now };
      }
      return next;
    },
    [],
  );

  /** Run the intent pipeline from `base` to `nextIntent` and report it. */
  const runPipeline = useCallback(
    async (
      params: ProcessParams,
      base: UtteranceState,
      nextIntent: StructuredIntent,
      job: Job,
    ) => {
      job.assertActive();
      const result = await pipeline.mutateAsync({
        previousIntent: base.intent,
        currentIntent: nextIntent,
        currentSchema: base.schema,
        actor: params.actor,
      });
      job.assertActive();

      // The pipeline writes the portfolio itself. Keep the old revision so
      // the refetch it triggers (newer revision) is adopted by sync().
      stateRef.current = {
        intent: result.intent,
        schema: result.schema ?? base.schema,
        revision: base.revision,
      };

      if (result.schema) {
        params.onSchemaChange?.(
          diffSchemas(base.schema, result.schema),
          result.strategy.kind,
        );
      }

      if (result.strategy.kind === "noop") {
        params.onEvent("system", "No changes detected.");
      } else {
        const fieldCount = result.schema?.fields.length;
        params.onEvent(
          "result",
          fieldCount != null
            ? `Form updated (${result.strategy.kind}) — now ${plural(fieldCount, "field", "fields")}.`
            : `Intent updated (${result.strategy.kind}).`,
        );
      }
    },
    [pipeline],
  );

  const runAppend = useCallback(
    async (params: ProcessParams, job: Job): Promise<void> => {
      const base = stateRef.current;
      const nextIntent: StructuredIntent = {
        ...base.intent,
        purpose: {
          content: base.intent.purpose.content
            ? `${base.intent.purpose.content}\n\n${params.text}`
            : params.text,
          updatedAt: new Date().toISOString(),
        },
      };

      params.onEvent("processing", "Updating the form from what you said…");
      await runPipeline(params, base, nextIntent, job);
    },
    [runPipeline],
  );

  const runSchemaEdit = useCallback(
    async (
      params: ProcessParams,
      base: UtteranceState,
      job: Job,
    ): Promise<void> => {
      const response = await resolveDesignProbeAction({
        intent: base.intent,
        currentSchema: base.schema,
        interactionText: "The user dictated a direct edit to the form",
        selectedOptionLabel: params.text,
        maxFollowUps: 0,
        spacePortfolios: siblingsRef.current,
      });
      job.assertActive();

      if (!response.success || !response.result) {
        throw new Error(response.error ?? "Failed to apply the dictated edit");
      }

      const ourIntent: StructuredIntent = response.result.updatedPurpose
        ? {
            ...base.intent,
            purpose: {
              content: sanitizePurposeText(response.result.updatedPurpose),
              updatedAt: new Date().toISOString(),
            },
          }
        : base.intent;
      const ourSchema = response.result.artifactFormSchema;

      // Replay only what this edit changed (snapshot → ours) onto the
      // current database state, so concurrent edits survive.
      let cancelled = false;
      const result = await commitPortfolioChange(portfolioId, (current) => {
        if (!job.isActive()) {
          cancelled = true;
          return null;
        }
        return {
          schema: mergeSchemaChange(base.schema, ourSchema, current.schema),
          intent: mergeIntentChange(base.intent, ourIntent, current.intent),
          provenance: {
            layer: "configuration",
            action: "voice_edit",
            actor: params.actor,
            rationale: params.text,
          },
        };
      });
      if (cancelled || !result) throw new UtteranceCancelled();

      applyCommitToCache(queryClient, result);
      adoptCommitted(result);

      const editDiff = diffSchemas(result.previous.schema, result.portfolio.schema);
      params.onSchemaChange?.(editDiff, "voice_edit");
      params.onCommit?.(result, `Voice edit: “${params.text}”`);
      const fieldCount = result.portfolio.schema.fields.length;
      params.onEvent(
        "result",
        `Edit applied — now ${plural(fieldCount, "field", "fields")}.`,
      );
    },
    [adoptCommitted, portfolioId, queryClient],
  );

  const runDataEntry = useCallback(
    async (
      params: ProcessParams,
      base: UtteranceState,
      records: { values: { field: string; value: string }[] }[],
      job: Job,
    ): Promise<void> => {
      const supabase = createClient();
      const labelOf = new Map(
        dictatableFields(base.schema).map((f) => [f.key, f.label]),
      );
      const label = (key: string) => labelOf.get(key) ?? key;

      const built = records
        .map((r) => buildResponseEntry(base.schema, r.values))
        .filter((entry) => Object.keys(entry.data).length > 0);

      if (built.length === 0) {
        params.onEvent(
          "system",
          "Heard values, but none matched the form's fields.",
        );
        return;
      }

      // Reference resolution: spoken labels in reference fields become links
      // to rows of the target portfolio. Per-batch caches so several records
      // in one utterance share target fetches, and a row created for one
      // record is matchable by the next.
      const hasReferences = dictatableFields(base.schema).some(
        (f) => f.field.type.kind === "reference",
      );
      const targets = new Map<
        string,
        { title: string; schema: PortfolioSchema } | null
      >();
      const candidateCache = new Map<string, ReferenceCandidate[]>();
      const touchedTargets = new Set<string>();
      const createdRefs: CreatedReference[] = [];
      const ambiguousRefs: AmbiguousReference[] = [];

      const targetFor = async (targetId: string) => {
        if (!targets.has(targetId)) {
          const { data, error } = await supabase
            .from("portfolios")
            .select("id, title, schema")
            .eq("id", targetId)
            .single();
          targets.set(
            targetId,
            error || !data
              ? null
              : {
                  title: data.title,
                  schema: data.schema as unknown as PortfolioSchema,
                },
          );
        }
        return targets.get(targetId) ?? null;
      };

      const io: ReferenceIO = {
        candidatesFor: async (targetId, displayFieldName) => {
          const cacheKey = `${targetId}:${displayFieldName ?? ""}`;
          const cached = candidateCache.get(cacheKey);
          if (cached) return cached;

          const target = await targetFor(targetId);
          if (!target) {
            candidateCache.set(cacheKey, []);
            return [];
          }

          const { data, error } = await supabase
            .from("responses")
            .select("id, data")
            .eq("portfolio_id", targetId);
          if (error) throw error;

          const candidates = (data ?? [])
            .map((row) => {
              const rowLabel = referenceLabelFor(
                target.schema,
                (row.data ?? {}) as Record<string, unknown>,
                displayFieldName,
              );
              return rowLabel ? { responseId: row.id, label: rowLabel } : null;
            })
            .filter((c): c is ReferenceCandidate => c !== null);
          candidateCache.set(cacheKey, candidates);
          return candidates;
        },
        createTarget: async (targetId, spokenLabel, displayFieldName) => {
          job.assertActive();
          const target = await targetFor(targetId);
          if (!target) return null;

          const entryField = referenceEntryFieldName(
            target.schema,
            displayFieldName,
          );
          if (!entryField) return null;

          const { data, error } = await supabase
            .from("responses")
            .insert({
              portfolio_id: targetId,
              data: { [entryField]: spokenLabel },
            })
            .select()
            .single();
          if (error) throw error;

          touchedTargets.add(targetId);
          const candidate: ReferenceCandidate = {
            responseId: data.id,
            label: spokenLabel,
          };
          candidateCache
            .get(`${targetId}:${displayFieldName ?? ""}`)
            ?.push(candidate);
          return candidate;
        },
      };

      const resolvedRows: Record<string, unknown>[] = [];
      for (const entry of built) {
        if (!hasReferences) {
          resolvedRows.push(entry.data);
          continue;
        }
        const resolved = await resolveReferenceFields(
          base.schema,
          entry.data,
          io,
        );
        createdRefs.push(...resolved.created);
        ambiguousRefs.push(...resolved.ambiguous);
        resolvedRows.push(resolved.data);
      }

      job.assertActive();
      const rows = resolvedRows.map((data) => ({
        portfolio_id: portfolioId,
        data: JSON.parse(JSON.stringify(data)),
      }));

      const { error } = await supabase.from("responses").insert(rows);
      if (error) throw error;

      // Also refreshes derived tables that show these rows as parent rows.
      invalidateResponseLists(queryClient, [portfolioId, ...touchedTargets]);

      for (const ref of createdRefs) {
        const title = targets.get(ref.targetPortfolioId)?.title;
        params.onEvent(
          "system",
          `"${ref.candidate.label}" wasn't in ${title ? `"${title}"` : "the linked table"} yet — added it and linked the entry.`,
        );
      }
      for (const ref of ambiguousRefs) {
        const options = ref.candidates
          .slice(0, 3)
          .map((c) => `"${c.label}"`)
          .join(", ");
        params.onEvent(
          "system",
          `"${ref.spoken}" for ${label(ref.field)} matches several entries (${options}${ref.candidates.length > 3 ? ", …" : ""}) — kept it as text; link it under Responses.`,
        );
      }

      built.forEach((entry, i) => {
        const prefix = built.length > 1 ? `Entry ${i + 1}: ` : "";
        const notes = entry.issues.map((issue) =>
          describeIssue(issue, label(issue.field)),
        );
        if (entry.missingRequired.length > 0) {
          notes.push(
            `missing required ${entry.missingRequired.map(label).join(", ")}`,
          );
        }
        if (notes.length > 0) {
          params.onEvent("system", `${prefix}${notes.join("; ")}.`);
        }
      });

      params.onEvent(
        "result",
        `Recorded ${plural(rows.length, "entry", "entries")} — see them under Responses.`,
      );
    },
    [portfolioId, queryClient],
  );

  const runSmart = useCallback(
    async (params: ProcessParams, job: Job): Promise<void> => {
      const base = stateRef.current;
      params.onEvent("processing", "Interpreting what you said…");

      const routed = await routeUtteranceAction(
        base.intent,
        base.schema,
        params.text,
      );
      job.assertActive();

      if (!routed.success) {
        // Graceful degradation: fall back to the append baseline
        params.onEvent(
          "system",
          "Couldn't interpret the phrase — appending it as-is.",
        );
        await runAppend(params, job);
        return;
      }

      if (routed.summary) params.onEvent("system", routed.summary);

      if (routed.route === "schemaEdit") {
        params.onEvent("processing", "Applying the edit to the form…");
        await runSchemaEdit(params, base, job);
        return;
      }

      if (routed.route === "dataEntry") {
        params.onEvent("processing", "Recording the values…");
        await runDataEntry(params, base, routed.records ?? [], job);
        return;
      }

      if (!routed.sections?.length) {
        params.onEvent("system", "Nothing to change from that phrase.");
        return;
      }

      const nextIntent = applyIntentSections(base.intent, routed.sections);
      const sectionNames = routed.sections.map((s) => s.section).join(", ");
      params.onEvent("processing", `Updating ${sectionNames}…`);
      await runPipeline(params, base, nextIntent, job);
    },
    [applyIntentSections, runAppend, runDataEntry, runPipeline, runSchemaEdit],
  );

  /**
   * Enqueue an utterance. Returns immediately; processing is serialized so
   * utterances always apply in the order they were spoken.
   */
  const enqueue = useCallback(
    (params: ProcessParams) => {
      const epoch = epochRef.current;
      const job: Job = {
        isActive: () => epochRef.current === epoch,
        assertActive: () => {
          if (epochRef.current !== epoch) throw new UtteranceCancelled();
        },
      };

      queueLengthRef.current += 1;
      setQueueLength(queueLengthRef.current);
      setIsProcessing(true);

      chainRef.current = chainRef.current
        .then(async () => {
          job.assertActive();
          await trackActivity(portfolioId, "Applying dictation", () =>
            params.mode === "append"
              ? runAppend(params, job)
              : runSmart(params, job),
          );
        })
        .catch((err) => {
          if (err instanceof UtteranceCancelled) return;
          if (epochRef.current !== epoch) return;
          params.onEvent(
            "error",
            err instanceof Error ? err.message : "Failed to update the form.",
          );
        })
        .finally(() => {
          queueLengthRef.current -= 1;
          setQueueLength(queueLengthRef.current);
          if (queueLengthRef.current === 0) setIsProcessing(false);
        });
    },
    [portfolioId, runAppend, runSmart],
  );

  /**
   * Drop queued utterances and ignore the results of any still in flight
   * (LLM calls can't be aborted, but nothing they return is applied).
   */
  const cancel = useCallback(() => {
    epochRef.current += 1;
  }, []);

  // Leaving record mode cancels whatever is still queued.
  useEffect(() => cancel, [cancel]);

  return { enqueue, sync, cancel, isProcessing, queueLength };
}
