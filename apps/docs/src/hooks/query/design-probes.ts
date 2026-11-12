"use client";

import { callLlm } from "@/lib/llm-client";
import {
  generateDesignProbesAction,
  type DesignProbeRaw,
} from "@/app/actions/design-probe-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange, type CommitResult } from "@/lib/engine/commit";
import { findingProbe, type Finding } from "interact/forms/findings";
import { pretestExplanation, type PretestIssue } from "interact/forms/pretest";
import { mergeSchemaChange } from "interact/forms/merge";
import {
  MAX_OPEN_PROBES,
  schemaFingerprint,
} from "interact/forms/probe-curation";
import {
  mergeOptionPreviews,
  prepareProbeOptions,
  seededRandom,
} from "interact/forms/probe-options";
import { rankProbes } from "interact/forms/probe-preview";
import { applyProbeOption } from "interact/forms/guards";
import { runPreviewTask, waitForProbePreview } from "@/lib/preview-queue";
import { answerChange } from "@/lib/engine/answer-change";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";
import { rowToDesignProbe } from "@/lib/supabase/types";
import type {
  DesignProbe,
  DesignProbeOption,
  Portfolio,
  PortfolioSchema,
  ProbeOptionPreview,
  StructuredIntent,
} from "@/lib/types";
import { trackActivity } from "@/lib/workspace-activity";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { applyCommitToCache, portfolioKey } from "./portfolios";

function designProbesKey(portfolioId: string) {
  return ["design-probes", portfolioId] as const;
}

async function fetchDesignProbes(portfolioId: string): Promise<DesignProbe[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("design_probes")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(rowToDesignProbe);
}

/**
 * Fetch persisted elicitation questions for a portfolio.
 */
export function useDesignProbes(portfolioId: string | undefined) {
  return useQuery({
    queryKey: designProbesKey(portfolioId ?? ""),
    queryFn: async (): Promise<DesignProbe[]> =>
      portfolioId ? fetchDesignProbes(portfolioId) : [],
    enabled: !!portfolioId,
  });
}

/**
 * The answers of a new question as they are stored and shown: exactly one
 * that leaves the form unchanged, in a display order drawn once, here
 * (`prepareProbeOptions`). Every insert of a question goes through this.
 *
 * `NEXT_PUBLIC_OPTION_ORDER_SEED` makes the order reproducible per question
 * text — for recorded runs and screenshots, never for a study.
 */
function storedOptions(text: string, options: readonly DesignProbeOption[]) {
  const seed = process.env.NEXT_PUBLIC_OPTION_ORDER_SEED;
  const prepared = prepareProbeOptions(options, {
    random: seed ? seededRandom(`${seed}:${text}`) : undefined,
  });
  return JSON.parse(JSON.stringify(prepared));
}

/** A new pending probe as a `design_probes` row. */
function newProbeRow(portfolioId: string, probe: DesignProbeRaw) {
  return {
    portfolio_id: portfolioId,
    text: probe.text,
    explanation: probe.explanation ?? null,
    layer: probe.layer,
    source: probe.source,
    options: storedOptions(probe.text, probe.options),
    selected_option: null,
    status: "pending",
    priority: probe.priority,
    // What each option changes is computed in the background
    // (usePrecomputeProbePreviews) — unless it came with the probe
    preview_status: probe.previewStatus ?? "pending",
    dimension_id: probe.dimensionId ?? null,
    dimension_name: probe.dimensionName ?? null,
  };
}

function answerLabel(probe: DesignProbe): string | null {
  const value = probe.selectedOption;
  if (!value) return null;
  if (value.startsWith("custom:")) return value.slice("custom:".length);
  return probe.options.find((o) => o.value === value)?.label ?? value;
}

/** Answered probes as question → answer, most recent first (for prompts). */
export function designDecisions(
  probes: readonly DesignProbe[],
  limit = 20,
): { question: string; answer: string }[] {
  return probes
    .filter((p) => p.status === "resolved")
    .sort((a, b) =>
      (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt),
    )
    .flatMap((p) => {
      const answer = answerLabel(p);
      return answer ? [{ question: p.text, answer }] : [];
    })
    .slice(0, limit);
}

