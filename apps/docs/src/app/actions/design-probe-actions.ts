"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import { serializeForLLM } from "@/lib/engine/structured-intent";
import { model } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/** Shape returned by the LLM / server action (no portfolioId or createdAt — those are added by the DB). */
export interface DesignProbeRaw {
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

export interface GenerateDesignProbesResponse {
  success: boolean;
  interactions?: DesignProbeRaw[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

const probeResponseSchema = z.object({
  interactions: z.array(
    z.object({
      text: z.string().describe("Short question, one sentence"),
      explanation: z.string().optional().describe("Brief context if needed"),
      layer: z.enum(["intent", "dimensions", "both"]),
      dimensionName: z
        .string()
        .optional()
        .describe("Exact dimension name if applicable"),
      options: z.array(z.object({ value: z.string(), label: z.string() })),
    }),
  ),
});

const optionSchema = z.object({ label: z.string(), value: z.string() });

const resolveProbeSchema = z.object({
  refinementDelta: z
    .string()
    .describe("Single sentence summarizing the design decision"),
  artifactFormSchema: z.object({
    name: z.string(),
    description: z.string(),
    fields: z.array(
      z.object({
        key: z.string().describe("camelCase field key"),
        label: z.string(),
        description: z.string().optional(),
        type: z.enum([
          "string",
          "number",
          "boolean",
          "date",
          "email",
          "select",
        ]),
        required: z.boolean(),
        validation: z
          .object({ options: z.array(optionSchema).optional() })
          .optional(),
      }),
    ),
  }),
  configuratorFormValues: z.array(
    z.object({
      key: z.string(),
      value: z.union([z.string(), z.number(), z.boolean()]),
    }),
  ),
  followUpInteractions: z
    .array(
      z.object({
        text: z.string(),
        options: z.array(z.object({ value: z.string(), label: z.string() })),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------

export async function generateDesignProbesAction(
  intent: StructuredIntent,
  maxProbes: number = 5,
  dimensions?: DimensionObject[],
  acceptedStandards?: DetectedStandard[],
): Promise<GenerateDesignProbesResponse> {
  const basePrompt = serializeForLLM(intent);
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "generateDesignProbesAction",
      { basePrompt, maxProbes, dimensions, acceptedStandards },
      () =>
        generateDesignProbesReal(
          basePrompt,
          maxProbes,
          dimensions,
          acceptedStandards,
        ),
      { prompt: basePrompt },
    );
  }
  return generateDesignProbesReal(
    basePrompt,
    maxProbes,
    dimensions,
    acceptedStandards,
  );
}

async function generateDesignProbesReal(
  basePrompt: string,
  maxProbes: number,
  dimensions?: DimensionObject[],
  acceptedStandards?: DetectedStandard[],
): Promise<GenerateDesignProbesResponse> {
  if (maxProbes <= 0) return { success: true, interactions: [] };

  try {
    const acceptedDims = dimensions?.filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    const dimensionContext =
      acceptedDims && acceptedDims.length > 0
        ? `\n\nThe form is structured around these confirmed domain dimensions:\n${acceptedDims.map((d) => `- "${d.name}" [${d.scope}]: ${d.description}. Why it matters: ${d.importance}`).join("\n")}\n\nEach design probe should refine a SPECIFIC dimension — making concrete field-level decisions (what fields, what options, what validation). Include a "dimensionName" field that exactly matches one of the dimension names above.`
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
        standardsContext = `\n\nDOMAIN STANDARD CONTEXT:\nThe form is being built to comply with: ${acceptedStandards.map((s) => s.standard.name).join(", ")}.\nThe following optional/recommended fields from the standard(s) could be included. Generate design probes that ask the user whether to include these:\n${optionalFields.join("\n")}\n\nFor standard-related probes, frame them as "The [Standard Name] standard recommends including [field]. Should this form include it?" with options like "Yes, include it" / "No, not needed for this form".`;
      }
    }

    const prompt = `You are a form design assistant. Generate ${Math.min(maxProbes, 3)}-${maxProbes} refinement questions to improve this form design. Each question has 2-4 options.

User's form description: ${basePrompt}${dimensionContext}${standardsContext}

Each question must be classified by layer:
- "intent": about the form's purpose, audience, or high-level goals
- "dimensions": about specific aspects of data collection, field choices, or structure
- "both": spans both intent and concrete form structure

Rules:
- Question text must be SHORT — one sentence, no preamble
- "explanation" is OPTIONAL — only include if the question truly needs clarification. Most questions should NOT have one.
- Options: short labels (2-5 words each), mutually exclusive
- Mix of intent-level and dimension-level questions
- Values should be camelCase identifiers`;

    const result = await withTracing(
      { tags: ["design-probes", "generate"] },
      () =>
        generateText({
          model,
          prompt,
          output: Output.object({ schema: probeResponseSchema }),
          temperature: 0.3,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "design-probe-action",
            recordInputs: true,
            recordOutputs: true,
          },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const parsedResult = result.output;

    // Build a name→id lookup for dimension matching
    const dimLookup = new Map(
      (acceptedDims ?? []).map((d) => [d.name.toLowerCase(), d]),
    );

    const interactions: DesignProbeRaw[] = parsedResult.interactions
      .slice(0, maxProbes)
      .map((interaction, index) => {
        const matchedDim = interaction.dimensionName
          ? dimLookup.get(interaction.dimensionName.toLowerCase())
          : undefined;

        const validLayers = ["intent", "dimensions", "both"] as const;
        const layer =
          interaction.layer && validLayers.includes(interaction.layer)
            ? interaction.layer
            : "both";

        return {
          id: `probe-${Date.now()}-${index}`,
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
    console.error("Design probe generation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export interface ResolveDesignProbeRequest {
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  interactionText: string;
  selectedOptionLabel: string;
  maxFollowUps?: number;
}

export interface ResolveDesignProbeResponse {
  success: boolean;
  result?: {
    refinementDelta: string;
    artifactFormSchema: PortfolioSchema;
    followUpInteractions: DesignProbeRaw[];
  };
  error?: string;
}

export async function resolveDesignProbeAction(
  request: ResolveDesignProbeRequest,
): Promise<ResolveDesignProbeResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "resolveDesignProbeAction",
      request,
      () => resolveDesignProbeReal(request),
      { selectedOptionLabel: request.selectedOptionLabel },
    );
  }
  return resolveDesignProbeReal(request);
}

async function resolveDesignProbeReal(
  request: ResolveDesignProbeRequest,
): Promise<ResolveDesignProbeResponse> {
  try {
    const {
      intent,
      currentSchema,
      interactionText,
      selectedOptionLabel,
      maxFollowUps = 3,
    } = request;

    const basePrompt = serializeForLLM(intent);

    const prompt = `You are a form design assistant. The user is refining a form through interactive design probes.

Current form description: ${basePrompt}

Current form schema:
${JSON.stringify(currentSchema, null, 2)}

The user was asked: "${interactionText}"
They chose: "${selectedOptionLabel}"

Based on this choice, you must:
1. Write a SHORT "refinementDelta" — a single sentence summarizing the design decision made
2. Update the form schemas to reflect this choice
3. Optionally generate 0-${maxFollowUps} follow-up design probes if the choice opens up new design decisions${maxFollowUps === 0 ? ". Do NOT generate any follow-up questions, return an empty followUpInteractions array." : ""}

RULES:
- Use valid field types: "string", "number", "boolean", "date", "email", "select"
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
- Field keys MUST be camelCase and descriptive`;

    const result = await withTracing(
      { tags: ["design-probes", "resolve"] },
      () =>
        generateText({
          model,
          prompt,
          output: Output.object({ schema: resolveProbeSchema }),
          temperature: 0.3,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "design-probe-action",
            recordInputs: true,
            recordOutputs: true,
          },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const parsedResult = result.output;

    // Convert to PortfolioSchema
    const fields = parsedResult.artifactFormSchema.fields.map((f, index) => ({
      id: `field-${Date.now()}-${index}`,
      name: f.key,
      label: f.label,
      type: convertOldFieldType(f.type, f.validation),
      required: f.required,
      constraints: [],
      description: f.description,
      origin: "system" as const,
      tags: [],
    }));

    const artifactFormSchema: PortfolioSchema = {
      fields,
      groups: [],
      version: 1,
    };

    const followUpInteractions: DesignProbeRaw[] = (
      parsedResult.followUpInteractions || []
    )
      .slice(0, maxFollowUps)
      .map((interaction, index) => ({
        id: `probe-${Date.now()}-followup-${index}`,
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
        refinementDelta: parsedResult.refinementDelta,
        artifactFormSchema,
        followUpInteractions,
      },
    };
  } catch (error) {
    console.error("Design probe resolution error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

function convertOldFieldType(
  type: string,
  validation?: { options?: unknown[] },
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
