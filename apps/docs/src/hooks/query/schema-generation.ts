"use client";

import { refineSchemaFromIntentAction } from "@/app/actions/schema-actions";
import type { DetectedStandard } from "@/lib/domain-standards";
import { commitPortfolioChange } from "@/lib/engine/commit";
import { mergePatchOntoLatest } from "interact/forms/merge";
import { mergeRegeneratedSchema } from "interact/forms/schema-patch";
import {
  applyDraftEvent,
  readSchemaStream,
  type DraftField,
} from "@/lib/schema-stream";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { applyCommitToCache } from "./portfolios";

function schemaDraftKey(portfolioId: string) {
  return ["schema-draft", portfolioId] as const;
}

/**
 * The fields of a form that is being generated right now, in the order the
 * model writes them — null when no generation is running. For display only:
 * the form itself changes when the finished schema is committed.
 */
export function useSchemaDraft(portfolioId: string): DraftField[] | null {
  const { data } = useQuery<DraftField[] | null>({
    queryKey: schemaDraftKey(portfolioId),
    // Written by `useGenerateSchema`; never fetched
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
  });
  return data ?? null;
}

/**
 * Generate a schema through the streaming route. `onDrafts` is called with
 * the fields written so far; resolves to the final, post-processed schema.
 * Throws when the stream fails or ends without one.
 */
async function streamGeneratedSchema(
  body: { intent: StructuredIntent; acceptedStandards?: DetectedStandard[] },
  onDrafts: (drafts: DraftField[]) => void,
): Promise<PortfolioSchema> {
  const res = await fetch("/api/llm-stream/generate-schema", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    // Guard failures and the auth proxy answer with plain JSON
    const failure = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(
      res.status === 401
        ? "You're signed out. Reload the page to continue."
        : typeof failure?.error === "string"
          ? failure.error
          : `The AI request failed (${res.status})`,
    );
  }

  let drafts: DraftField[] = [];
  for await (const event of readSchemaStream(res.body)) {
    if (event.type === "done") return event.schema;
    if (event.type === "error") throw new Error(event.error);
    drafts = applyDraftEvent(drafts, event);
    onDrafts(drafts);
  }
  throw new Error("The AI stopped before the form was finished. Please try again.");
}

/**
 * Generate a schema from the structured intent and accepted standards, then
 * fold it into the portfolio's current schema (field ids, creator-authored
 * fields, accepted standards and column actions survive regeneration).
 * Generation is streamed (`/api/llm-stream/generate-schema`).
 * Used for the first generation; an existing form is refined instead
 * (`useRefineSchema`).
 */
export function useGenerateSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      intent,
      acceptedStandards,
      actor,
    }: {
      intent: StructuredIntent;
      acceptedStandards?: DetectedStandard[];
      /** The creator whose intent this is generated from */
      actor: string;
    }) => {
      // Fields show on the canvas as drafts while the model writes them
      // (`useSchemaDraft`); the form changes once, with the final schema.
      // Whatever happens, the drafts are gone afterwards.
      const draftKey = schemaDraftKey(portfolioId);
      queryClient.setQueryData<DraftField[] | null>(draftKey, []);
      let generated: PortfolioSchema;
      try {
        generated = await streamGeneratedSchema(
          {
            intent,
            acceptedStandards: acceptedStandards?.length ? acceptedStandards : undefined,
          },
          (drafts) => queryClient.setQueryData<DraftField[] | null>(draftKey, drafts),
        );
      } catch (error) {
        queryClient.setQueryData<DraftField[] | null>(draftKey, null);
        throw error;
      }

      const commit = await commitPortfolioChange(portfolioId, (current) => ({
        // The creator wrote or edited the intent; this is its consequence
        trigger: "intent-edit",
        schema: mergeRegeneratedSchema(current.schema, generated),
        provenance: {
          layer: "configuration",
          action: "schema_generated",
          actor,
          rationale: `Generated ${generated.fields.length} fields from intent`,
        },
        automated: true,
      }));
      // The drafts stay up until the commit is in the cache (`onSettled`),
      // so the canvas doesn't flash empty in between
      return commit;
    },
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
    onSettled: () =>
      queryClient.setQueryData<DraftField[] | null>(schemaDraftKey(portfolioId), null),
  });
}

/**
 * Refine an existing form after an intent edit: the LLM returns only the
 * fields the edit changes, and that change is merged onto the latest state.
 * Fields from elicitation questions and direct edits are left alone, and anything
 * changed while the LLM was working (e.g. a probe answered meanwhile) wins
 * over the refinement where both touched the same property.
 *
 * Resolves to null when the edit didn't change the form.
 */
export function useRefineSchema(portfolioId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      previousIntent,
      intent,
      baseSchema,
      decisions,
      acceptedStandards,
      actor,
    }: {
      previousIntent: StructuredIntent;
      intent: StructuredIntent;
      /** The schema the refinement is computed from */
      baseSchema: PortfolioSchema;
      decisions?: { question: string; answer: string }[];
      acceptedStandards?: DetectedStandard[];
      actor: string;
    }) => {
      const result = await refineSchemaFromIntentAction({
        previousIntent,
        intent,
        currentSchema: baseSchema,
        decisions,
        standardNames: acceptedStandards?.map((s) => s.standard.name),
      });

      if (!result.success || !result.result) {
        throw new Error(result.error ?? "Failed to refine the form");
      }

      const { schemaPatch, summary } = result.result;
      return commitPortfolioChange(portfolioId, (current) => {
        const schema = mergePatchOntoLatest(
          baseSchema,
          schemaPatch,
          current.schema,
        );
        if (!schema) return null;
        return {
          trigger: "intent-edit",
          schema,
          provenance: {
            layer: "configuration",
            action: "schema_refined",
            actor,
            rationale: summary,
          },
          automated: true,
        };
      });
    },
    onSuccess: (commit) => applyCommitToCache(queryClient, commit),
  });
}