/** The answered probes of a portfolio, fresh from the database. */
export async function fetchDesignDecisions(portfolioId: string) {
  return designDecisions(await fetchDesignProbes(portfolioId));
}

/**
 * Probes curation never retires: standards have their own accept/skip flow,
 * and findings from the responses or a pretest rest on data the curating
 * LLM doesn't see.
 */
const PROTECTED_SOURCES: ReadonlySet<string> = new Set(["standard", "data", "pretest"]);

/**
 * Per portfolio: the form (`schemaFingerprint`) the open probes were last
 * generated or curated against, so a change to the form triggers exactly
 * one curation pass. Module-level so it survives the deck remounting.
 */
const curatedFingerprints = new Map<string, string>();

/**
 * Generate new elicitation questions and persist them to the DB.
 * Optionally accepts an external prompt + current schema to generate
 * probes from a collaborator's perspective.
 */
export function useGenerateDesignProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
      externalPrompt,
      currentSchema,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
      externalPrompt?: string;
      currentSchema?: PortfolioSchema;
    }) => {
      // The new probes are written for this form — no curation needed for it
      if (currentSchema) {
        curatedFingerprints.set(portfolioId, schemaFingerprint(currentSchema));
      }
      const existingQuestions = (
        queryClient.getQueryData<DesignProbe[]>(designProbesKey(portfolioId)) ??
        []
      )
        .filter((p) => p.status === "pending" || p.status === "resolved")
        .map((p) => p.text);

      const result = await trackActivity(
        portfolioId,
        "Generating questions",
        () =>
          generateDesignProbesAction(
            intent,
            5,
            acceptedStandards?.length ? acceptedStandards : undefined,
            externalPrompt,
            currentSchema,
            existingQuestions.length ? existingQuestions : undefined,
          ),
      );

      if (!result.success || !result.interactions) {
        throw new Error(result.error ?? "Failed to generate elicitation questions");
      }

      // Persist to DB
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_probes")
        .insert(result.interactions.map((p) => newProbeRow(portfolioId, p)))
        .select();

      if (error) throw error;
      return (data ?? []).map(rowToDesignProbe);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Curation: keep the open probes few and current as the form changes
// ---------------------------------------------------------------------------

export interface CurateProbesResult {
  dropped: number;
  added: number;
}

/**
 * Review the open probes against the form as it is now: retire the ones
 * that no longer apply (settled, duplicated, off-purpose), re-rank the rest,
 * add new ones where something important is uncovered — and keep at most
 * `MAX_OPEN_PROBES` open. Standard probes and findings from the responses
 * are left alone (`PROTECTED_SOURCES`).
 */
export function useCurateDesignProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      currentSchema,
      mode,
    }: {
      intent: StructuredIntent;
      currentSchema: PortfolioSchema;
      /** "refine": the intent was edited; "changes": the form changed */
      mode: "refine" | "changes";
    }): Promise<CurateProbesResult> => {
      // Recorded up front, so a failed pass isn't retried until the form
      // changes again
      curatedFingerprints.set(portfolioId, schemaFingerprint(currentSchema));

      return trackActivity(portfolioId, "Updating questions", async () => {
        const probes = await fetchDesignProbes(portfolioId);
        const open = rankProbes(
          probes.filter((p) => p.status === "pending" && !PROTECTED_SOURCES.has(p.source)),
        );
        if (open.length === 0 && mode === "changes") {
          return { dropped: 0, added: 0 };
        }

        const response = await callLlm("curate-probes", {
          intent,
          currentSchema,
          openProbes: open.map((p) => ({
            id: p.id,
            text: p.text,
            priority: p.priority,
            options: p.options.map(({ value, label }) => ({ value, label })),
          })),
          decisions: designDecisions(probes),
          mode,
        });
        if (!response.success || !response.result) {
          throw new Error(response.error ?? "Failed to update the questions");
        }

        const { drop, priorities, add } = response.result;
        const supabase = createClient();

        // Only probes still open: one answered meanwhile stays answered
        if (drop.length > 0) {
          const { error } = await supabase
            .from("design_probes")
            .update({ status: "dismissed", closed_reason: "curated" })
            .in("id", drop)
            .eq("status", "pending");
          if (error) throw new Error(`Failed to retire questions: ${error.message}`);
        }
        await Promise.all(
          Object.entries(priorities).map(async ([id, priority]) => {
            const { error } = await supabase
              .from("design_probes")
              .update({ priority })
              .eq("id", id)
              .eq("status", "pending");
            if (error) {
              console.error("[design-probes] re-rank failed:", error);
            }
          }),
        );
        if (add.length > 0) {
          const { error } = await supabase
            .from("design_probes")
            .insert(add.map((p) => newProbeRow(portfolioId, p)));
          if (error) throw new Error(`Failed to add questions: ${error.message}`);
        }

        return { dropped: drop.length, added: add.length };
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/** Quiet time after a form change before the open probes are reviewed. */
const AUTO_CURATE_DELAY_MS = 4000;

/**
 * Keep the open probes current while the form changes: once the workspace
 * has been idle for a moment after a change (an answer, an edit, a fix),
 * run one curation pass. A deck that has grown past `MAX_OPEN_PROBES`
 * (e.g. from before curation existed) is trimmed on the first visit.
 */
export function useAutoCurateProbes(
  portfolio: Portfolio,
  probes: DesignProbe[] | undefined,
  /** True while other AI work runs for the portfolio, or an answer applies */
  paused: boolean,
) {
  const { mutate, isPending } = useCurateDesignProbes(portfolio.id);
  const fingerprint = schemaFingerprint(portfolio.schema);
  const loaded = probes !== undefined;
  const openCount =
    probes?.filter((p) => p.status === "pending" && !PROTECTED_SOURCES.has(p.source))
      .length ?? 0;

  const latest = useRef(portfolio);
  useEffect(() => {
    latest.current = portfolio;
  });

  useEffect(() => {
    if (!loaded || paused || isPending) return;
    const last = curatedFingerprints.get(portfolio.id);
    if (last === fingerprint) return;
    if (last === undefined && openCount <= MAX_OPEN_PROBES) {
      // First look this visit: the form as it is is the baseline
      curatedFingerprints.set(portfolio.id, fingerprint);
      return;
    }
    if (openCount === 0) return;

    const timer = setTimeout(() => {
      const { intent, schema } = latest.current;
      mutate(
        { intent, currentSchema: schema, mode: "changes" },
        {
          onSuccess: ({ dropped }) => {
            if (dropped > 0) {
              toast(
                `Removed ${dropped} question${dropped === 1 ? " that no longer applies" : "s that no longer apply"}`,
              );
            }
          },
          // Optional upkeep — the deck still works with stale questions
          onError: (err) =>
            console.warn("[design-probes] curation failed:", err),
        },
      );
    }, AUTO_CURATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [portfolio.id, fingerprint, openCount, loaded, paused, isPending, mutate]);
}

/** Throwing wrapper for design_probes status updates. */
async function updateProbeRow(
  probeId: string,
  update: Database["public"]["Tables"]["design_probes"]["Update"],
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("design_probes")
    .update(update)
    .eq("id", probeId);
  if (error) throw new Error(`Failed to update elicitation question: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Pre-computed answers: preview + instant apply
// ---------------------------------------------------------------------------

function needsPreview(probe: DesignProbe): boolean {
  return (
    probe.status === "pending" &&
    probe.source !== "standard" &&
    probe.options.length > 0 &&
    probe.previewStatus !== "ready" &&
    probe.previewStatus !== "failed"
  );
}

/** Probes whose previews were started in this tab (never re-run on their own). */
const previewsStarted = new Set<string>();
// The background queue for previews (one per tab) lives in
// `lib/preview-queue.ts`; the deck moves the open question to its front.
export { prioritizeProbePreview } from "@/lib/preview-queue";

/**
 * `(probeId) => probe | null`: waits for a preview of that probe already
 * queued or running, then returns the probe as cached (with its previews if
 * they came through). Null when there was nothing to wait for.
 */
export function useAwaitProbePreview(portfolioId: string) {
  const queryClient = useQueryClient();
  return useCallback(
    async (probeId: string): Promise<DesignProbe | null> => {
      if (!(await waitForProbePreview(probeId))) return null;
      return (
        queryClient
          .getQueryData<DesignProbe[]>(designProbesKey(portfolioId))
          ?.find((p) => p.id === probeId) ?? null
      );
    },
    [portfolioId, queryClient],
  );
}

/**
 * Work out, in the background, what each option of every open probe would
 * change — so the deck can preview an answer and apply it without an LLM
 * round trip. Also backfills probes created before previews existed.
 *
 * Each preview is computed against the portfolio as it is when the task
 * starts; patches are re-applied to the current schema when shown or
 * applied, so later changes don't invalidate them.
 */
export function usePrecomputeProbePreviews(
  portfolio: Portfolio,
  probes: DesignProbe[] | undefined,
  spacePortfolios?: { id: string; title: string }[],
) {
  const queryClient = useQueryClient();
  const latest = useRef({ portfolio, spacePortfolios });
  useEffect(() => {
    latest.current = { portfolio, spacePortfolios };
  });

  useEffect(() => {
    const key = designProbesKey(portfolio.id);
    const setOptions = (probeId: string, update: Partial<DesignProbe>) =>
      queryClient.setQueryData<DesignProbe[]>(key, (old) =>
        old?.map((p) => (p.id === probeId ? { ...p, ...update } : p)),
      );

    for (const probe of probes ?? []) {
      if (!needsPreview(probe) || previewsStarted.has(probe.id)) continue;
      previewsStarted.add(probe.id);

      runPreviewTask(async () => {
        // Answered or retired while queued — no preview needed anymore
        const cached = queryClient
          .getQueryData<DesignProbe[]>(key)
          ?.find((p) => p.id === probe.id);
        if (cached && cached.status !== "pending") {
          previewsStarted.delete(probe.id); // picked up again if reopened
          return;
        }

        const { portfolio: current, spacePortfolios: space } = latest.current;
        try {
          const response = await callLlm("preview-probe-options", {
            intent: current.intent,
            currentSchema: current.schema,
            probe: {
              text: probe.text,
              explanation: probe.explanation,
              // The unchanged answer needs no model: it changes nothing
              options: probe.options
                .filter((o) => !o.unchanged)
                .map(({ value, label }) => ({ value, label })),
            },
            spacePortfolios: space,
          });
          if (!response.success || !response.options) {
            throw new Error(response.error ?? "No previews returned");
          }
          // Onto the stored answers: their order and the unchanged answer
          // stay; a second answer that changes nothing is dropped
          const options = mergeOptionPreviews(
            probe.options,
            response.options,
            current.schema,
            { validTargetIds: (space ?? []).map((p) => p.id) },
          );
          setOptions(probe.id, { options, previewStatus: "ready" });
          await updateProbeRow(probe.id, {
            options: JSON.parse(JSON.stringify(options)),
            preview_status: "ready",
          });
        } catch (err) {
          // The answers can't be chosen without a preview: the card offers
          // "Retry previews", and a typed answer still works
          console.error("[design-probes] preview failed:", err);
          setOptions(probe.id, { previewStatus: "failed" });
          await updateProbeRow(probe.id, { preview_status: "failed" }).catch(
            () => {},
          );
        } finally {
          queryClient.invalidateQueries({ queryKey: key });
        }
      }, { probeId: probe.id, rank: [probe.priority, probe.createdAt] });
    }
  }, [portfolio.id, probes, queryClient]);
}

/** Try computing a probe's previews again after a failure. */
export function useRetryProbePreview(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (probeId: string) => {
      previewsStarted.delete(probeId);
      await updateProbeRow(probeId, { preview_status: "pending" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Apply an answer whose outcome was pre-computed: replay its schema patch on
 * the latest state (no LLM call), mark the probe resolved, and queue its
 * follow-up question. The purpose is re-synced separately by the caller.
 */
export function useApplyProbePreview(portfolioId: string) {
  const queryClient = useQueryClient();
  const key = designProbesKey(portfolioId);

  return useMutation({
    mutationFn: async ({
      probe,
      option,
      resolvedBy,
      spacePortfolios,
    }: {
      probe: DesignProbe;
      option: DesignProbeOption & { preview: ProbeOptionPreview };
      resolvedBy: string;
      spacePortfolios?: { id: string; title: string }[];
    }) => {
      const { preview } = option;
      const validTargetIds = (spacePortfolios ?? []).map((p) => p.id);

      return trackActivity(portfolioId, "Applying your answer", async () => {
        // Within the preview's scope, never on locked fields — the change
        // the creator was shown is the change that lands
        const commit = await commitPortfolioChange(
          portfolioId,
          answerChange(probe, option, resolvedBy, validTargetIds),
        );

        await updateProbeRow(probe.id, {
          status: "resolved",
          selected_option: option.value,
          resolved_at: new Date().toISOString(),
          resolved_by: resolvedBy,
        });

        let followUpId: string | null = null;
        if (preview.followUp) {
          const { data, error } = await createClient()
            .from("design_probes")
            .insert({
              portfolio_id: portfolioId,
              text: preview.followUp.text,
              explanation: null,
              layer: "both",
              source: "llm",
              options: storedOptions(preview.followUp.text, preview.followUp.options),
              selected_option: null,
              status: "pending",
              priority: 2,
              preview_status: "pending",
            })
            .select("id")
            .single();
          if (error) {
            console.error("[design-probes] follow-up insert failed:", error);
          }
          followUpId = data?.id ?? null;
        }

        return {
          commit,
          optionLabel: option.label,
          summary: preview.summary,
          followUpId,
        };
      });
    },
    // The answered card leaves the deck and the form changes right away;
    // the commit result replaces the optimistic schema when it lands.
    onMutate: async ({ probe, option, spacePortfolios }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<DesignProbe[]>(key);
      queryClient.setQueryData<DesignProbe[]>(key, (old) =>
        old?.map((p) =>
          p.id === probe.id
            ? {
                ...p,
                status: "resolved",
                selectedOption: option.value,
                resolvedAt: new Date().toISOString(),
              }
            : p,
        ),
      );

      const previousPortfolio = queryClient.getQueryData<Portfolio>(
        portfolioKey(portfolioId),
      );
      if (previousPortfolio) {
        const { schema } = applyProbeOption(
          previousPortfolio.schema,
          option.preview,
          { validTargetIds: (spacePortfolios ?? []).map((p) => p.id) },
        );
        queryClient.setQueryData(portfolioKey(portfolioId), {
          ...previousPortfolio,
          schema,
        });
      }
      return { previous, previousPortfolio };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
      if (context?.previousPortfolio) {
        queryClient.setQueryData(
          portfolioKey(portfolioId),
          context.previousPortfolio,
        );
      }
    },
    onSuccess: ({ commit }) => applyCommitToCache(queryClient, commit),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Undo an answer or fix applied from its preview: replay the inverse of its
 * schema change on the current state, reopen the probe, and withdraw the
 * follow-up question it raised (unless that was answered already). Unlike
 * `revertCommit` this still works after the purpose was re-synced.
 */
export function useUndoAppliedPreview(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      commit,
      probeId,
      followUpId,
      actor,
      label,
    }: {
      commit: CommitResult | null;
      /** The answered probe to reopen (none for conflict fixes) */
      probeId?: string;
      followUpId?: string | null;
      actor: string;
      label: string;
    }) => {
      const reverted = commit
        ? await commitPortfolioChange(portfolioId, (current) => ({
            trigger: "undo",
            schema: mergeSchemaChange(
              commit.portfolio.schema,
              commit.previous.schema,
              current.schema,
            ),
            provenance: {
              layer: "configuration",
              action: "change_reverted",
              actor,
              rationale: `Undid: ${label}`,
            },
          }))
        : null;
      if (probeId) {
        await updateProbeRow(probeId, {
          status: "pending",
          selected_option: null,
          resolved_at: null,
          resolved_by: null,
        });
      }
      if (followUpId) {
        const { error } = await createClient()
          .from("design_probes")
          .update({ status: "dismissed", closed_reason: "withdrawn" })
          .eq("id", followUpId)
          .eq("status", "pending");
        if (error) {
          console.error("[design-probes] follow-up withdraw failed:", error);
        }
      }
      return reverted;
    },
    onSuccess: (reverted) => applyCommitToCache(queryClient, reverted),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * A typed answer, previewed: what it would change on the form as it is now.
 * Nothing is written — the answer is shown with its preview on the card and
 * applied from there like any other (`useApplyProbePreview`).
 */
export function usePreviewOwnAnswer(portfolioId: string) {
  return useMutation({
    mutationFn: async ({
      probe,
      text,
      portfolio,
      spacePortfolios,
    }: {
      probe: DesignProbe;
      text: string;
      portfolio: Pick<Portfolio, "intent" | "schema">;
      spacePortfolios?: { id: string; title: string }[];
    }): Promise<DesignProbeOption & { preview: ProbeOptionPreview }> =>
      trackActivity(portfolioId, "Working out what your answer changes", async () => {
        const response = await callLlm("preview-probe-options", {
          intent: portfolio.intent,
          currentSchema: portfolio.schema,
          probe: {
            text: probe.text,
            explanation: probe.explanation,
            options: [{ value: "ownAnswer", label: text }],
          },
          spacePortfolios,
        });
        const preview = response.options?.[0]?.preview;
        if (!response.success || !preview) {
          throw new Error(response.error ?? "Couldn't work out what your answer changes");
        }
        // No follow-up from a typed answer: curation adds one if needed
        const { followUp, ...rest } = preview;
        void followUp;
        return { value: `custom:${text}`, label: text, preview: rest };
      }),
  });
}

/**
 * Ask an answered question again: it returns to the open questions with its
 * answers and previews, and the earlier answer is kept as history. The form
 * doesn't change here — it changes when the creator chooses an answer, after
 * seeing what that answer does to the form as it is now.
 */
export function useAskProbeAgain(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ probe, askedBy }: { probe: DesignProbe; askedBy: string }) =>
      updateProbeRow(probe.id, {
        status: "pending",
        selected_option: null,
        resolved_at: null,
        resolved_by: null,
        closed_reason: null,
        previous_selected_option: probe.selectedOption,
        edited_by: askedBy,
        edited_at: new Date().toISOString(),
        edit_count: (probe.editCount ?? 0) + 1,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Insert detected standards as elicitation questions (source="standard").
 * Skips standards that already have a corresponding probe in the DB.
 */
export function useInsertStandardProbes(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      standards: { standard: { id: string; name: string; description: string }; confidence: number }[],
    ) => {
      if (!standards.length) return;

      const supabase = createClient();

      // Check for existing standard probes to avoid duplicates
      const { data: existing } = await supabase
        .from("design_probes")
        .select("dimension_id")
        .eq("portfolio_id", portfolioId)
        .eq("source", "standard");

      const existingIds = new Set(
        (existing ?? []).map((r: { dimension_id: string | null }) => r.dimension_id),
      );

      const newRows = standards
        .filter((s) => !existingIds.has(s.standard.id))
        .map((s) => ({
          portfolio_id: portfolioId,
          text: `Apply standard: ${s.standard.name}?`,
          explanation: `${s.standard.description} (${Math.round(s.confidence * 100)}% confidence match)`,
          layer: "dimensions",
          source: "standard",
          options: storedOptions(`Apply standard: ${s.standard.name}?`, [
            { value: "accept", label: "Apply Standard" },
            { value: "skip", label: "Skip", unchanged: true },
          ]),
          selected_option: null,
          status: "pending",
          // Standards stay at the top of the deck, as before priorities
          priority: 1,
          dimension_id: s.standard.id,
          dimension_name: s.standard.name,
        }));

      if (!newRows.length) return;

      const { error } = await supabase
        .from("design_probes")
        .insert(newRows);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Send a finding from the response dashboard to the Design deck as a probe
 * (source "data", keyed by the finding). Its answers are computed already,
 * so they apply instantly. A finding that is already open isn't sent twice.
 */
export function useSendFindingToDeck(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      finding,
      schema,
    }: {
      finding: Finding;
      schema: PortfolioSchema;
    }): Promise<{ alreadyOpen: boolean }> => {
      const probe = findingProbe(finding, schema);
      const field = schema.fields.find((f) => f.id === finding.fieldId);
      if (!probe || !field) {
        throw new Error("This finding doesn't apply to the form anymore.");
      }

      const supabase = createClient();
      const { data: open, error: readError } = await supabase
        .from("design_probes")
        .select("id")
        .eq("portfolio_id", portfolioId)
        .eq("source", "data")
        .eq("dimension_id", finding.key)
        .in("status", ["pending", "loading"])
        .limit(1);
      if (readError) throw readError;
      if (open?.length) return { alreadyOpen: true };

      const { error } = await supabase.from("design_probes").insert({
        portfolio_id: portfolioId,
        text: probe.text,
        explanation: probe.explanation,
        layer: "dimensions",
        source: "data",
        options: storedOptions(probe.text, probe.options),
        selected_option: null,
        status: "pending",
        priority: 2,
        // Answers are computed from the form — no LLM preview needed
        preview_status: "ready",
        dimension_id: finding.key,
        dimension_name: field.label,
      });
      if (error) throw error;
      return { alreadyOpen: false };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Send an issue from a pretest (simulated respondents) to the Design deck as
 * a probe (source "pretest", keyed by the issue). When its answers are
 * already worked out they apply instantly; otherwise they are previewed in
 * the background like any other question. An issue that is already open
 * isn't sent twice.
 */
export function useSendPretestIssueToDeck(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (issue: PretestIssue): Promise<{ alreadyOpen: boolean }> => {
      const supabase = createClient();
      const { data: open, error: readError } = await supabase
        .from("design_probes")
        .select("id")
        .eq("portfolio_id", portfolioId)
        .eq("source", "pretest")
        .eq("dimension_id", issue.key)
        .in("status", ["pending", "loading"])
        .limit(1);
      if (readError) throw readError;
      if (open?.length) return { alreadyOpen: true };

      const { error } = await supabase.from("design_probes").insert({
        portfolio_id: portfolioId,
        text: issue.probe.text,
        explanation: pretestExplanation(issue),
        layer: "dimensions",
        source: "pretest",
        options: storedOptions(issue.probe.text, issue.probe.options),
        selected_option: null,
        status: "pending",
        priority: 2,
        preview_status: issue.probe.ready ? "ready" : "pending",
        dimension_id: issue.key,
        dimension_name: issue.fieldLabel,
      });
      if (error) throw error;
      return { alreadyOpen: false };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Mark a standard probe as resolved in the DB (after accept/skip is handled externally).
 */
export function useResolveStandardProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probeId,
      selectedOption,
    }: {
      probeId: string;
      selectedOption: string;
    }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("design_probes")
        .update({ status: "resolved", selected_option: selectedOption })
        .eq("id", probeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Reopen a resolved probe (after its resolution was undone).
 */
export function useReopenDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (probeId: string) =>
      updateProbeRow(probeId, {
        status: "pending",
        selected_option: null,
        resolved_at: null,
        resolved_by: null,
        closed_reason: null,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Dismiss an elicitation question.
 */
/** Why a probe left the deck unanswered (`closed_reason`, migration 012). */
type ProbeClosedReason =
  | "user"
  | "curated"
  | "stale_finding"
  | "declined"
  | "withdrawn";

export function useDismissDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    /** A probe id (dismissed by the creator), or an id with another reason */
    mutationFn: async (
      arg: string | { probeId: string; reason: ProbeClosedReason },
    ) => {
      const { probeId, reason } =
        typeof arg === "string" ? { probeId: arg, reason: "user" as const } : arg;
      const supabase = createClient();
      const { error } = await supabase
        .from("design_probes")
        .update({ status: "dismissed", closed_reason: reason })
        .eq("id", probeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}
