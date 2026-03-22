"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { withTracing } from "@/lib/telemetry";
import type { PortfolioSchema } from "@/lib/types";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

export interface OpinionInteraction {
  id: string;
  text: string;
  explanation?: string;
  layer: "intent" | "dimensions" | "both";
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
  acceptedStandards?: DetectedStandard[],
): Promise<GenerateOpinionResponse> {
  if (maxOpinions <= 0) return { success: true, interactions: [] };

  try {
    const acceptedDims = dimensions?.filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    const dimensionContext =
      acceptedDims && acceptedDims.length > 0
        ? `\n\nThe form is structured around these confirmed domain dimensions:\n${acceptedDims.map((d) => `- "${d.name}" [${d.scope}]: ${d.description}. Why it matters: ${d.importance}`).join("\n")}\n\nEach opinion question should refine a SPECIFIC dimension — making concrete field-level decisions (what fields, what options, what validation). Include a "dimensionName" field that exactly matches one of the dimension names above.`
        : "";

    // Build standard-aware context for optional/recommended fields
    let standardsContext = "";
    if (acceptedStandards && acceptedStandards.length > 0) {
      const optionalFields = acceptedStandards.flatMap((detected) =>
        detected.relevantConstraints
          .filter(
            (c) => c.required === "recommended" || c.required === "optional",
          )
          .map(
            (c) =>
              `- ${c.label} (${c.required}): ${c.description} [${detected.standard.name}: ${c.standardReference}]`,
          ),
      );
      if (optionalFields.length > 0) {
        standardsContext = `\n\nDOMAIN STANDARD CONTEXT:\nThe form is being built to comply with: ${acceptedStandards.map((s) => s.standard.name).join(", ")}.\nThe following optional/recommended fields from the standard(s) could be included. Generate opinion questions that ask the user whether to include these:\n${optionalFields.join("\n")}\n\nFor standard-related opinions, frame them as "The [Standard Name] standard recommends including [field]. Should this form include it?" with options like "Yes, include it" / "No, not needed for this form".`;
      }
    }

    const prompt = `You are a form design assistant. Generate ${Math.min(maxOpinions, 3)}-${maxOpinions} refinement questions to improve this form design. Each question has 2-4 options.

User's form description: ${basePrompt}${dimensionContext}${standardsContext}

Each question must be classified by layer:
- "intent": about the form's purpose, audience, or high-level goals
- "dimensions": about specific aspects of data collection, field choices, or structure
- "both": spans both intent and concrete form structure

Return ONLY valid JSON:
{
  "interactions": [
    {
      "text": "Who is the primary audience?",
      "explanation": "Optional: only if the question needs brief context",
      "layer": "intent",${acceptedDims && acceptedDims.length > 0 ? '\n      "dimensionName": "Exact Dimension Name",' : ""}
      "options": [
        { "value": "internal", "label": "Internal staff" },
        { "value": "external", "label": "External users" }
      ]
    }
  ]
}

Rules:
- Question text must be SHORT — one sentence, no preamble
- "explanation" is OPTIONAL — only include if the question truly needs clarification. Most questions should NOT have one.
- Options: short labels (2-5 words each), mutually exclusive
- Mix of intent-level and dimension-level questions
- Values should be camelCase identifiers`;

    const result = await withTracing({ tags: ["opinions", "generate"] }, () =>
      generateText({
        model: anthropic("claude-haiku-4-5-20251001"),
        prompt,
        temperature: 0.3,
        experimental_telemetry: { isEnabled: true },
      }),
    );

    let parsedResult: {
      interactions: {
        text: string;
        explanation?: string;
        layer?: "intent" | "dimensions" | "both";
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

        const validLayers = ["intent", "dimensions", "both"] as const;
        const layer = interaction.layer && validLayers.includes(interaction.layer)
          ? interaction.layer
          : "both";

        return {
          id: `opinion-${Date.now()}-${index}`,
          text: interaction.text,
          explanation: interaction.explanation || undefined,
          layer,
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
  currentSchema: PortfolioSchema;
  interactionText: string;
  selectedOptionLabel: string;
  maxFollowUps?: number;
}

export interface ResolveOpinionResponse {
  success: boolean;
  result?: {
    basePrompt: string;
    artifactFormSchema: PortfolioSchema;
    followUpInteractions: OpinionInteraction[];
  };
  error?: string;
}

export async function resolveOpinionInteractionAction(
  request: ResolveOpinionRequest,
): Promise<ResolveOpinionResponse> {
  try {
    const {
      basePrompt,
      currentSchema,
      interactionText,
      selectedOptionLabel,
      maxFollowUps = 3,
    } = request;

    const prompt = `You are a form design assistant. The user is refining a form through interactive opinion choices.

Current form description: ${basePrompt}

Current form schema:
${JSON.stringify(currentSchema, null, 2)}

The user was asked: "${interactionText}"
They chose: "${selectedOptionLabel}"

Based on this choice, you must:
1. Update the base prompt to concisely incorporate this design decision (rewrite, don't append). The basePrompt uses markdown formatting — preserve and use markdown (headings, lists, bold, etc.) in the rewritten version.
2. Update the form schemas to reflect this choice
3. Optionally generate 0-${maxFollowUps} follow-up opinion questions if the choice opens up new design decisions${maxFollowUps === 0 ? ". Do NOT generate any follow-up questions, return an empty followUpInteractions array." : ""}

IMPORTANT RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
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

    const result = await withTracing({ tags: ["opinions", "resolve"] }, () =>
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
          }
        >;
      };
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

    if (!parsedResult.basePrompt || !parsedResult.artifactFormSchema) {
      return {
        success: false,
        error: "Invalid response: missing required fields",
      };
    }

    // Convert to PortfolioSchema
    const fields = Object.entries(parsedResult.artifactFormSchema.fields).map(
      ([key, f], index) => ({
        id: `field-${Date.now()}-${index}`,
        name: key,
        label: f.label,
        type: convertOldFieldType(f.type, f.validation),
        required: f.required,
        constraints: [],
        description: f.description,
        origin: "system" as const,
        tags: [],
      }),
    );

    const artifactFormSchema: PortfolioSchema = {
      fields,
      groups: [],
      version: 1,
    };

    const followUpInteractions: OpinionInteraction[] = (
      parsedResult.followUpInteractions || []
    )
      .slice(0, maxFollowUps)
      .map((interaction, index) => ({
        id: `opinion-${Date.now()}-followup-${index}`,
        text: interaction.text,
        explanation: undefined,
        layer: "both" as const,
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
        artifactFormSchema,
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

function convertOldFieldType(
  type: string,
  validation?: { options?: string[] },
): PortfolioSchema["fields"][0]["type"] {
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
