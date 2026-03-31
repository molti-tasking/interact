"use server";

import { model } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import type {
  DerivationSpec,
  Field,
  PortfolioSchema,
  StructuredIntent,
} from "@/lib/types";
import { serializeForLLM } from "@/lib/engine/structured-intent";
import { generateText, Output } from "ai";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeriveSchemaRequest {
  parentIntent: StructuredIntent;
  parentSchema: PortfolioSchema;
  scenarioDescription: string;
}

export interface DeriveSchemaResponse {
  success: boolean;
  result?: {
    derivationType: "sub" | "super" | "mixed";
    includedFieldKeys: string[];
    additionalFields: Field[];
    schema: PortfolioSchema;
    derivedPurpose: string;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Structured output schema
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const derivedFieldSchema = z.object({
  key: z.string().describe("camelCase field key"),
  label: z.string().describe("Human-readable field label"),
  description: z
    .string()
    .optional()
    .describe("Brief help text — omit if label is self-explanatory"),
  type: z
    .enum(["string", "number", "boolean", "date", "email", "select"])
    .describe("Field input type"),
  required: z.boolean(),
  validation: z
    .object({
      options: z
        .array(optionSchema)
        .optional()
        .describe("Required for select fields"),
    })
    .optional(),
});

const deriveResponseSchema = z.object({
  derivationType: z
    .enum(["sub", "super", "mixed"])
    .describe(
      "sub = subset of parent fields; super = all parent fields + new ones; mixed = some parent fields + new ones",
    ),
  includedFieldKeys: z
    .array(z.string())
    .describe(
      "camelCase keys of parent fields to INCLUDE in the derived schema. Omitted parent fields are excluded.",
    ),
  additionalFields: z
    .array(derivedFieldSchema)
    .describe("New fields to add that don't exist in the parent schema"),
  derivedPurpose: z
    .string()
    .describe(
      "2-3 sentence description of what this derived view is for and who uses it",
    ),
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function deriveSchemaAction(
  request: DeriveSchemaRequest,
): Promise<DeriveSchemaResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "deriveSchemaAction",
      request,
      () => deriveSchemaReal(request),
      { scenario: request.scenarioDescription },
    );
  }
  return deriveSchemaReal(request);
}

async function deriveSchemaReal(
  request: DeriveSchemaRequest,
): Promise<DeriveSchemaResponse> {
  try {
    const { parentIntent, parentSchema, scenarioDescription } = request;
    const parentDescription = serializeForLLM(parentIntent);

    const parentFieldsSummary = parentSchema.fields
      .map(
        (f) =>
          `- ${f.name} (${f.label}): type=${typeof f.type === "object" ? f.type.kind : f.type}, required=${f.required}${f.description ? `, "${f.description}"` : ""}`,
      )
      .join("\n");

    const prompt = `You are a form schema architect. A user wants to derive a new form view from an existing base schema.

BASE FORM DESCRIPTION:
${parentDescription}

BASE SCHEMA FIELDS:
${parentFieldsSummary}

DERIVED VIEW REQUEST:
"${scenarioDescription}"

Your job:
1. Determine the derivation type:
   - "sub": The derived view needs FEWER fields than the parent (e.g. a patient portal that only shows a subset)
   - "super": The derived view needs ALL parent fields PLUS additional ones (e.g. a surgical planning view that extends the base)
   - "mixed": The derived view needs SOME parent fields plus NEW fields not in the parent (e.g. a physiotherapist view that inherits demographics but adds rehab-specific fields)

2. Select which parent fields to INCLUDE by listing their camelCase keys in "includedFieldKeys". Only include fields that are relevant to the derived view's purpose. Be selective — a surgical planning view doesn't need the patient's email, but absolutely needs diagnosis and surgical history.

3. Define any ADDITIONAL fields needed for the derived view that don't exist in the parent schema. Use your domain knowledge to determine the minimum viable set of new fields.

RULES:
- For "sub" type: includedFieldKeys is a strict subset, additionalFields should be empty
- For "super" type: includedFieldKeys should include ALL parent field keys, additionalFields has the new fields
- For "mixed" type: includedFieldKeys is a selective subset, additionalFields has new fields
- Field keys MUST be camelCase
- Be precise about which parent fields matter for this specific view
- Generate the minimum viable set of additional fields — not exhaustive, but domain-appropriate`;

    const LLM_TIMEOUT_MS = 45_000;

    async function callWithTimeout() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      try {
        return await withTracing({ tags: ["schema", "derive"] }, () =>
          generateText({
            model,
            output: Output.object({ schema: deriveResponseSchema }),
            prompt,
            temperature: 0.3,
            abortSignal: controller.signal,
            experimental_telemetry: {
              isEnabled: true,
              functionId: "derive-action",
              recordInputs: true,
              recordOutputs: true,
            },
          }),
        );
      } finally {
        clearTimeout(timer);
      }
    }

    let result;
    try {
      result = await callWithTimeout();
    } catch (err) {
      console.warn(
        `[derive-action] First attempt failed (${err instanceof Error ? err.message : err}), retrying...`,
      );
      result = await callWithTimeout();
    }

    if (!result.output) {
      return {
        success: false,
        error: "Model did not return structured output",
      };
    }

    const parsed = result.output;

    // Build the derived schema: included parent fields + additional fields
    const includedKeySet = new Set(parsed.includedFieldKeys);
    const inheritedFields: Field[] = parentSchema.fields
      .filter((f) => includedKeySet.has(f.name))
      .map((f) => ({
        ...f,
        derivedFrom: f.id,
      }));

    const newFields: Field[] = parsed.additionalFields.map((f, index) => ({
      id: `field-${Date.now()}-derived-${index}`,
      name: f.key,
      label: f.label,
      type: convertFieldType(f.type, f.validation),
      required: f.required,
      constraints: [],
      description: f.description,
      origin: "system" as const,
      tags: [],
    }));

    const schema: PortfolioSchema = {
      fields: [...inheritedFields, ...newFields],
      groups: [],
      version: 1,
    };

    return {
      success: true,
      result: {
        derivationType: parsed.derivationType,
        includedFieldKeys: parsed.includedFieldKeys,
        additionalFields: newFields,
        schema,
        derivedPurpose: parsed.derivedPurpose,
      },
    };
  } catch (error) {
    console.error("Derive schema error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function convertFieldType(
  type: string,
  validation?: { options?: unknown[] },
): Field["type"] {
  switch (type) {
    case "select":
      return {
        kind: "select",
        options: normalizeOptions(validation?.options),
        multiple: false,
      };
    case "number":
      return { kind: "number" };
    case "boolean":
      return { kind: "boolean" };
    case "date":
      return { kind: "date" };
    default:
      return { kind: "text" };
  }
}

function normalizeOptions(
  raw: unknown,
): Array<{ label: string; value: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((o) => {
    if (typeof o === "string") return { label: o, value: o };
    if (o && typeof o === "object" && "value" in o && "label" in o)
      return { label: String(o.label), value: String(o.value) };
    if (o && typeof o === "object" && "value" in o)
      return { label: String(o.value), value: String(o.value) };
    const s = String(o);
    return { label: s, value: s };
  });
}
