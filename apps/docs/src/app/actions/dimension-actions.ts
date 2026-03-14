"use server";

import type { DimensionObject, DimensionScope } from "@/lib/dimension-types";
import type { SchemaMetadata, SerializedSchema } from "@/lib/schema-manager";
import { initializeSerializedSchema } from "@/lib/schema-manager";
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

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt: systemPrompt,
      temperature: 0.3,
    });

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

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt,
      temperature: 0.3,
    });

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
    artifactFormSchema: SerializedSchema;
    configuratorFormSchema: SerializedSchema;
    configuratorFormValues: Record<string, string | number | boolean>;
  };
  error?: string;
}

export async function dimensionsToSchemaAction(
  dimensions: DimensionObject[],
  basePrompt: string,
): Promise<DimensionsToSchemaResponse> {
  try {
    const dimensionSummary = dimensions
      .map(
        (d) =>
          `- ${d.name} [${d.scope}]: ${d.description}\n  Why it matters: ${d.importance}\n  Open questions: ${d.openQuestions.join("; ")}`,
      )
      .join("\n");

    const prompt = `You are a form schema generator. The user has confirmed these domain dimensions — abstract facets of their problem space. Your job is to translate them into a concrete form schema.

User's original form description: ${basePrompt}

Confirmed domain dimensions (the user reviewed and accepted these):
${dimensionSummary}

Use the dimensions as context to decide WHAT fields the form needs, what types they should be, and what options to offer. Each dimension may map to zero, one, or multiple fields depending on the domain. The open questions should inform your field design choices.

You must return:

1. **basePrompt**: Rewrite the user's original description to incorporate the confirmed dimension decisions. Write a natural, coherent description — don't just list dimensions.

2. **artifactFormSchema**: The actual form fields. Choose appropriate field types:
   - Use "select" for choices with defined options (include options in validation.options)
   - Use "string" for free text
   - Use "number" for quantities
   - Use "boolean" for yes/no
   - Use "date" for dates
   - Use "email" for email addresses

3. **configuratorFormSchema**: 2-4 meta-questions about form behavior (e.g., required fields, validation strictness)

4. **configuratorFormValues**: Initial values for the configurator

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options array
- Field keys MUST be camelCase and descriptive
- Return ONLY valid JSON, no markdown

Return in this exact format:
{
  "basePrompt": "Rewritten form description incorporating dimension decisions",
  "artifactFormSchema": {
    "name": "Form Name",
    "description": "Form description",
    "fields": {
      "fieldKey": {
        "label": "Field Label",
        "description": "Field description",
        "type": "select",
        "required": true,
        "validation": { "options": ["Option A", "Option B"] }
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

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt,
      temperature: 0.3,
    });

    let parsedResult: {
      basePrompt: string;
      artifactFormSchema: SchemaMetadata;
      configuratorFormSchema: SchemaMetadata;
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

    if (
      !parsedResult.artifactFormSchema ||
      !parsedResult.configuratorFormSchema
    ) {
      return {
        success: false,
        error: "Invalid response: missing required schemas",
      };
    }

    const artifactSchema = initializeSerializedSchema(
      parsedResult.artifactFormSchema,
    );
    const configuratorSchema = initializeSerializedSchema(
      parsedResult.configuratorFormSchema,
    );

    return {
      success: true,
      result: {
        basePrompt: parsedResult.basePrompt || basePrompt,
        artifactFormSchema: artifactSchema.schema,
        configuratorFormSchema: configuratorSchema.schema,
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
