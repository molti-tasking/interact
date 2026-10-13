"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import {
  FORM_MODEL_RULES,
  SCALE_FIELD_RULES,
  scaleSpecSchema,
  schemaPatchRules,
  schemaPatchSchema,
} from "@/lib/engine/form-model";
import {
  convertPatchFieldType,
  newFieldId,
  type SchemaPatch,
} from "@/lib/engine/schema-patch";
import {
  normalizeFieldKey,
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
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
    .enum(["string", "number", "boolean", "date", "email", "select", "scale"])
    .describe("Field input type"),
  // Right after `type`: further away, the model tends to skip it
  scale: scaleSpecSchema.optional(),
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
});

// ---------------------------------------------------------------------------

async function intentToSchemaReal(
  basePrompt: string,
  requestedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  try {
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    await guardLlmRequest();

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

    const system = `You are a form schema generator. Given a description of what a form should collect, design a concrete form schema with appropriate fields.

${FORM_MODEL_RULES}`;

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
- "scale" for ratings and Likert items (see below)
- "string" for free text
- "number" for quantities
- "boolean" for yes/no
- "date" for dates
- "email" for email addresses

RULES:
${SCALE_FIELD_RULES}
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
        type: convertPatchFieldType(f.type, f.validation, f.scale),
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

    return { success: true, result: { artifactFormSchema } };
  } catch (error) {
    console.error("Intent to schema error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
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
  /** Answered design probes, most recent first — why fields exist */
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
 * everything the edit doesn't touch — fields added by design probes, direct
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

    const system = `You are a form schema editor. The description of an existing form was edited; you update the form to match, changing only what the edit requires.

${FORM_MODEL_RULES}`;

    const decisionBlock =
      decisions.length > 0
        ? `\nDecisions the user made earlier while refining the form (the schema reflects them):\n${decisions.map((d) => `- "${d.question}" → "${d.answer}"`).join("\n")}\n`
        : "";
    const standardsBlock =
      standardNames.length > 0
        ? `\nThe form follows these standards — keep their fields: ${standardNames.join(", ")}\n`
        : "";

    const prompt = `Previous form description:
${previousPrompt || "(empty)"}

Edited form description:
${basePrompt}

Current form schema (it already reflects earlier decisions and direct edits):
${serializeSchemaForLLM(currentSchema)}
${decisionBlock}${standardsBlock}
Return a "schemaPatch" with ONLY the changes the edit calls for:
- "addFields": data the edited description now asks for that the form doesn't collect yet
- "updateFields": fields whose meaning, options or required status the edit changes (full field definition, same key)
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

    const { summary, schemaPatch } = result.output;
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
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
