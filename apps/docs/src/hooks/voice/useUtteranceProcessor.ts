"use client";

import { resolveDesignProbeAction } from "@/app/actions/design-probe-actions";
import { routeUtteranceAction } from "@/app/actions/route-utterance-actions";
import { logProvenance } from "@/lib/engine/provenance";
import { diffSchemas } from "@/lib/engine/schema-ops";
import { sanitizePurposeText } from "@/lib/engine/structured-intent";
import { usePipelineGenerate } from "@/hooks/query/pipeline";
import { createClient } from "@/lib/supabase/client";
import { buildResponseData } from "@/lib/voice/data-entry";
import type {
  PortfolioSchema,
  SchemaDiff,
  SectionKey,
  StructuredIntent,
} from "@/lib/types";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

export type UtteranceEventKind = "processing" | "result" | "system" | "error";

export interface UtteranceState {
  intent: StructuredIntent;
  schema: PortfolioSchema;
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
}

/**
 * Serialized voice-utterance processor for record mode.
 *
 * All utterances flow through a single promise chain, so a phrase spoken
 * while the previous one is still processing is queued instead of racing it
 * (each utterance builds on the state the previous one produced — nothing is
 * silently dropped). `sync` refreshes the base state from the server between
 * external changes; queued work always continues from the freshest result.
 */
