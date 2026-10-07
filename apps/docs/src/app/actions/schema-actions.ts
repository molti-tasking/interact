"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import { convertPatchFieldType, newFieldId } from "@/lib/engine/schema-patch";
import {
  normalizeFieldKey,
  serializeForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { model, withLlmRetry } from "@/lib/model";
import {
  applyStandardPatterns,
  resolveDetectedStandards,
} from "@/lib/standards";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

export interface IntentToSchemaResponse {
  success: boolean;
  result?: {
    artifactFormSchema: PortfolioSchema;
    configuratorFormValues: Record<string, string | number | boolean>;
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

// ---------------------------------------------------------------------------
// Structured output schema (Zod → JSON Schema for the model)
// ---------------------------------------------------------------------------

const optionSchema = z.object({
  label: z.string(),
  value: z.string(),
});

const fieldSchema = z.object({
  label: z.string().describe("Human-readable field label"),
  description: z.string().optional().describe("Brief help text shown below the field — omit if the label is self-explanatory"),
  tooltip: z.string().optional().describe("Extra guidance shown on hover — omit if not needed"),
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
  standardReference: z
    .string()
    .optional()
    .describe("Reference to the domain standard, e.g. FHIR Patient.birthDate"),
});

const namedFieldSchema = fieldSchema.extend({
  key: z.string().describe("camelCase field key, e.g. firstName"),
});

const schemaResponseSchema = z.object({
  artifactFormSchema: z.object({
    name: z.string(),
    description: z.string(),
    appliedStandards: z.array(z.string()).optional(),
    fields: z.array(namedFieldSchema).describe("Form fields — the minimum viable set for this domain (max 15)"),
  }),
  configuratorFormValues: z
    .array(
      z.object({
        key: z.string(),
        value: z.union([z.string(), z.number(), z.boolean()]),
      }),
    )
    .describe("2-4 meta-settings about form behavior"),
});

// ---------------------------------------------------------------------------

async function intentToSchemaReal(
  basePrompt: string,
  requestedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  try {
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    await checkRateLimit();

    // Prompt content comes from the curated registry, not the request payload
    const acceptedStandards = resolveDetectedStandards(requestedStandards);

    // Build standard constraints section if standards were accepted
    let standardsSection = "";
    if (acceptedStandards.length > 0) {
      const constraintLines = acceptedStandards.flatMap((detected) =>
        detected.relevantConstraints.map((c) => {
          const reqLabel =
            c.required === "mandatory"
              ? "MANDATORY"
              : c.required === "recommended"
                ? "RECOMMENDED"
                : "OPTIONAL";
          const optionsNote = c.validationRules?.options
            ? ` Options: [${c.validationRules.options.join(", ")}]`
            : "";
          return `  - [${reqLabel}] ${c.label} (key: ${c.fieldKey}, type: ${c.type}): ${c.description} Ref: ${c.standardReference}${optionsNote}`;
        }),
      );

      standardsSection = `

DOMAIN STANDARD COMPLIANCE:
The user has accepted compliance with the following standard(s): ${acceptedStandards.map((s) => s.standard.name).join(", ")}.
You MUST include all MANDATORY fields listed below in the artifact form schema. RECOMMENDED fields should be included unless they conflict with the form's purpose. OPTIONAL fields may be included if relevant.

For each standard-sourced field, include "standardReference" in the field definition (e.g., "standardReference": "FHIR Patient.birthDate").

Include all mandatory standard fields alongside the minimum viable set. Do not add non-essential fields beyond those required by the standard and the domain.

Standard field constraints:
${constraintLines.join("\n")}
`;
    }

    const system = `You are a form schema generator. Given a description of what a form should collect, design a concrete form schema with appropriate fields.`;

    const prompt = `User's form description: ${basePrompt}
${standardsSection}
Analyze the description to identify:
- What data needs to be collected
- Who will fill out the form and in what context
- What is the MINIMUM STARTING set of fields that the user explicitly mentioned or directly implied? Only include fields that are clearly stated or unavoidably necessary. Do NOT anticipate domain-specific fields that the user hasn't mentioned — those will be discovered through follow-up design probes. For example, if the user says "registration form for a soccer club", generate name/contact fields but do NOT pre-add age groups, medical info, or payment fields unless the user explicitly mentioned them.
- What field types and options are most appropriate
- What validation or constraints apply

Design the form fields using these types:
- "select" for choices with defined options (include options in validation.options)
- "string" for free text
- "number" for quantities
- "boolean" for yes/no
- "date" for dates
- "email" for email addresses

RULES:
- Generate ONLY the fields the user explicitly mentioned or that are absolutely unavoidable (e.g. a name field for a registration). Typically 3-6 fields for an initial generation. Do NOT anticipate domain-specific requirements — those will be elicited through design probes. Err on the side of fewer fields; it is better to add fields through probes than to pre-generate fields the user didn't ask for.
- Field keys MUST be camelCase and descriptive
- "description" should be SHORT (a few words) — omit entirely if the label already makes the field obvious
- "tooltip" is for extra guidance that helps the user fill in the field correctly — omit if not needed${acceptedStandards.length > 0 ? '\n- For standard-sourced fields, include "standardReference"' : ""}`;

    const result = await withLlmRetry("schema-action", (abortSignal) =>
      withTracing({ tags: ["schema", "generate"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: schemaResponseSchema }),
          system,
          prompt,
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

    const parsedResult = result.output;

    // Standard references → canonical standard keys, so the compliance check
    // below and later regenerations see the same names.
    const keyByReference = new Map<string, string>();
    for (const detected of acceptedStandards) {
      for (const c of detected.relevantConstraints) {
        keyByReference.set(c.standardReference.trim().toLowerCase(), c.fieldKey);
      }
    }

    // Convert field format to internal Field type. Names are the merge key
    // for regenerations (`mergeRegeneratedSchema`), so they are normalized
    // and unique — a duplicate key from the model is dropped.
    const usedNames = new Set<string>();
    const fields: Field[] = [];
    for (const [index, f] of parsedResult.artifactFormSchema.fields.entries()) {
      const standardKey = f.standardReference
        ? keyByReference.get(f.standardReference.trim().toLowerCase())
        : undefined;
      let name = normalizeFieldKey(f.key || f.label, `field${index + 1}`);
      if (standardKey && !usedNames.has(standardKey)) name = standardKey;
      if (usedNames.has(name)) {
        console.warn(`[schema-action] Dropping duplicate field key "${name}"`);
        continue;
      }
      usedNames.add(name);
      fields.push({
        id: newFieldId(),
        name,
        label: f.label,
        type: convertPatchFieldType(f.type, f.validation),
        required: f.required,
        constraints: [],
        description: f.description,
        tooltip: f.tooltip,
        origin: "system" as const,
        tags: [],
      });
    }

    const artifactFormSchema: PortfolioSchema = {
      fields: applyStandardPatterns(fields, acceptedStandards),
      groups: [],
      version: 1,
    };

    // Compliance validation: check mandatory standard fields are present
    if (acceptedStandards.length > 0) {
      const generatedKeys = new Set(fields.map((f) => f.name));
      const missingMandatory: string[] = [];

      for (const detected of acceptedStandards) {
        for (const constraint of detected.relevantConstraints) {
          if (
            constraint.required === "mandatory" &&
            !generatedKeys.has(constraint.fieldKey)
          ) {
            missingMandatory.push(
              `${constraint.label} (${constraint.standardReference})`,
            );
          }
        }
      }

      if (missingMandatory.length > 0) {
        console.warn(
          `Compliance warning: ${missingMandatory.length} mandatory standard field(s) missing from generated schema: ${missingMandatory.join(", ")}`,
        );
      }
    }

    return {
      success: true,
      result: {
        artifactFormSchema,
        configuratorFormValues: Object.fromEntries(
          (parsedResult.configuratorFormValues ?? []).map((kv) => [kv.key, kv.value]),
        ),
      },
    };
  } catch (error) {
    console.error("Intent to schema error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
