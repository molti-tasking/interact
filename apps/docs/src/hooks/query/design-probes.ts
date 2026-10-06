"use client";

import {
  generateDesignProbesAction,
  previewDesignProbeOptionsAction,
  resolveDesignProbeAction,
} from "@/app/actions/design-probe-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange, type CommitResult } from "@/lib/engine/commit";
import { mergeIntentChange, mergeSchemaChange } from "@/lib/engine/merge";
import { applySchemaPatch } from "@/lib/engine/schema-patch";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
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
import { useEffect, useRef } from "react";
import { applyCommitToCache, portfolioKey } from "./portfolios";

function designProbesKey(portfolioId: string) {
  return ["design-probes", portfolioId] as const;
}

/**
 * Fetch persisted design probes for a portfolio.
 */
export function useDesignProbes(portfolioId: string | undefined) {
  return useQuery({
    queryKey: designProbesKey(portfolioId ?? ""),
    queryFn: async (): Promise<DesignProbe[]> => {
      if (!portfolioId) return [];
      const supabase = createClient();
      const { data, error } = await supabase
        .from("design_probes")
        .select("*")
        .eq("portfolio_id", portfolioId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data ?? []).map(rowToDesignProbe);
    },
    enabled: !!portfolioId,
  });
}

/**
 * Generate new design probes and persist them to the DB.
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
      const result = await trackActivity(
        portfolioId,
        "Generating questions",
        () =>
          generateDesignProbesAction(
            intent,
            5,
            undefined,
            acceptedStandards?.length ? acceptedStandards : undefined,
            externalPrompt,
            currentSchema,
          ),
      );

      if (!result.success || !result.interactions) {
        throw new Error(result.error ?? "Failed to generate design probes");
      }

      // Persist to DB
      const supabase = createClient();
      const rows = result.interactions.map((interaction) => ({
        portfolio_id: portfolioId,
        text: interaction.text,
        explanation: interaction.explanation ?? null,
        layer: interaction.layer,
        source: interaction.source,
        options: JSON.parse(JSON.stringify(interaction.options)),
        selected_option: null,
        status: "pending",
        priority: interaction.priority,
        // What each option changes is computed in the background
        // (usePrecomputeProbePreviews)
        preview_status: "pending",
        dimension_id: interaction.dimensionId ?? null,
        dimension_name: interaction.dimensionName ?? null,
      }));

      const { data, error } = await supabase
        .from("design_probes")
        .insert(rows)
        .select();

      if (error) throw error;
      return (data ?? []).map(rowToDesignProbe);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

type ResolveResult = NonNullable<
  Awaited<ReturnType<typeof resolveDesignProbeAction>>["result"]
>;

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
  if (error) throw new Error(`Failed to update design probe: ${error.message}`);
}

/**
 * Commit a probe resolution. The LLM result was computed from `snapshot`;
 * the commit replays only what it changed on top of the current DB state, so
 * edits made while the LLM was thinking survive.
 */
async function commitResolution(
  portfolioId: string,
  snapshot: ProbeSnapshot,
  result: ResolveResult,
  provenance: { action: string; actor: string; rationale: string },
): Promise<{ commit: CommitResult | null; newIntent: StructuredIntent }> {
  // Replace purpose with the LLM's coherent rewrite (falls back to append if missing)
  const newPurpose = result.updatedPurpose
    ? sanitizePurposeText(result.updatedPurpose)
    : snapshot.intent.purpose.content.trimEnd() + "\n" + result.refinementDelta;

  const ourIntent: StructuredIntent = {
    ...snapshot.intent,
    purpose: { content: newPurpose, updatedAt: new Date().toISOString() },
  };

  const commit = await commitPortfolioChange(portfolioId, (current) => ({
    schema: mergeSchemaChange(
      snapshot.schema,
      result.artifactFormSchema,
      current.schema,
    ),
    intent: mergeIntentChange(snapshot.intent, ourIntent, current.intent),
    provenance: { layer: "dimensions", ...provenance },
  }));

  return { commit, newIntent: commit?.portfolio.intent ?? ourIntent };
}

function optionLabelFor(probe: DesignProbe, selectedValue: string): string {
  if (selectedValue.startsWith("custom:")) {
    return selectedValue.slice("custom:".length);
  }
  const option = probe.options.find((o) => o.value === selectedValue);
  if (!option) throw new Error("Invalid option selected");
  return option.label;
}

