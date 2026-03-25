"use server";

import { withTracing } from "@/lib/telemetry";
import type { Field } from "@/lib/types";
import { model } from "@/lib/model";
import { generateText, Output } from "ai";
import { z } from "zod";

// ---------- Zod schemas for structured output ----------

const processColumnSchema = z.object({
  results: z.array(z.object({
    responseId: z.string(),
    value: z.string().describe("The transformed value as a string"),
  })),
});

const deriveFieldsSchema = z.object({
  label: z.string().describe("Short action label, 2-5 words"),
  fields: z.array(z.object({
    name: z.string().describe("camelCase field name"),
    label: z.string(),
    typeKind: z.enum(["text", "number", "boolean", "select", "date", "scale"]).describe("Field type kind"),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional().describe("Options for select fields"),
    required: z.boolean().optional(),
    description: z.string().optional(),
  })),
});

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

Apply the user's instruction to each value.

Rules:
- Process every response entry
- If a value is empty or null, return it as-is unless the instruction says otherwise
- Keep the output type consistent with the column type when possible`;

    const result = await withTracing(
      { tags: ["column-action", "process"] },
      () =>
        generateText({
          model,
          prompt: systemPrompt,
          temperature: 0.2,
          output: Output.object({ schema: processColumnSchema }),
          experimental_telemetry: { isEnabled: true, functionId: "column-action", recordInputs: true, recordOutputs: true },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output in LLM response" };
    }

    const parsedResults = Object.fromEntries(
      result.output.results.map((r) => [r.responseId, r.value]),
    );
    return { success: true, results: parsedResults };
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

Based on the transformation, design 1-3 new fields that would capture this derived data as first-class form fields.

Rules:
- Field names must be camelCase and not conflict with existing names
- Use appropriate field types: text, number, boolean, select, date, scale
- For select types, include options with label and value pairs
- Keep it minimal — only fields directly implied by the prompt`;

    const result = await withTracing(
      { tags: ["column-action", "derive"] },
      () =>
        generateText({
          model,
          prompt: systemPrompt,
          temperature: 0.3,
          output: Output.object({ schema: deriveFieldsSchema }),
          experimental_telemetry: { isEnabled: true, functionId: "column-action", recordInputs: true, recordOutputs: true },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output in LLM response" };
    }

    const parsedResult = result.output;

    const newFields: Field[] = parsedResult.fields.map((f, index) => ({
      id: `field-${Date.now()}-${index}`,
      name: f.name,
      label: f.label,
      type: convertTypeKind(f.typeKind, f.options),
      required: f.required ?? false,
      constraints: [],
      description: f.description,
      origin: "system" as const,
      tags: ["column-action"],
      derivedFrom: field.id,
    }));

    return {
      success: true,
      newFields,
      label: parsedResult.label ?? prompt.slice(0, 50),
    };
  } catch (error) {
    console.error("Field derivation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function convertTypeKind(
  typeKind: string,
  options?: Array<{ label: string; value: string }>,
): Field["type"] {
  switch (typeKind) {
    case "select":
      return {
        kind: "select",
        options: (options ?? []).map((o) => ({ label: o.label, value: o.value })),
        multiple: false,
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    case "scale":
      return { kind: "scale", min: 1, max: 5 };
    default:
      return { kind: "text" };
  }
}
