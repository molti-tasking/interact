"use server";

import { withTracing } from "@/lib/telemetry";
import type { Field } from "@/lib/types";
import { model } from "@/lib/model";
import { generateText } from "ai";

// ---------- processColumnPromptAction ----------

export interface ProcessColumnPromptResponse {
  success: boolean;
  results?: Record<string, unknown>;
  error?: string;
}

export async function processColumnPromptAction(
  field: Field,
  prompt: string,
  responseData: Array<{ responseId: string; value: unknown }>,
): Promise<ProcessColumnPromptResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("processColumnPrompt", { field, prompt, responseData },
      () => processColumnPromptReal(field, prompt, responseData), { prompt });
  }
  return processColumnPromptReal(field, prompt, responseData);
}

async function processColumnPromptReal(
  field: Field,
  prompt: string,
  responseData: Array<{ responseId: string; value: unknown }>,
): Promise<ProcessColumnPromptResponse> {
  try {
    const systemPrompt = `You are a data processing assistant. The user has a table of form responses. They want to apply a transformation to a specific column.

Column definition:
- Name: ${field.name}
- Label: ${field.label}
- Type: ${field.type.kind}

User's instruction: ${prompt}

Current values for this column (JSON array of {responseId, value}):
${JSON.stringify(responseData, null, 2)}

Apply the user's instruction to each value. Return ONLY valid JSON in this exact format:
{
  "results": {
    "<responseId>": <enriched/transformed value>
  }
}

Rules:
- Process every response entry
- If a value is empty or null, return it as-is unless the instruction says otherwise
- Keep the output type consistent with the column type when possible
- Return ONLY the JSON object, no markdown or explanation`;

    const result = await withTracing(
      { tags: ["column-action", "process"] },
      () =>
        generateText({
          model,
          prompt: systemPrompt,
          temperature: 0.2,
          experimental_telemetry: { isEnabled: true, functionId: "column-action", recordInputs: true, recordOutputs: true },
        }),
    );

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "No valid JSON in LLM response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, results: parsed.results ?? {} };
  } catch (error) {
    console.error("Column prompt processing error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------- deriveFieldsFromPromptAction ----------

export interface DeriveFieldsResponse {
  success: boolean;
  newFields?: Field[];
  label?: string;
  error?: string;
}

export async function deriveFieldsFromPromptAction(
  field: Field,
  prompt: string,
  existingFieldNames: string[],
): Promise<DeriveFieldsResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("deriveFieldsFromPrompt", { field, prompt, existingFieldNames },
      () => deriveFieldsFromPromptReal(field, prompt, existingFieldNames), { prompt });
  }
  return deriveFieldsFromPromptReal(field, prompt, existingFieldNames);
}

async function deriveFieldsFromPromptReal(
  field: Field,
  prompt: string,
  existingFieldNames: string[],
): Promise<DeriveFieldsResponse> {
  try {
    const systemPrompt = `You are a form schema designer. The user has defined a recurring data transformation for a column in their form. You need to design new form fields that would capture this data natively in future submissions.

Source column:
- Name: ${field.name}
- Label: ${field.label}
- Type: ${field.type.kind}

User's transformation prompt: "${prompt}"

Existing field names (avoid duplicates): ${JSON.stringify(existingFieldNames)}

Based on the transformation, design 1-3 new fields that would capture this derived data as first-class form fields. Return ONLY valid JSON:
{
  "label": "Short action label (2-5 words, e.g. 'Extract city from address')",
  "fields": [
    {
      "name": "camelCaseFieldName",
      "label": "Human-Readable Label",
      "type": { "kind": "text" },
      "required": false,
      "description": "Brief description of what this field captures"
    }
  ]
}

Rules:
- Field names must be camelCase and not conflict with existing names
- Use appropriate field types: text, number, boolean, select, date, scale
- For select types, include options: { "kind": "select", "options": [{"label": "...", "value": "..."}], "multiple": false }
- Keep it minimal — only fields directly implied by the prompt
- Return ONLY the JSON object`;

    const result = await withTracing(
      { tags: ["column-action", "derive"] },
      () =>
        generateText({
          model,
          prompt: systemPrompt,
          temperature: 0.3,
          experimental_telemetry: { isEnabled: true, functionId: "column-action", recordInputs: true, recordOutputs: true },
        }),
    );

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "No valid JSON in LLM response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    if (!parsed.fields || !Array.isArray(parsed.fields)) {
      return { success: false, error: "Invalid response: missing fields array" };
    }

    const newFields: Field[] = parsed.fields.map(
      (
        f: {
          name: string;
          label: string;
          type: Field["type"];
          required?: boolean;
          description?: string;
        },
        index: number,
      ) => ({
        id: `field-${Date.now()}-${index}`,
        name: f.name,
        label: f.label,
        type: f.type ?? { kind: "text" as const },
        required: f.required ?? false,
        constraints: [],
        description: f.description,
        origin: "system" as const,
        tags: ["column-action"],
        derivedFrom: field.id,
      }),
    );

    return {
      success: true,
      newFields,
      label: parsed.label ?? prompt.slice(0, 50),
    };
  } catch (error) {
    console.error("Field derivation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