/** The portfolio state the user was looking at when they chose an option. */
export interface ProbeSnapshot {
  intent: StructuredIntent;
  schema: PortfolioSchema;
}

/**
 * Resolve a design probe: call LLM, commit schema/intent changes (merged onto
 * the latest state), persist status change and any follow-ups.
 */
export function useResolveDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probe,
      selectedValue,
      snapshot,
      resolvedBy,
      spacePortfolios,
    }: {
      probe: DesignProbe;
      selectedValue: string;
      snapshot: ProbeSnapshot;
      resolvedBy: string;
      spacePortfolios?: { id: string; title: string }[];
    }) => {
      const optionLabel = optionLabelFor(probe, selectedValue);

      return trackActivity(portfolioId, "Applying your answer", async () => {
        await updateProbeRow(probe.id, {
          status: "loading",
          selected_option: selectedValue,
        });

        let committed: Awaited<ReturnType<typeof commitResolution>>;
        try {
          const response = await resolveDesignProbeAction({
            intent: snapshot.intent,
            currentSchema: snapshot.schema,
            interactionText: probe.text,
            selectedOptionLabel: optionLabel,
            maxFollowUps: 3,
            spacePortfolios,
          });

          if (!response.success || !response.result) {
            throw new Error(response.error ?? "Failed to resolve design probe");
          }

          committed = await commitResolution(
            portfolioId,
            snapshot,
            response.result,
            {
              action: "design_probe_resolved",
              actor: resolvedBy,
              rationale: `"${probe.text}" → "${optionLabel}"`,
            },
          );

          await updateProbeRow(probe.id, {
            status: "resolved",
            selected_option: selectedValue,
            resolved_at: new Date().toISOString(),
            resolved_by: resolvedBy,
          });

          // Insert follow-ups
          if (response.result.followUpInteractions?.length) {
            const followUpRows = response.result.followUpInteractions.map(
              (f) => ({
                portfolio_id: portfolioId,
                text: f.text,
                explanation: f.explanation ?? null,
                layer: f.layer,
                source: f.source,
                options: JSON.parse(JSON.stringify(f.options)),
                selected_option: null,
                status: "pending",
                priority: f.priority,
                preview_status: "pending",
                dimension_id: f.dimensionId ?? null,
                dimension_name: f.dimensionName ?? null,
              }),
            );
            const { error } = await createClient()
              .from("design_probes")
              .insert(followUpRows);
            if (error) {
              console.error("[design-probes] follow-up insert failed:", error);
            }
          }
        } catch (err) {
          // Never leave the probe stuck in "loading" (it would vanish from
          // both the pending deck and the resolved stack).
          await updateProbeRow(probe.id, {
            status: "pending",
            selected_option: null,
          }).catch(() => {});
          throw err;
        }

        return { ...committed, optionLabel };
      });
    },
    onSuccess: ({ commit }) => applyCommitToCache(queryClient, commit),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
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
const MAX_CONCURRENT_PREVIEWS = 3;
let previewsRunning = 0;
const previewQueue: (() => Promise<void>)[] = [];

