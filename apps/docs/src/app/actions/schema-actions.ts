"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import {
  schemaPatchRules,
  schemaPatchSchema,
  toSchemaPatch,
} from "interact/forms/form-model";
import type { SchemaPatch } from "interact/forms/schema-patch";
import { fenced, formSystemPrompt } from "interact/forms/prompt";
import {
  normalizeFieldKey,
  serializeForLLM,
} from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { model, withLlmRetry, llmErrorMessage } from "@/lib/model";
import {
  buildSchemaGenerationRequest,
  finalizeGeneratedSchema,
  schemaResponseSchema,
} from "@/lib/schema-generation";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

export interface IntentToSchemaResponse {
  success: boolean;
  result?: {
    artifactFormSchema: PortfolioSchema;
  };
  error?: string;
}

export async function intentToSchemaAction(
  intent: StructuredIntent,
  acceptedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  const basePrompt = serializeForLLM(intent);
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "intentToSchema",
      { basePrompt, acceptedStandards },
      () => intentToSchemaReal(basePrompt, acceptedStandards),
      { prompt: basePrompt },
    );
  }
  return intentToSchemaReal(basePrompt, acceptedStandards);
}

async function intentToSchemaReal(
  basePrompt: string,
  requestedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  try {
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    await guardLlmRequest();

    // Prompt and post-processing are shared with the streaming route
    // (`/api/llm-stream/generate-schema`) — see `lib/schema-generation.ts`
    const { system, prompt, acceptedStandards } = buildSchemaGenerationRequest(
      basePrompt,
      requestedStandards,
    );

    const result = await withLlmRetry("schema-action", (abortSignal) =>
      withTracing({ tags: ["schema", "generate"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: schemaResponseSchema }),
          system,
          prompt,
          temperature: 0.3,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("schema-action"),
        }),
      ),
    );

    if (!result.output) {
      console.error("No structured output from schema generation");
      return {
        success: false,
        error: "Model did not return structured output",
      };
    }

    return {
      success: true,
      result: {
        artifactFormSchema: finalizeGeneratedSchema(result.output, acceptedStandards),
      },
    };
  } catch (error) {
    console.error("Intent to schema error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Refine: patch an existing schema for an intent edit
// ---------------------------------------------------------------------------

export interface RefineSchemaRequest {
  /** The intent the current schema was built from */
  previousIntent: StructuredIntent;
  /** The edited intent */
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  /** Answered elicitation questions, most recent first — why fields exist */
  decisions?: { question: string; answer: string }[];
  /** Names of accepted standards, whose fields must stay */
  standardNames?: string[];
}

export interface RefineSchemaResponse {
  success: boolean;
  result?: {
    /** Changelog line for provenance */
    summary: string;
    /**
     * Only what the intent edit changes. The client applies it to the
     * latest schema, so answers given while this ran survive.
     */
    schemaPatch: SchemaPatch;
  };
  error?: string;
}

const refineResponseSchema = z.object({
  summary: z
    .string()
    .describe(
      "One tight changelog sentence, e.g. 'Added dietary preference fields.' — or 'No form changes needed.'",
    ),
  schemaPatch: schemaPatchSchema,
});

/**
 * Update an existing form for an intent edit by returning a patch instead of
 * regenerating the schema: the output is a few changed fields (fast), and
 * everything the edit doesn't touch — fields added by elicitation questions, direct
 * edits — is left alone.
 */
export async function refineSchemaFromIntentAction(
  request: RefineSchemaRequest,
): Promise<RefineSchemaResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "refineSchemaFromIntent",
      request,
      () => refineSchemaReal(request),
      { prompt: serializeForLLM(request.intent) },
    );
  }
  return refineSchemaReal(request);
}

async function refineSchemaReal({
  previousIntent,
  intent,
  currentSchema,
  decisions = [],
  standardNames = [],
}: RefineSchemaRequest): Promise<RefineSchemaResponse> {
  try {
    const previousPrompt = serializeForLLM(previousIntent);
    const basePrompt = serializeForLLM(intent);
    capText(previousPrompt, LIMITS.document, "Previous intent");
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capJson(decisions, LIMITS.document, "Decisions");
    capJson(standardNames, LIMITS.shortText, "Standards");
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema: currentSchema });

    const decisionBlock =
      decisions.length > 0
        ? `\nDecisions the user made earlier while refining the form (the schema reflects them):\n${fenced("decisions", decisions.map((d) => `- ${JSON.stringify(d.question)} → ${JSON.stringify(d.answer)}`).join("\n"))}\n`
        : "";
    const standardsBlock =
      standardNames.length > 0
        ? `\nThe form follows these standards — keep their fields: ${standardNames.join(", ")}\n`
        : "";

    const prompt = `The form's description was just edited: FORM DESCRIPTION above is the edited text, and the schema above was built for the previous one (it already reflects earlier decisions and direct edits). Update the form to match the edit, changing only what the edit requires.

Previous form description:
${fenced("previous_description", previousPrompt || "(empty)")}
${decisionBlock}${standardsBlock}
Return a "schemaPatch" with ONLY the changes the edit calls for:
- "addFields": data the edited description now asks for that the form doesn't collect yet — all of it (e.g. "three questions about X" means three fields)
- "sections": when the form has sections, place new fields in one (a set of related new questions can get its own)
- "updateFields": fields whose meaning, options or required status the edit changes (same key, only the properties that change, keep values for the rest)
- "removeFieldKeys": only fields collecting something the edit explicitly drops or excludes
Fields the edit doesn't touch stay as they are, even when the description doesn't mention them — they come from earlier decisions or edits. Never undo a decision listed above unless the edit explicitly reverses it. If the edit doesn't affect the form (e.g. rewording), return an empty patch.

RULES:
${schemaPatchRules(false)}`;

    const result = await withLlmRetry("schema-refine", (abortSignal) =>
      withTracing({ tags: ["schema", "refine"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: refineResponseSchema }),
          system,
          prompt,
          temperature: 0.2,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("schema-refine"),
        }),
      ),
    );

    if (!result.output) {
      return {
        success: false,
        error: "Model did not return structured output",
      };
    }

    const { summary } = result.output;
    const schemaPatch = toSchemaPatch(result.output.schemaPatch);
    // New keys become stored response keys — make them proper identifiers.
    // Updates/removals must match existing keys verbatim, so they're left.
    const addFields = schemaPatch.addFields?.map((f, i) => ({
      ...f,
      key: normalizeFieldKey(f.key || f.label, `field${i + 1}`),
    }));

    return {
      success: true,
      result: { summary, schemaPatch: { ...schemaPatch, addFields } },
    };
  } catch (error) {
    console.error("Refine schema error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
    };
  }
}
