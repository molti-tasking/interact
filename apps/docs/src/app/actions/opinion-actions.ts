"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { SchemaMetadata, SerializedSchema } from "@/lib/schema-manager";
import { initializeSerializedSchema } from "@/lib/schema-manager";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface OpinionInteraction {
  id: string;
  text: string;
  source: string;
  options: { value: string; label: string }[];
  selectedOption: string | null;
  status: "pending" | "loading" | "resolved" | "dismissed";
  dimensionId?: string | null;
  dimensionName?: string | null;
}

export interface GenerateOpinionResponse {
  success: boolean;
  interactions?: OpinionInteraction[];
  error?: string;
}

export async function generateOpinionInteractionsAction(
  basePrompt: string,
  maxOpinions: number = 5,
  dimensions?: DimensionObject[],
): Promise<GenerateOpinionResponse> {
  if (maxOpinions <= 0) return { success: true, interactions: [] };

  try {
    const acceptedDims = dimensions?.filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    const dimensionContext =
      acceptedDims && acceptedDims.length > 0
        ? `\n\nThe form is structured around these confirmed data dimensions:\n${acceptedDims.map((d) => `- "${d.name}" (${d.type}): ${d.description}. Values: [${d.values.join(", ")}]`).join("\n")}\n\nEach opinion question should refine a SPECIFIC dimension. Include a "dimensionName" field that exactly matches one of the dimension names above. Questions should ask about the values, granularity, validation, or presentation of that particular dimension.`
        : "";

    const prompt = `You are a form design assistant. Given a user's description of a form they want to create, generate ${Math.min(maxOpinions, 3)}-${maxOpinions} opinion questions that would help refine the form design. Each question should have 2-4 options.

User's form description: ${basePrompt}${dimensionContext}

Return ONLY valid JSON in this exact format:
{
  "interactions": [
    {
      "text": "What level of detail should the form collect?",${acceptedDims && acceptedDims.length > 0 ? '\n      "dimensionName": "Exact Dimension Name",' : ""}
      "options": [
        { "value": "minimal", "label": "Minimal - only essential fields" },
        { "value": "moderate", "label": "Moderate - common fields included" },
        { "value": "detailed", "label": "Detailed - comprehensive data collection" }
      ]
    }
  ]
}

Rules:
- Questions should be about form design choices, field selection, validation, UX, and structure
- Options should be mutually exclusive and clearly different
- Keep question text concise but descriptive
- Values should be camelCase identifiers, labels should be human-readable`;

    const result = await generateText({
      model: anthropic("claude-haiku-4-5-20251001"),
      prompt,
      temperature: 0.3,
    });

    let parsedResult: {
      interactions: {
        text: string;
        dimensionName?: string;
        options: { value: string; label: string }[];
      }[];
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch {
      console.error(
        "Failed to parse opinion interactions response:",
        result.text,
      );
      return {
        success: false,
        error: "Failed to parse opinion interactions from LLM response",
      };
    }

    if (
      !parsedResult.interactions ||
      !Array.isArray(parsedResult.interactions)
    ) {
      return {
        success: false,
        error: "Invalid response: missing interactions array",
      };
    }

    // Build a name→id lookup for dimension matching
    const dimLookup = new Map(
      (acceptedDims ?? []).map((d) => [d.name.toLowerCase(), d]),
    );

    const interactions: OpinionInteraction[] = parsedResult.interactions
      .slice(0, maxOpinions)
      .map((interaction, index) => {
        const matchedDim = interaction.dimensionName
          ? dimLookup.get(interaction.dimensionName.toLowerCase())
          : undefined;

        return {
          id: `opinion-${Date.now()}-${index}`,
          text: interaction.text,
          source: "llm",
          options: interaction.options,
          selectedOption: null,
          status: "pending" as const,
          dimensionId: matchedDim?.id ?? null,
          dimensionName: matchedDim?.name ?? interaction.dimensionName ?? null,
        };
      });

    return { success: true, interactions };
  } catch (error) {
    console.error("Opinion generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface ResolveOpinionRequest {
  basePrompt: string;
  currentSchema: SerializedSchema;
  interactionText: string;
  selectedOptionLabel: string;
  maxFollowUps?: number;
}

export interface ResolveOpinionResponse {
  success: boolean;
  result?: {
    basePrompt: string;
    artifactFormSchema: SerializedSchema;
    configuratorFormSchema: SerializedSchema;
    configuratorFormValues: Record<string, string | number | boolean>;
    followUpInteractions: OpinionInteraction[];
  };
  error?: string;
}

export async function resolveOpinionInteractionAction(
  request: ResolveOpinionRequest,
): Promise<ResolveOpinionResponse> {
  try {
    const { basePrompt, currentSchema, interactionText, selectedOptionLabel, maxFollowUps = 3 } =
      request;

    const prompt = `You are a form design assistant. The user is refining a form through interactive opinion choices.

Current form description: ${basePrompt}

Current form schema:
${JSON.stringify(currentSchema, null, 2)}

The user was asked: "${interactionText}"
They chose: "${selectedOptionLabel}"

Based on this choice, you must:
1. Update the base prompt to concisely incorporate this design decision (rewrite, don't append)
2. Update the form schemas to reflect this choice
3. Optionally generate 0-${maxFollowUps} follow-up opinion questions if the choice opens up new design decisions${maxFollowUps === 0 ? ". Do NOT generate any follow-up questions, return an empty followUpInteractions array." : ""}

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options array
- Field keys MUST be camelCase and descriptive
- Return ONLY valid JSON, no markdown or explanation

Return ONLY valid JSON in this exact format:
{
  "basePrompt": "Updated concise form description incorporating the user's choice",
  "artifactFormSchema": {
    "name": "Form Name",
    "description": "Form description",
    "fields": {
      "fieldKey": {
        "label": "Field Label",
        "description": "Field description",
        "type": "string",
        "required": true
      }
    }
  },
  "configuratorFormSchema": {
    "name": "Configuration Name",
    "description": "Configuration description",
    "fields": {
      "configKey": {
        "label": "Config Question",
        "description": "Config description",
        "type": "boolean",
        "required": false
      }
    }
  },
  "configuratorFormValues": {
    "configKey": true
  },
  "followUpInteractions": [
    {
      "text": "Optional follow-up question?",
      "options": [
        { "value": "optionA", "label": "Option A description" },
        { "value": "optionB", "label": "Option B description" }
      ]
    }
  ]
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
      followUpInteractions?: {
        text: string;
        options: { value: string; label: string }[];
      }[];
    };

    try {
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No valid JSON found in response");
      }
      parsedResult = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse resolve opinion response:", result.text);
      return {
        success: false,
        error: "Failed to parse opinion resolution from LLM response",
      };
    }

    if (
      !parsedResult.basePrompt ||
      !parsedResult.artifactFormSchema ||
      !parsedResult.configuratorFormSchema
    ) {
      return {
        success: false,
        error: "Invalid response: missing required fields",
      };
    }

    const artifactSchema = initializeSerializedSchema(
      parsedResult.artifactFormSchema,
    );
    const configuratorSchema = initializeSerializedSchema(
      parsedResult.configuratorFormSchema,
    );

    const followUpInteractions: OpinionInteraction[] = (
      parsedResult.followUpInteractions || []
    ).slice(0, maxFollowUps).map((interaction, index) => ({
      id: `opinion-${Date.now()}-followup-${index}`,
      text: interaction.text,
      source: "llm",
      options: interaction.options,
      selectedOption: null,
      status: "pending" as const,
      dimensionId: null,
      dimensionName: null,
    }));

    return {
      success: true,
      result: {
        basePrompt: parsedResult.basePrompt,
        artifactFormSchema: artifactSchema.schema,
        configuratorFormSchema: configuratorSchema.schema,
        configuratorFormValues: parsedResult.configuratorFormValues || {},
        followUpInteractions,
      },
    };
  } catch (error) {
    console.error("Opinion resolution error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
