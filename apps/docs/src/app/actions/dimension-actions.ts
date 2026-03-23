"use server";

import type { DimensionObject, DimensionScope } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { withTracing } from "@/lib/telemetry";
import type { Field, PortfolioSchema } from "@/lib/types";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

// ---------- generateDimensionsAction ----------

export interface GenerateDimensionsResponse {
  success: boolean;
  dimensions?: DimensionObject[];
  reasoning?: string;
  error?: string;
}

export async function generateDimensionsAction(
  prompt: string,
  maxDimensions: number = 5,
): Promise<GenerateDimensionsResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("generateDimensions", { prompt, maxDimensions },
      () => generateDimensionsReal(prompt, maxDimensions), { prompt });
  }
  return generateDimensionsReal(prompt, maxDimensions);
}

async function generateDimensionsReal(
  prompt: string,
  maxDimensions: number,
): Promise<GenerateDimensionsResponse> {
  if (!prompt || prompt.trim().length < 3) {
    return { success: true, dimensions: [], reasoning: "" };
  }

  try {
    const systemPrompt = `You are a domain analyst helping a user design a form. Given a description of a form or data collection task, identify the key DIMENSIONS of the problem domain — abstract conceptual facets that need to be understood before concrete form fields can be designed.

A dimension is NOT a form field. It is a domain facet — a category of ambiguity or variation that affects how the form should be structured. The goal is to surface what's unclear or assumed so the user can make informed decisions before committing to specific fields.

For each dimension, provide:
- name: short label (2-4 words)
- description: one sentence explaining what this facet of the domain covers
- importance: why this matters for the form's design — what decisions depend on it
- scope: one of "context" (who/where/when — situational factors), "measurement" (what to capture and how), "preference" (subjective choices, priorities), "constraint" (rules, limits, compliance)
- openQuestions: 2-3 specific questions the user should consider. These should surface ambiguity — things the user might not have thought about yet. Frame as questions, not suggestions.

User's description: ${prompt}

Return ONLY valid JSON in this exact format:
{
  "reasoning": "Brief explanation of why these dimensions were chosen and how they map the domain",
  "dimensions": [
    {
      "name": "Dimension Name",
      "description": "What this facet of the domain covers",
      "importance": "Why this matters for the form design",
      "scope": "context",
      "openQuestions": ["Question 1?", "Question 2?"]
    }
  ]
}

Rules:
- Generate ${Math.min(3, maxDimensions)}-${maxDimensions} dimensions
- Dimensions should be orthogonal — each covers a distinct facet of the domain
- Include non-obvious dimensions the user might not have considered
- Open questions should reveal genuine ambiguity, not ask the obvious
- Do NOT suggest specific form fields, input types, or values — that comes later`;

    const result = await withTracing({ tags: ["dimensions", "generate"] }, () =>
      generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt: systemPrompt,
        temperature: 0.3,
        experimental_telemetry: { isEnabled: true },
      }),
    );

    let parsedResult: {
      reasoning: string;
      dimensions: {
        name: string;
        description: string;
        importance: string;
        scope: DimensionScope;
        openQuestions: string[];
      }[];
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No valid JSON found in response");
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse dimensions response:", result.text);
      return {
        success: false,
        error: "Failed to parse dimensions from LLM response",
      };
    }

    if (!parsedResult.dimensions || !Array.isArray(parsedResult.dimensions)) {
      return {
        success: false,
        error: "Invalid response: missing dimensions array",
      };
    }

    const validScopes: DimensionScope[] = [
      "context",
      "measurement",
      "preference",
      "constraint",
    ];

    const dimensions: DimensionObject[] = parsedResult.dimensions
      .slice(0, maxDimensions)
      .map((dim, index) => ({
        id: `dim-${Date.now()}-${index}`,
        name: dim.name,
        description: dim.description,
        importance: dim.importance || "",
        scope: validScopes.includes(dim.scope) ? dim.scope : "context",
        openQuestions: Array.isArray(dim.openQuestions)
          ? dim.openQuestions
          : [],
        status: "suggested" as const,
        source: "system" as const,
        isActive: true,
        parentDimensionId: null,
        createdAt: new Date().toISOString(),
        editHistory: [],
      }));

    return {
      success: true,
      dimensions,
      reasoning: parsedResult.reasoning,
    };
  } catch (error) {
    console.error("Dimension generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------- refineDimensionAction ----------

export interface RefineDimensionResponse {
  success: boolean;
  dimension?: Partial<DimensionObject>;
  error?: string;
}

export async function refineDimensionAction(
  dimension: DimensionObject,
  basePrompt: string,
  userFeedback: string,
): Promise<RefineDimensionResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("refineDimension", { dimension, basePrompt, userFeedback },
      () => refineDimensionReal(dimension, basePrompt, userFeedback));
  }
  return refineDimensionReal(dimension, basePrompt, userFeedback);
}

