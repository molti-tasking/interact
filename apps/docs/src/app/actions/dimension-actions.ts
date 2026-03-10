"use server";

import type { SchemaMetadata, SerializedSchema } from "@/lib/schema-manager";
import { initializeSerializedSchema } from "@/lib/schema-manager";
import type { DimensionObject, DimensionType } from "@/lib/dimension-types";
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
  maxDimensions: number = 8,
): Promise<GenerateDimensionsResponse> {
  if (!prompt || prompt.trim().length < 3) {
    return { success: true, dimensions: [], reasoning: "" };
  }

  try {
    const systemPrompt = `You are a data-space analyst. Given a user's description of a form or data collection task, identify the key DIMENSIONS of the data space that the form should capture.

A dimension is a conceptual axis of variation in the data — not a specific form field, but a category of information. For each dimension, specify:
- name: short label (2-4 words)
- description: one sentence explaining what this dimension captures
- type: one of "categorical" (unordered options), "ordinal" (ordered options), "numerical" (continuous/discrete numbers), "boolean" (yes/no)
- values: 3-6 candidate values that represent the range of this dimension. For numerical, give representative sample values as strings (e.g. "0", "50", "100"). For boolean, give ["Yes", "No"].

User's description: ${prompt}

Return ONLY valid JSON in this exact format:
{
  "reasoning": "Brief explanation of why these dimensions were chosen and how they span the data space",
  "dimensions": [
    {
      "name": "Dimension Name",
      "description": "What this dimension captures",
      "type": "categorical",
      "values": ["Value A", "Value B", "Value C"]
    }
  ]
}

Rules:
- Generate ${Math.min(4, maxDimensions)}-${maxDimensions} dimensions
- Dimensions should be orthogonal — each captures a distinct aspect
- Include both obvious dimensions and non-obvious ones the user might not have considered
- Values should be concrete and representative, not generic
- Prefer categorical/ordinal types for richer exploration`;

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
        type: DimensionType;
        values: string[];
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

    const dimensions: DimensionObject[] = parsedResult.dimensions
      .slice(0, maxDimensions)
      .map((dim, index) => ({
        id: `dim-${Date.now()}-${index}`,
        name: dim.name,
        description: dim.description,
        type: dim.type,
        values: dim.values,
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
    const prompt = `You are refining a data dimension for a form.

Base context: ${basePrompt}

Current dimension:
- Name: ${dimension.name}
- Description: ${dimension.description}
- Type: ${dimension.type}
- Values: ${JSON.stringify(dimension.values)}

User feedback: ${userFeedback}

Based on the feedback, return an updated dimension. Return ONLY valid JSON:
{
  "name": "Updated Name",
  "description": "Updated description",
  "type": "categorical",
  "values": ["Updated", "Values"]
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
          `- ${d.name} (${d.type}): ${d.description}. Values: [${d.values.join(", ")}]`,
      )
      .join("\n");

    const prompt = `You are a form schema generator. Convert these confirmed data dimensions into a concrete form schema.

User's original form description: ${basePrompt}

Confirmed dimensions (the user accepted these from a larger set of suggestions):
${dimensionSummary}

You must return:

1. **basePrompt**: Rewrite the user's original description to concisely incorporate the confirmed dimension decisions. This becomes the new canonical description of the form. Do NOT just list dimensions — write a natural, coherent description that a human would write if they had these dimensions in mind from the start.

2. **artifactFormSchema**: The actual form. Map each dimension to appropriate form field(s):
   - categorical → select field with options from values
   - ordinal → select field with ordered options
   - numerical → number field with appropriate min/max
   - boolean → boolean field
   Some dimensions may map to multiple fields if they represent compound concepts.

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
