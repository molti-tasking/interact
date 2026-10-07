"use server";

import { newFieldId } from "@/lib/engine/schema-patch";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { model } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

// ---------- Zod schema for structured output ----------

const addFieldSchema = z.object({
  fields: z.array(
    z.object({
      name: z.string().describe("camelCase field name"),
      label: z.string(),
      typeKind: z
        .enum(["text", "number", "boolean", "select", "date", "scale"])
        .describe("Field type kind"),
      options: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .optional()
        .describe("Options for select fields"),
      required: z.boolean().optional(),
      description: z.string().optional(),
      tooltip: z.string().optional(),
    }),
  ),
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
): Promise<AddFieldFromPromptResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "addFieldFromPrompt",
      { prompt, schema },
      () => addFieldFromPromptReal(prompt, schema),
      { prompt },
    );
  }
  return addFieldFromPromptReal(prompt, schema);
}

async function addFieldFromPromptReal(
  prompt: string,
  schema: PortfolioSchema,
): Promise<AddFieldFromPromptResponse> {
  try {
    capText(prompt, LIMITS.prompt, "Prompt");
    capJson(schema, LIMITS.document, "Schema");
    await checkRateLimit();

    const existingFieldNames = schema.fields.map((f) => f.name);

    const systemPrompt = `You are a form schema designer. The user wants to add new fields to their form using a natural language description.

Current form fields: ${JSON.stringify(existingFieldNames)}

User's request: "${prompt}"

Design 1-3 new fields based on the user's description.

Rules:
- Field names must be camelCase and not conflict with existing names
- Use appropriate field types: text, number, boolean, select, date, scale
- For select types, include options with label and value pairs
- Keep it minimal — only fields directly implied by the prompt
- Include a short description and tooltip for each field`;

    const result = await withTracing(
      { tags: ["add-field", "prompt"] },
      () =>
        generateText({
          model,
          prompt: systemPrompt,
          output: Output.object({ schema: addFieldSchema }),
          experimental_telemetry: telemetry("add-field-prompt"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output in LLM response" };
    }

    // Never collide with existing (or each other's) field names
    const taken = new Set(existingFieldNames);
    const newFields: Field[] = result.output.fields
      .filter((f) => {
        if (!f.name || taken.has(f.name)) return false;
        taken.add(f.name);
        return true;
      })
      .map((f) => ({
        id: newFieldId(),
        name: f.name,
        label: f.label,
        type: convertTypeKind(f.typeKind, f.options),
        required: f.required ?? false,
        constraints: [],
        description: f.description,
        tooltip: f.tooltip,
        origin: "system" as const,
        tags: ["prompt-added"],
      }));

    return { success: true, newFields };
  } catch (error) {
    console.error("Add field from prompt error:", error);
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
        options: (options ?? []).map((o) => ({
          label: o.label,
          value: o.value,
        })),
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