async function refineDimensionReal(
  dimension: DimensionObject,
  basePrompt: string,
  userFeedback: string,
): Promise<RefineDimensionResponse> {
  try {
    const prompt = `You are refining a domain dimension for a form design process.

Base context: ${basePrompt}

Current dimension:
- Name: ${dimension.name}
- Description: ${dimension.description}
- Importance: ${dimension.importance}
- Scope: ${dimension.scope}
- Open questions: ${JSON.stringify(dimension.openQuestions)}

User feedback: ${userFeedback}

Based on the feedback, return an updated dimension. Return ONLY valid JSON:
{
  "name": "Updated Name",
  "description": "Updated description",
  "importance": "Updated importance",
  "scope": "context",
  "openQuestions": ["Updated question 1?", "Updated question 2?"]
}`;

    const result = await withTracing({ tags: ["dimensions", "refine"] }, () =>
      generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt,
        temperature: 0.3,
        experimental_telemetry: { isEnabled: true },
      }),
    );

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { success: false, error: "No valid JSON in response" };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return { success: true, dimension: parsed };
  } catch (error) {
    console.error("Dimension refinement error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------- dimensionsToSchemaAction ----------

export interface DimensionsToSchemaResponse {
  success: boolean;
  result?: {
    basePrompt: string;
    artifactFormSchema: PortfolioSchema;
    configuratorFormValues: Record<string, string | number | boolean>;
  };
  error?: string;
}

export async function dimensionsToSchemaAction(
  dimensions: DimensionObject[],
  basePrompt: string,
  acceptedStandards?: DetectedStandard[],
): Promise<DimensionsToSchemaResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard("dimensionsToSchema", { dimensions, basePrompt, acceptedStandards },
      () => dimensionsToSchemaReal(dimensions, basePrompt, acceptedStandards), { prompt: basePrompt });
  }
  return dimensionsToSchemaReal(dimensions, basePrompt, acceptedStandards);
}

async function dimensionsToSchemaReal(
  dimensions: DimensionObject[],
  basePrompt: string,
  acceptedStandards?: DetectedStandard[],
): Promise<DimensionsToSchemaResponse> {
  try {
    const dimensionSummary = dimensions
      .map(
        (d) =>
          `- ${d.name} [${d.scope}]: ${d.description}\n  Why it matters: ${d.importance}\n  Open questions: ${d.openQuestions.join("; ")}`,
      )
      .join("\n");

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

    const prompt = `You are a form schema generator. The user has confirmed these domain dimensions — abstract facets of their problem space. Your job is to translate them into a concrete form schema.

User's original form description: ${basePrompt}

Confirmed domain dimensions (the user reviewed and accepted these):
${dimensionSummary}
${standardsSection}
Use the dimensions as context to decide WHAT fields the form needs, what types they should be, and what options to offer. Each dimension may map to zero, one, or multiple fields depending on the domain. The open questions should inform your field design choices.

You must return:

1. **basePrompt**: Rewrite the user's original description to incorporate the confirmed dimension decisions. Write a natural, coherent description — don't just list dimensions. The basePrompt uses markdown formatting — preserve and use markdown (headings, lists, bold, etc.) in the rewritten version.

2. **artifactFormSchema**: The actual form fields. Choose appropriate field types:
   - Use "select" for choices with defined options (include options in validation.options as [{label, value}] objects)
   - Use "string" for free text
   - Use "number" for quantities
   - Use "boolean" for yes/no
   - Use "date" for dates
   - Use "email" for email addresses

3. **configuratorFormSchema**: 2-4 meta-questions about form behavior (e.g., required fields, validation strictness)

4. **configuratorFormValues**: Initial values for the configurator

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
- Field keys MUST be camelCase and descriptive${acceptedStandards && acceptedStandards.length > 0 ? '\n- For standard-sourced fields, include "standardReference" as a string property' : ""}
- Return ONLY valid JSON, no markdown

Return in this exact format:
{
  "basePrompt": "Rewritten form description incorporating dimension decisions",
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
  "configuratorFormSchema": {
    "name": "Configuration",
    "description": "Form configuration",
    "fields": {
      "configKey": {
        "label": "Config Question",
        "description": "Description",
        "type": "boolean",
        "required": false
      }
    }
  },
  "configuratorFormValues": {
    "configKey": true
  }
}`;

    const result = await withTracing(
      { tags: ["dimensions", "to-schema"] },
      () =>
        generateText({
          model: anthropic("claude-haiku-4-5-20251001"),
          prompt,
          temperature: 0.3,
          experimental_telemetry: { isEnabled: true },
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
    console.error("Dimensions to schema error:", error);
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
function normalizeOptions(raw: unknown): Array<{ label: string; value: string }> {
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
