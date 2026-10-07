"use server";

import {
  convertPatchFieldType,
  newFieldId,
  pruneGroups,
} from "@/lib/engine/schema-patch";
import {
  filterExcludedFields,
  normalizeFieldKey,
  serializeForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { model, withLlmRetry } from "@/lib/model";
import { getStandardById } from "@/lib/standards";
import { telemetry, withTracing } from "@/lib/telemetry";
import {
  emptyIntentSection,
  type Field,
  type PortfolioSchema,
  type StructuredIntent,
} from "@/lib/types";
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
    /** Parent field names actually inherited (all of them for "super") */
    includedFieldKeys: string[];
    additionalFields: Field[];
    schema: PortfolioSchema;
    derivedPurpose: string;
    /**
     * Intent for the derived portfolio: `derivedPurpose` plus the parent's
     * exclusions and constraints (which still apply to a derived view).
     * Audience is left empty — the derived view usually serves someone else.
     */
    derivedIntent?: StructuredIntent;
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
    capText(parentDescription, LIMITS.document, "Parent intent");
    capJson(parentSchema, LIMITS.document, "Parent schema");
    capText(scenarioDescription, LIMITS.prompt, "Scenario");
    await checkRateLimit();

    const parentFieldsSummary = parentSchema.fields
      .map(
        (f) =>
          `- ${f.name} (${f.label}): type=${typeof f.type === "object" ? f.type.kind : f.type}, required=${f.required}${f.description ? `, "${f.description}"` : ""}`,
      )
      .join("\n");

    const system = `You are a form schema architect. A user wants to derive a new form view from an existing base schema.`;

    const prompt = `BASE FORM DESCRIPTION:
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

    const result = await withLlmRetry("derive-action", (abortSignal) =>
      withTracing({ tags: ["schema", "derive"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: deriveResponseSchema }),
          system,
          prompt,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("derive-action"),
        }),
      ),
    );

    if (!result.output) {
      return {
        success: false,
        error: "Model did not return structured output",
      };
    }

    const parsed = result.output;

    // Build the derived schema: included parent fields + additional fields.
    // "super" means ALL parent fields — enforced even if the model omits some.
    const includedKeySet =
      parsed.derivationType === "super"
        ? new Set(parentSchema.fields.map((f) => f.name))
        : new Set(parsed.includedFieldKeys);
    const inheritedFields: Field[] = parentSchema.fields
      .filter((f) => includedKeySet.has(f.name))
      .map((f) => ({
        ...f,
        derivedFrom: f.id,
      }));

    // New fields must not shadow an inherited field or each other
    const usedNames = new Set(inheritedFields.map((f) => f.name));
    const proposedFields: Field[] = [];
    for (const [index, f] of parsed.additionalFields.entries()) {
      const name = normalizeFieldKey(f.key || f.label, `field${index + 1}`);
      if (usedNames.has(name)) {
        console.warn(`[derive-action] Dropping duplicate field key "${name}"`);
        continue;
      }
      usedNames.add(name);
      proposedFields.push({
        id: newFieldId(),
        name,
        label: f.label,
        type: convertPatchFieldType(f.type, f.validation),
        required: f.required,
        constraints: [],
        description: f.description,
        origin: "system" as const,
        tags: [],
      });
    }
    // The parent's exclusions carry over to the derived view
    const newFields = filterExcludedFields(
      { fields: proposedFields, groups: [], version: 0 },
      parentIntent.exclusions.content,
    ).schema.fields;

    const fields = [...inheritedFields, ...newFields];
    const fieldNames = new Set(fields.map((f) => f.name));

    // Standards stay accepted if the derived view still has one of their fields
    const acceptedStandards = parentSchema.acceptedStandards?.filter((ref) =>
      getStandardById(ref.standardId)?.fieldConstraints.some((c) =>
        fieldNames.has(c.fieldKey),
      ),
    );

    const schema: PortfolioSchema = {
      fields,
      // Inherited fields keep their ids, so the parent's groups still apply
      groups: pruneGroups(
        parentSchema.groups ?? [],
        new Set(fields.map((f) => f.id)),
      ),
      version: parentSchema.version + 1,
      ...(acceptedStandards?.length ? { acceptedStandards } : {}),
    };

    const now = new Date().toISOString();
    const derivedIntent: StructuredIntent = {
      purpose: { content: parsed.derivedPurpose, updatedAt: now },
      audience: emptyIntentSection(),
      exclusions: { content: parentIntent.exclusions.content, updatedAt: now },
      constraints: { content: parentIntent.constraints.content, updatedAt: now },
    };

    return {
      success: true,
      result: {
        derivationType: parsed.derivationType,
        includedFieldKeys: inheritedFields.map((f) => f.name),
        additionalFields: newFields,
        schema,
        derivedPurpose: parsed.derivedPurpose,
        derivedIntent,
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