function runPreviewTask(task: () => Promise<void>) {
  previewQueue.push(task);
  const next = () => {
    while (previewsRunning < MAX_CONCURRENT_PREVIEWS && previewQueue.length) {
      const run = previewQueue.shift()!;
      previewsRunning++;
      void run().finally(() => {
        previewsRunning--;
        next();
      });
    }
  };
  next();
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
        const { portfolio: current, spacePortfolios: space } = latest.current;
        try {
          const response = await previewDesignProbeOptionsAction({
            intent: current.intent,
            currentSchema: current.schema,
            probe: {
              text: probe.text,
              explanation: probe.explanation,
              options: probe.options.map(({ value, label }) => ({
                value,
                label,
              })),
            },
            spacePortfolios: space,
          });
          if (!response.success || !response.options) {
            throw new Error(response.error ?? "No previews returned");
          }
          setOptions(probe.id, {
            options: response.options,
            previewStatus: "ready",
          });
          await updateProbeRow(probe.id, {
            options: JSON.parse(JSON.stringify(response.options)),
            preview_status: "ready",
          });
        } catch (err) {
          // Answering still works: options without a preview fall back to
          // resolving the answer with the LLM.
          console.error("[design-probes] preview failed:", err);
          setOptions(probe.id, { previewStatus: "failed" });
          await updateProbeRow(probe.id, { preview_status: "failed" }).catch(
            () => {},
          );
        } finally {
          queryClient.invalidateQueries({ queryKey: key });
        }
      });
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
        const commit = await commitPortfolioChange(portfolioId, (current) => {
          const { schema, applied } = applySchemaPatch(
            current.schema,
            preview.schemaPatch,
            { validTargetIds },
          );
          const changed =
            applied.added.length +
              applied.updated.length +
              applied.removed.length >
            0;
          if (!changed) return null;
          return {
            schema,
            provenance: {
              layer: "dimensions",
              action: "design_probe_resolved",
              actor: resolvedBy,
              rationale: `"${probe.text}" → "${option.label}"`,
            },
          };
        });

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
              options: JSON.parse(JSON.stringify(preview.followUp.options)),
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
        const { schema } = applySchemaPatch(
          previousPortfolio.schema,
          option.preview.schemaPatch,
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
          .update({ status: "dismissed" })
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
 * Re-resolve an already-resolved design probe with a different answer.
 * Updates edit history metadata, then runs resolution from the current state.
 */
export function useReResolveDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      probe,
      newSelectedValue,
      snapshot,
      editedBy,
      spacePortfolios,
    }: {
      probe: DesignProbe;
      newSelectedValue: string;
      snapshot: ProbeSnapshot;
      editedBy: string;
      spacePortfolios?: { id: string; title: string }[];
    }) => {
      const optionLabel = optionLabelFor(probe, newSelectedValue);

      return trackActivity(portfolioId, "Revising a decision", async () => {
        // Store previous answer and update edit metadata
        await updateProbeRow(probe.id, {
          status: "loading",
          previous_selected_option: probe.selectedOption,
          edited_by: editedBy,
          edited_at: new Date().toISOString(),
          edit_count: (probe.editCount ?? 0) + 1,
        });

        try {
          const response = await resolveDesignProbeAction({
            intent: snapshot.intent,
            currentSchema: snapshot.schema,
            interactionText: probe.text,
            selectedOptionLabel: optionLabel,
            maxFollowUps: 0, // No follow-ups on re-edits
            spacePortfolios,
          });

          if (!response.success || !response.result) {
            throw new Error(
              response.error ?? "Failed to re-resolve design probe",
            );
          }

          const committed = await commitResolution(
            portfolioId,
            snapshot,
            response.result,
            {
              action: "design_probe_re_resolved",
              actor: editedBy,
              rationale: `Re-edited: "${probe.text}" → "${optionLabel}" (was: "${probe.selectedOption}")`,
            },
          );

          await updateProbeRow(probe.id, {
            status: "resolved",
            selected_option: newSelectedValue,
            resolved_at: new Date().toISOString(),
            resolved_by: editedBy,
          });

          return { ...committed, optionLabel };
        } catch (err) {
          // Revert to resolved with previous answer
          await updateProbeRow(probe.id, {
            status: "resolved",
            edited_at: probe.editedAt ?? null,
            edited_by: probe.editedBy ?? null,
            edit_count: probe.editCount ?? 0,
            previous_selected_option: probe.previousSelectedOption ?? null,
          }).catch(() => {});
          throw err;
        }
      });
    },
    onSuccess: ({ commit }) => applyCommitToCache(queryClient, commit),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Insert detected standards as design probes (source="standard").
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
          options: JSON.parse(
            JSON.stringify([
              { value: "accept", label: "Apply Standard" },
              { value: "skip", label: "Skip" },
            ]),
          ),
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
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Put a probe's previous answer back (after a re-resolution was undone).
 */
export function useRestoreProbeAnswer(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (probe: DesignProbe) =>
      updateProbeRow(probe.id, {
        status: "resolved",
        selected_option: probe.selectedOption,
        previous_selected_option: probe.previousSelectedOption ?? null,
        edited_at: probe.editedAt ?? null,
        edited_by: probe.editedBy ?? null,
        edit_count: probe.editCount ?? 0,
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}

/**
 * Dismiss a design probe.
 */
export function useDismissDesignProbe(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (probeId: string) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("design_probes")
        .update({ status: "dismissed" })
        .eq("id", probeId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: designProbesKey(portfolioId) });
    },
  });
}