export function useUtteranceProcessor(
  portfolioId: string,
  initialState: UtteranceState,
) {
  const pipeline = usePipelineGenerate(portfolioId);
  const queryClient = useQueryClient();

  // Freshest known intent+schema; only mutated by sync() and completed work.
  const stateRef = useRef<UtteranceState>(initialState);
  // Tail of the processing chain — new utterances append here.
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  // Ref mirror of the queue length so sync() can check it without re-renders.
  const queueLengthRef = useRef(0);
  const [queueLength, setQueueLength] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);

  /**
   * Adopt external state (e.g. a fresh portfolio fetch). Ignored while work
   * is queued or running — in-flight results are always fresher.
   */
  const sync = useCallback((state: UtteranceState) => {
    if (queueLengthRef.current === 0) {
      stateRef.current = state;
    }
  }, []);

  const applyIntentSections = useCallback(
    (base: StructuredIntent, sections: { section: SectionKey; mergedContent: string }[]) => {
      const now = new Date().toISOString();
      const next: StructuredIntent = { ...base };
      for (const { section, mergedContent } of sections) {
        next[section] = { content: mergedContent, updatedAt: now };
      }
      return next;
    },
    [],
  );

  const runAppend = useCallback(
    async (params: ProcessParams): Promise<void> => {
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
      const result = await pipeline.mutateAsync({
        previousIntent: base.intent,
        currentIntent: nextIntent,
        currentSchema: base.schema,
        actor: params.actor,
      });

      stateRef.current = {
        intent: result.intent,
        schema: result.schema ?? base.schema,
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
            ? `Form updated (${result.strategy.kind}) — now ${fieldCount} field${fieldCount === 1 ? "" : "s"}.`
            : `Intent updated (${result.strategy.kind}).`,
        );
      }
    },
    [pipeline],
  );

  const runSchemaEdit = useCallback(
    async (params: ProcessParams): Promise<void> => {
      const base = stateRef.current;
      const response = await resolveDesignProbeAction({
        intent: base.intent,
        currentSchema: base.schema,
        interactionText: "The user dictated a direct edit to the form",
        selectedOptionLabel: params.text,
        maxFollowUps: 0,
      });

      if (!response.success || !response.result) {
        throw new Error(response.error ?? "Failed to apply the dictated edit");
      }

      const newIntent: StructuredIntent = {
        ...base.intent,
        purpose: {
          content: response.result.updatedPurpose
            ? sanitizePurposeText(response.result.updatedPurpose)
            : base.intent.purpose.content,
          updatedAt: new Date().toISOString(),
        },
      };
      const newSchema = response.result.artifactFormSchema;
      const editDiff = diffSchemas(base.schema, newSchema);

      const supabase = createClient();
      const { error } = await supabase
        .from("portfolios")
        .update({
          intent: JSON.parse(JSON.stringify(newIntent)),
          schema: JSON.parse(JSON.stringify(newSchema)),
          updated_at: new Date().toISOString(),
        })
        .eq("id", portfolioId);
      if (error) throw error;

      await logProvenance(
        portfolioId,
        "configuration",
        "voice_edit",
        params.actor,
        editDiff,
        params.text,
        { intent: base.intent, schema: base.schema },
      );

      stateRef.current = { intent: newIntent, schema: newSchema };
      params.onSchemaChange?.(editDiff, "voice_edit");
      params.onEvent(
        "result",
        `Edit applied — now ${newSchema.fields.length} field${newSchema.fields.length === 1 ? "" : "s"}.`,
      );
    },
    [portfolioId],
  );

  const runDataEntry = useCallback(
    async (
      params: ProcessParams,
      records: { values: { field: string; value: string }[] }[],
    ): Promise<void> => {
      const base = stateRef.current;
      const rows = records
        .map((r) => buildResponseData(base.schema, r.values))
        .filter((data) => Object.keys(data).length > 0)
        .map((data) => ({
          portfolio_id: portfolioId,
          data: JSON.parse(JSON.stringify(data)),
        }));

      if (rows.length === 0) {
        params.onEvent(
          "system",
          "Heard values, but none matched the form's fields.",
        );
        return;
      }

      const supabase = createClient();
      const { error } = await supabase.from("responses").insert(rows);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["responses", portfolioId] });
      params.onEvent(
        "result",
        `Recorded ${rows.length} entr${rows.length === 1 ? "y" : "ies"} — see them under Responses.`,
      );
    },
    [portfolioId, queryClient],
  );

  const runSmart = useCallback(
    async (params: ProcessParams): Promise<void> => {
      const base = stateRef.current;
      params.onEvent("processing", "Interpreting what you said…");

      const routed = await routeUtteranceAction(
        base.intent,
        base.schema,
        params.text,
      );

      if (!routed.success) {
        // Graceful degradation: fall back to the append baseline
        params.onEvent(
          "system",
          "Couldn't interpret the phrase — appending it as-is.",
        );
        await runAppend(params);
        return;
      }

      if (routed.summary) params.onEvent("system", routed.summary);

      if (routed.route === "schemaEdit") {
        params.onEvent("processing", "Applying the edit to the form…");
        await runSchemaEdit(params);
        return;
      }

      if (routed.route === "dataEntry") {
        params.onEvent("processing", "Recording the values…");
        await runDataEntry(params, routed.records ?? []);
        return;
      }

      if (!routed.sections?.length) {
        params.onEvent("system", "Nothing to change from that phrase.");
        return;
      }

      const nextIntent = applyIntentSections(base.intent, routed.sections);
      const sectionNames = routed.sections.map((s) => s.section).join(", ");
      params.onEvent("processing", `Updating ${sectionNames}…`);

      const result = await pipeline.mutateAsync({
        previousIntent: base.intent,
        currentIntent: nextIntent,
        currentSchema: base.schema,
        actor: params.actor,
      });

      stateRef.current = {
        intent: result.intent,
        schema: result.schema ?? base.schema,
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
            ? `Form updated (${result.strategy.kind}) — now ${fieldCount} field${fieldCount === 1 ? "" : "s"}.`
            : `Intent updated (${result.strategy.kind}).`,
        );
      }
    },
    [applyIntentSections, pipeline, runAppend, runDataEntry, runSchemaEdit],
  );

  /**
   * Enqueue an utterance. Returns immediately; processing is serialized so
   * utterances always apply in the order they were spoken.
   */
  const enqueue = useCallback(
    (params: ProcessParams) => {
      queueLengthRef.current += 1;
      setQueueLength(queueLengthRef.current);
      setIsProcessing(true);

      chainRef.current = chainRef.current
        .then(async () => {
          if (params.mode === "append") {
            await runAppend(params);
          } else {
            await runSmart(params);
          }
        })
        .catch((err) => {
          params.onEvent(
            "error",
            err instanceof Error ? err.message : "Failed to update the form.",
          );
        })
        .finally(() => {
          queueLengthRef.current -= 1;
          setQueueLength(queueLengthRef.current);
          if (queueLengthRef.current === 0) setIsProcessing(false);
          queryClient.invalidateQueries({
            queryKey: ["portfolios", portfolioId],
          });
        });
    },
    [portfolioId, queryClient, runAppend, runSmart],
  );

  return { enqueue, sync, isProcessing, queueLength };
}
