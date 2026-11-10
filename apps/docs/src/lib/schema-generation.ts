/**
 * Generating a form from its description — the parts shared by the server
 * action (`intentToSchemaAction`, one response) and the streaming route
 * (`/api/llm-stream/generate-schema`, fields as they are written): the
 * structured-output schema, the prompt, and the post-processing that turns
 * the model's output into a stored schema. Both paths end in
 * `finalizeGeneratedSchema`, so what is committed is the same either way.
 */

import type { DetectedStandard } from "@/lib/domain-standards";
import {
  FORM_MODEL_RULES,
  llmFieldSchema,
  SCALE_FIELD_RULES,
  SECTION_RULES,
} from "interact/forms/form-model";
import { fenced } from "interact/forms/prompt";
import {
  convertPatchFieldType,
  newFieldId,
} from "interact/forms/schema-patch";
import { sectionsFromTitles } from "interact/forms/sections";
import { normalizeFieldKey } from "interact/forms/structured-intent";
import {
  applyStandardPatterns,
  resolveDetectedStandards,
} from "@/lib/standards";
import type { Field, PortfolioSchema } from "@/lib/types";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Structured output schema (Zod → JSON Schema for the model)
// ---------------------------------------------------------------------------

/** The shared field definition, plus where generation places and sources it. */
const namedFieldSchema = llmFieldSchema.extend({
  standardReference: z
    .string()
    .optional()
    .describe("Reference to the domain standard, e.g. FHIR Patient.birthDate"),
  section: z
    .string()
    .optional()
    .describe("Title of the section this field is in — omit when the form has no sections"),
});

export const schemaResponseSchema = z.object({
  artifactFormSchema: z.object({
    name: z.string(),
    description: z.string(),
    appliedStandards: z.array(z.string()).optional(),
    sections: z
      .array(
        z.object({
          title: z.string(),
          description: z
            .string()
            .describe("Intro shown under the title, e.g. instructions for rating statements; empty if none"),
        }),
      )
      .optional()
      .describe("The form's sections in order — omit when it needs none"),
    fields: z.array(namedFieldSchema).describe("Form fields — the minimum viable set for this domain (max 15)"),
  }),
});

export type GeneratedSchemaOutput = z.infer<typeof schemaResponseSchema>;
type GeneratedField = GeneratedSchemaOutput["artifactFormSchema"]["fields"][number];

type AcceptedStandards = ReturnType<typeof resolveDetectedStandards>;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export interface SchemaGenerationRequest {
  system: string;
  prompt: string;
  /** From the curated registry, not the request payload */
  acceptedStandards: AcceptedStandards;
}

export function buildSchemaGenerationRequest(
  basePrompt: string,
  requestedStandards?: DetectedStandard[],
): SchemaGenerationRequest {
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

  const prompt = `User's form description:
${fenced("form_description", basePrompt)}
${standardsSection}
Analyze the description to identify:
- What data needs to be collected
- Who will fill out the form and in what context
- What is the MINIMUM STARTING set of fields that the user explicitly mentioned or directly implied? Only include fields that are clearly stated or unavoidably necessary. Do NOT anticipate domain-specific fields that the user hasn't mentioned — those will be discovered through follow-up elicitation questions. For example, if the user says "registration form for a soccer club", generate name/contact fields but do NOT pre-add age groups, medical info, or payment fields unless the user explicitly mentioned them.
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
${SECTION_RULES} A questionnaire's rating statements usually get their own section, with the rating instructions as its description.
- Generate ONLY the fields the user explicitly mentioned or that are absolutely unavoidable (e.g. a name field for a registration). Typically 3-6 fields for an initial generation. Do NOT anticipate domain-specific requirements — those will be elicited through elicitation questions. Err on the side of fewer fields; it is better to add fields through follow-up questions than to pre-generate fields the user didn't ask for.
- Field keys MUST be camelCase and descriptive
- "description" should be SHORT (a few words) — omit entirely if the label already makes the field obvious
- "tooltip" is for extra guidance that helps the user fill in the field correctly — omit if not needed${acceptedStandards.length > 0 ? '\n- For standard-sourced fields, include "standardReference"' : ""}`;

  return { system, prompt, acceptedStandards };
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

function toField(f: GeneratedField, name: string): Field {
  return {
    id: newFieldId(),
    name,
    label: f.label,
    type: convertPatchFieldType(f.type, f.validation, f.scale),
    required: f.required,
    constraints: [],
    description: f.description,
    tooltip: f.tooltip,
    origin: "system",
    tags: [],
  };
}

/**
 * The model's output as a stored schema: normalized, unique field names
 * (standard fields under their canonical keys), internal field types,
 * standard patterns, sections. Logs a warning when a mandatory field of an
 * accepted standard is missing.
 */
export function finalizeGeneratedSchema(
  parsed: GeneratedSchemaOutput,
  acceptedStandards: AcceptedStandards,
): PortfolioSchema {
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
  const sectionOfField = new Map<string, string>();
  for (const [index, f] of parsed.artifactFormSchema.fields.entries()) {
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
    const field = toField(f, name);
    if (f.section?.trim()) sectionOfField.set(field.id, f.section);
    fields.push(field);
  }

  const schema: PortfolioSchema = sectionsFromTitles(
    {
      fields: applyStandardPatterns(fields, acceptedStandards),
      groups: [],
      version: 1,
    },
    (field) => sectionOfField.get(field.id),
    parsed.artifactFormSchema.sections,
  );

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

  return schema;
}
