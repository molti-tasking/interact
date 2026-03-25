"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import { serializeForLLM } from "@/lib/engine/structured-intent";
import { withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { model } from "@/lib/model";
import { generateText } from "ai";

export interface IntentToSchemaResponse {
  success: boolean;
  result?: {
    basePrompt: string;
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

async function intentToSchemaReal(
  basePrompt: string,
  acceptedStandards?: DetectedStandard[],
): Promise<IntentToSchemaResponse> {
  try {
    // Build standard constraints section if standards were accepted
    let standardsSection = "";
    const appliedStandardIds: string[] = [];
    if (acceptedStandards && acceptedStandards.length > 0) {
      const constraintLines = acceptedStandards.flatMap((detected) => {
        appliedStandardIds.push(detected.standard.id);
        return detected.relevantConstraints.map((c) => {
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
        });
      });

      standardsSection = `

DOMAIN STANDARD COMPLIANCE:
The user has accepted compliance with the following standard(s): ${acceptedStandards.map((s) => s.standard.name).join(", ")}.
You MUST include all MANDATORY fields listed below in the artifact form schema. RECOMMENDED fields should be included unless they conflict with the form's purpose. OPTIONAL fields may be included if relevant.

For each standard-sourced field, include "standardReference" in the field definition (e.g., "standardReference": "FHIR Patient.birthDate").

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
- What field types and options are most appropriate
- What validation or constraints apply

You must return:

1. **basePrompt**: Rewrite the user's description to be more precise and structured. Write a natural, coherent description using markdown formatting (headings, lists, bold, etc.).

2. **artifactFormSchema**: The form fields. Choose appropriate field types:
   - Use "select" for choices with defined options (include options in validation.options as [{label, value}] objects)
   - Use "string" for free text
   - Use "number" for quantities
   - Use "boolean" for yes/no
   - Use "date" for dates
   - Use "email" for email addresses

3. **configuratorFormValues**: Initial configuration values (2-4 meta-settings about form behavior)

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
- Field keys MUST be camelCase and descriptive${acceptedStandards && acceptedStandards.length > 0 ? '\n- For standard-sourced fields, include "standardReference" as a string property' : ""}
- Return ONLY valid JSON, no markdown

Return in this exact format:
{
  "basePrompt": "Rewritten form description",
  "artifactFormSchema": {
    "name": "Form Name",
    "description": "Form description",${appliedStandardIds.length > 0 ? `\n    "appliedStandards": ${JSON.stringify(appliedStandardIds)},` : ""}
    "fields": {
      "fieldKey": {
        "label": "Field Label",
        "description": "Field description",
        "type": "select",
        "required": true,
        "validation": { "options": [{"label": "Option A", "value": "option_a"}, {"label": "Option B", "value": "option_b"}] }
      }
    }
  },
  "configuratorFormValues": {
    "configKey": true
  }
}`;

    const result = await withTracing(
      { tags: ["schema", "generate"] },
      () =>
        generateText({
          model,
          prompt,
          temperature: 0.3,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "schema-action",
            recordInputs: true,
            recordOutputs: true,
          },
        }),
    );

    let parsedResult: {
      basePrompt: string;
      artifactFormSchema: {
        name: string;
        description: string;
        fields: Record<
          string,
          {
            label: string;
            description?: string;
            type: string;
            required: boolean;
            validation?: { options?: string[] };
            standardReference?: string;
          }
        >;
        appliedStandards?: string[];
      };
      configuratorFormValues: Record<string, string | number | boolean>;
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No valid JSON found in response");
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse schema response:", result.text);
      return {
        success: false,
        error: "Failed to parse schema from LLM response",
      };
    }

    if (!parsedResult.artifactFormSchema) {
      return {
        success: false,
        error: "Invalid response: missing required schemas",
      };
    }

    // Convert old field format to new Field format
    const fields: Field[] = Object.entries(
      parsedResult.artifactFormSchema.fields,
    ).map(([key, f], index) => {
      const fieldType = convertFieldType(f.type, f.validation);
      return {
        id: `field-${Date.now()}-${index}`,
        name: key,
        label: f.label,
        type: fieldType,
        required: f.required,
        constraints: [],
        description: f.description,
        origin: "system" as const,
        tags: [],
      };
    });

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
        basePrompt: parsedResult.basePrompt || basePrompt,
        artifactFormSchema,
        configuratorFormValues: parsedResult.configuratorFormValues || {},
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
  validation?: { options?: string[] },
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
