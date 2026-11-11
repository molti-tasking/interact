"use server";

import {
  llmFieldSchema,
  NEW_FIELD_RULES,
  SCALE_FIELD_RULES,
} from "interact/forms/form-model";
import { fenced, formSystemPrompt } from "interact/forms/prompt";
import { fieldFromPatchField } from "interact/forms/schema-patch";
import { normalizeFieldKey } from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { model, llmErrorMessage } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import {
  emptyStructuredIntent,
  type Field,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

// ---------- Zod schema for structured output ----------

const addFieldSchema = z.object({
  fields: z.array(llmFieldSchema),
});

// ---------- Types ----------

export interface AddFieldFromPromptResponse {
  success: boolean;
  newFields?: Field[];
  error?: string;
}

// ---------- Action ----------

export async function addFieldFromPromptAction(
  prompt: string,
  schema: PortfolioSchema,
  /** The form's intent, so new fields fit what the form is for */
  intent?: StructuredIntent,
): Promise<AddFieldFromPromptResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "addFieldFromPrompt",
      { prompt, schema },
      () => addFieldFromPromptReal(prompt, schema, intent),
      { prompt },
    );
  }
  return addFieldFromPromptReal(prompt, schema, intent);
}

async function addFieldFromPromptReal(
  prompt: string,
  schema: PortfolioSchema,
  intent: StructuredIntent = emptyStructuredIntent(),
): Promise<AddFieldFromPromptResponse> {
  try {
    capText(prompt, LIMITS.prompt, "Prompt");
    capJson(schema, LIMITS.document, "Schema");
    await guardLlmRequest();

    const existingFieldNames = schema.fields.map((f) => f.name);

    const system = formSystemPrompt({ intent, schema });

    const request = `The creator wants to add to the form:
${fenced("request", prompt)}

Design 1-3 new fields for this request.

RULES:
- Keep it minimal — only fields directly implied by the request
${NEW_FIELD_RULES}
${SCALE_FIELD_RULES}`;

    const result = await withTracing(
      { tags: ["add-field", "prompt"] },
      () =>
        generateText({
          model,
          system,
          prompt: request,
          temperature: 0.3,
          output: Output.object({ schema: addFieldSchema }),
          experimental_telemetry: telemetry("add-field-prompt"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output in LLM response" };
    }

    // Never collide with existing (or each other's) field names
    const taken = new Set(existingFieldNames);
    const newFields: Field[] = [];
    for (const [i, f] of result.output.fields.entries()) {
      const key = normalizeFieldKey(f.key || f.label, `field${i + 1}`);
      if (taken.has(key)) continue;
      taken.add(key);
      newFields.push(fieldFromPatchField({ ...f, key }, { tags: ["prompt-added"] }));
    }

    return { success: true, newFields };
  } catch (error) {
    console.error("Add field from prompt error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
    };
  }
}
