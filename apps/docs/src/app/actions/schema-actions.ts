"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import { serializeForLLM } from "@/lib/engine/structured-intent";
import { model } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
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
    fields: z.array(namedFieldSchema).max(15).describe("Form fields — the minimum viable set for this domain"),
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
  acceptedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  try {
    // Build standard constraints section if standards were accepted
    let standardsSection = "";
    if (acceptedStandards && acceptedStandards.length > 0) {
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

    const prompt = `You are a form schema generator. Given a description of what a form should collect, design a concrete form schema with appropriate fields.

User's form description: ${basePrompt}
${standardsSection}
Analyze the description to identify:
- What data needs to be collected
- Who will fill out the form and in what context
- What is the MINIMUM VIABLE set of fields for this form's core purpose — the number depends on the domain (a simple signup may need 3-4 fields; a clinical record or complex intake may need 8-12). Use your domain knowledge to judge the right number. Additional fields can still be added iteratively through follow-up design probes, so do not be exhaustive — but do not artificially limit yourself to a small number when the domain clearly requires more.
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
- Generate the MINIMUM VIABLE set of fields for this domain. For simple forms (signups, RSVPs) that may be 3-5 fields; for complex domains (clinical records, regulatory forms) it may be 8-12. Use your judgment — include what a domain expert would consider essential, but do not pad with nice-to-haves. Additional fields can be added through follow-up design probes.
- Field keys MUST be camelCase and descriptive
- "description" should be SHORT (a few words) — omit entirely if the label already makes the field obvious
- "tooltip" is for extra guidance that helps the user fill in the field correctly — omit if not needed${acceptedStandards && acceptedStandards.length > 0 ? '\n- For standard-sourced fields, include "standardReference"' : ""}`;

    const LLM_TIMEOUT_MS = 45_000; // 45s timeout (avoids 240s hangs)

    async function callWithTimeout() {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
      try {
        return await withTracing({ tags: ["schema", "generate"] }, () =>
          generateText({
            model,
            output: Output.object({ schema: schemaResponseSchema }),
            prompt,
            temperature: 0.3,
            abortSignal: controller.signal,
            experimental_telemetry: {
              isEnabled: true,
              functionId: "schema-action",
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
      console.warn(`[schema-action] First attempt failed (${err instanceof Error ? err.message : err}), retrying...`);
      result = await callWithTimeout();
    }

    if (!result.output) {
      console.error("No structured output from schema generation");
      return {
        success: false,
        error: "Model did not return structured output",
      };
    }

    const parsedResult = result.output;

    // Convert field format to internal Field type
    const fields: Field[] = parsedResult.artifactFormSchema.fields.map(
      (f, index) => {
        const fieldType = convertFieldType(f.type, f.validation);
        return {
          id: `field-${Date.now()}-${index}`,
          name: f.key,
          label: f.label,
          type: fieldType,
          required: f.required,
          constraints: [],
          description: f.description,
          tooltip: f.tooltip,
          origin: "system" as const,
          tags: [],
        };
      },
    );

    const artifactFormSchema: PortfolioSchema = {
      fields,
      groups: [],
      version: 1,
    };

    // Compliance validation: check mandatory standard fields are present
    if (acceptedStandards && acceptedStandards.length > 0) {
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

// Helper to convert old field type string to new FieldType
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
    case "email":
      return { kind: "text" };
    default:
      return { kind: "text" };
  }
}

/** Coerce options to {label, value}[] — handles both string and object inputs. */
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
    if (o && typeof o === "object" && "label" in o)
      return { label: String(o.label), value: String(o.label) };
    const s = String(o);
    return { label: s, value: s };
  });
}
