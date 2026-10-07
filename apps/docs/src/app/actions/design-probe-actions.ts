"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import {
  applySchemaPatch,
  type ApplyPatchResult,
  type SchemaPatch,
} from "@/lib/engine/schema-patch";
import {
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, checkRateLimit, LIMITS } from "@/lib/llm-guard";
import { fastModel, model } from "@/lib/model";
import { resolveDetectedStandards } from "@/lib/standards";
import { telemetry, withTracing } from "@/lib/telemetry";
import type {
  DesignProbeOption,
  PortfolioSchema,
  ProbeOptionPreview,
  ProbePriority,
  StructuredIntent,
} from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/** Clamp a caller-supplied count to [min, max], falling back for junk input. */
function clampCount(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

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
  priority: ProbePriority;
  dimensionId?: string | null;
  dimensionName?: string | null;
}

const PRIORITY_VALUES: Record<"high" | "medium" | "low", ProbePriority> = {
  high: 1,
  medium: 2,
  low: 3,
};

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
      text: z.string().describe("Very short headline question, max ~8 words"),
      explanation: z
        .string()
        .optional()
        .describe("One short sentence of context — omit unless essential"),
      layer: z.enum(["intent", "dimensions", "both"]),
      priority: z
        .enum(["high", "medium", "low"])
        .describe(
          "high: shapes what the form fundamentally collects or its structure; medium: a specific field decision; low: polish",
        ),
      dimensionName: z
        .string()
        .optional()
        .describe("Exact dimension name if applicable"),
      options: z.array(
        z.object({
          value: z.string().describe("camelCase identifier"),
          label: z.string().describe("2-5 words max"),
        }),
      ),
    }),
  ),
});

const optionSchema = z.object({
  label: z.string().describe("2-5 words max"),
  value: z.string(),
});

const schemaPatchFieldSchema = z.object({
  key: z.string().describe("camelCase field key"),
  label: z.string(),
  description: z
    .string()
    .optional()
    .describe("Brief help text — omit if the label is self-explanatory"),
  tooltip: z
    .string()
    .optional()
    .describe("Extra hover guidance — omit if not needed"),
  type: z.enum([
    "string",
    "number",
    "boolean",
    "date",
    "email",
    "select",
    "reference",
  ]),
  required: z.boolean(),
  validation: z
    .object({ options: z.array(optionSchema).optional() })
    .optional(),
  referenceTarget: z
    .string()
    .optional()
    .describe(
      "For type 'reference' only: the id of the space table this field links to — must be one of the listed table ids",
    ),
});

const schemaPatchSchema = z
  .object({
    addFields: z
      .array(schemaPatchFieldSchema)
      .optional()
      .describe("New fields to add to the schema"),
    removeFieldKeys: z
      .array(z.string())
      .optional()
      .describe("camelCase keys of fields to remove"),
    updateFields: z
      .array(schemaPatchFieldSchema)
      .optional()
      .describe(
        "Fields to update — include the full field definition with the same key",
      ),
  })
  .describe(
    "Only the changes to apply to the current schema. Omit sections with no changes.",
  );

const followUpQuestionSchema = z.object({
  text: z.string().describe("Very short headline, max ~8 words"),
  options: z.array(
    z.object({
      value: z.string().describe("camelCase identifier"),
      label: z.string().describe("2-5 words max"),
    }),
  ),
});

const resolveProbeSchema = z.object({
  refinementDelta: z
    .string()
    .describe(
      "One tight sentence for the changelog, e.g. 'Added recurring booking fields.'",
    ),
  updatedPurpose: z
    .string()
    .describe(
      "Rewritten purpose section: a concise 2-4 sentence paragraph that incorporates the new decision into the existing purpose. Not a list of decisions — a coherent description of what the form does.",
    ),
  schemaPatch: schemaPatchSchema,
  followUpInteractions: z.array(followUpQuestionSchema).optional(),
});

const previewOptionsSchema = z.object({
  outcomes: z.array(
    z.object({
      value: z.string().describe("The option's value, exactly as listed"),
      summary: z
        .string()
        .describe(
          "What choosing this option changes, max ~8 words, e.g. 'Adds session length and goal fields'",
        ),
      schemaPatch: schemaPatchSchema,
      followUp: followUpQuestionSchema
        .optional()
        .describe(
          "At most one follow-up question this answer opens up — omit unless it raises a genuinely new decision",
        ),
    }),
  ),
});

/** Rules for "schemaPatch" output, shared by the preview and resolve prompts. */
function schemaPatchRules(hasSpaceTables: boolean): string {
  return `- Use valid field types: "string", "number", "boolean", "date", "email", "select"${hasSpaceTables ? `, "reference"
- Use type "reference" when a field should link each entry to an item in one of the OTHER TABLES IN THIS SPACE (e.g. inventory entries referencing a product template). Set "referenceTarget" to that table's id EXACTLY as listed — never invent table ids.` : ""}
- For select fields, ALWAYS include options in validation.options as [{label, value}] objects
- CRITICAL: When updating a select field (even if only changing its label), you MUST re-include the full validation.options array. Omitting options will erase them.
- Field keys MUST be camelCase and descriptive
- "description" should be SHORT (a few words) — omit entirely if the label already makes the field obvious
- "tooltip" is for extra guidance that helps the user fill in the field correctly — omit if not needed
- IMPORTANT: Only include fields that CHANGE in schemaPatch. Leave unchanged fields alone.`;
}

function spaceTablesBlock(spacePortfolios: { id: string; title: string }[]): string {
  return spacePortfolios.length
    ? `\nOTHER TABLES IN THIS SPACE (valid targets for "reference" fields):
${spacePortfolios.map((p) => `- ${p.id} — "${p.title}"`).join("\n")}\n`
    : "";
}

// ---------------------------------------------------------------------------

export async function generateDesignProbesAction(
  intent: StructuredIntent,
  maxProbes: number = 5,
  dimensions?: DimensionObject[],
  acceptedStandards?: DetectedStandard[],
  externalPrompt?: string,
  currentSchema?: PortfolioSchema,
): Promise<GenerateDesignProbesResponse> {
  const basePrompt = serializeForLLM(intent);
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "generateDesignProbesAction",
      { basePrompt, maxProbes, dimensions, acceptedStandards, externalPrompt },
      () =>
        generateDesignProbesReal(
          basePrompt,
          maxProbes,
          dimensions,
          acceptedStandards,
          externalPrompt,
          currentSchema,
        ),
      { prompt: externalPrompt || basePrompt },
    );
  }
  return generateDesignProbesReal(
    basePrompt,
    maxProbes,
    dimensions,
    acceptedStandards,
    externalPrompt,
    currentSchema,
  );
}

async function generateDesignProbesReal(
  basePrompt: string,
  requestedProbes: number,
  dimensions?: DimensionObject[],
  requestedStandards?: DetectedStandard[],
  externalPrompt?: string,
  currentSchema?: PortfolioSchema,
): Promise<GenerateDesignProbesResponse> {
  if (requestedProbes <= 0) return { success: true, interactions: [] };

  try {
    const maxProbes = clampCount(requestedProbes, 1, 10, 5);
    capText(basePrompt, LIMITS.document, "Intent");
    capText(externalPrompt, LIMITS.prompt, "Collaborator input");
    capJson(dimensions, LIMITS.document, "Dimensions");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    capJson(currentSchema, LIMITS.document, "Schema");
    await checkRateLimit();

    // Prompt content comes from the curated registry, not the request payload
    const acceptedStandards = resolveDetectedStandards(requestedStandards);
    const source = externalPrompt ? "external" : "llm";

    const acceptedDims = dimensions?.filter(
      (d) => (d.status === "accepted" || d.status === "edited") && d.isActive,
    );

    // Build optional context sections
    const sections: string[] = [];

    if (currentSchema && currentSchema.fields.length > 0) {
      sections.push(`CURRENT FORM SCHEMA:\n${serializeSchemaForLLM(currentSchema)}`);
    }

    if (acceptedDims && acceptedDims.length > 0) {
      sections.push(
        `The form is structured around these confirmed domain dimensions:\n${acceptedDims.map((d) => `- "${d.name}" [${d.scope}]: ${d.description}. Why it matters: ${d.importance}`).join("\n")}\n\nEach design probe should refine a SPECIFIC dimension — making concrete field-level decisions (what fields, what options, what validation). Include a "dimensionName" field that exactly matches one of the dimension names above.`,
      );
    }

    if (acceptedStandards.length > 0) {
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
        sections.push(
          `DOMAIN STANDARD CONTEXT:\nThe form is being built to comply with: ${acceptedStandards.map((s) => s.standard.name).join(", ")}.\nThe following optional/recommended fields from the standard(s) could be included. Generate design probes that ask the user whether to include these:\n${optionalFields.join("\n")}\n\nFor standard-related probes, frame them as "The [Standard Name] standard recommends including [field]. Should this form include it?" with options like "Yes, include it" / "No, not needed for this form".`,
        );
      }
    }

    if (externalPrompt) {
      sections.push(
        `ADDITIONAL INPUT (from a collaborator):\n${externalPrompt}\n\nSurface the collaborator's concerns as concrete decisions. Always include an option that preserves the current design (e.g. "Keep as is").`,
      );
    }

    const contextBlock =
      sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";

    const system = `You are a form design assistant.`;

    const prompt = `Generate ${Math.min(maxProbes, 3)}-${maxProbes} refinement questions to improve this form design. Each question has 2-4 options.

User's form description: ${basePrompt}${contextBlock}

Each question must be classified by layer:
- "intent": about the form's purpose, audience, or high-level goals
- "dimensions": about specific aspects of data collection, field choices, or structure
- "both": spans both intent and concrete form structure

Each question must also get a "priority":
- "high": the answer shapes what the form fundamentally collects or how it is structured (affects several fields)
- "medium": a specific field-level decision
- "low": polish — labels, help text, optional extras

Rules:
- Return the questions ordered by impact: the most consequential decision first.
- Question "text" must be VERY SHORT — max ~8 words, like a headline. No preamble.
- Omit "explanation" unless the headline is genuinely ambiguous without it; then keep it to one short sentence.
- Option labels must be SHORT: 2-5 words max, mutually exclusive
- Mix of intent-level and dimension-level questions
- Values should be camelCase identifiers`;

    const result = await withTracing(
      { tags: ["design-probes", externalPrompt ? "external-prompt" : "generate"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: probeResponseSchema }),
          experimental_telemetry: telemetry("design-probe-action"),
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
          source,
          options: interaction.options,
          selectedOption: null,
          status: "pending" as const,
          // Fixtures recorded before priorities existed have none
          priority: PRIORITY_VALUES[interaction.priority] ?? 2,
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
  /**
   * Other portfolios in the same space — when present, the LLM may create
   * "reference" fields that link entries of this form to rows of one of them.
   */
  spacePortfolios?: { id: string; title: string }[];
}

export interface ResolveDesignProbeResponse {
  success: boolean;
  result?: {
    refinementDelta: string;
    updatedPurpose: string;
    /** `currentSchema` with `schemaPatch` applied */
    artifactFormSchema: PortfolioSchema;
    followUpInteractions: DesignProbeRaw[];
    /** The raw patch, so a client can re-apply it to fresher state */
    schemaPatch?: SchemaPatch;
    /** Reference targets the patch was validated against */
    validTargetIds?: string[];
    /** Field names the patch actually changed */
    applied?: ApplyPatchResult["applied"];
    /** Updates/removals that referenced unknown field keys (no-ops) */
    skipped?: ApplyPatchResult["skipped"];
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
      spacePortfolios = [],
    } = request;
    const maxFollowUps = clampCount(request.maxFollowUps ?? 3, 0, 5, 3);

    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(interactionText, LIMITS.shortText, "Question");
    capText(selectedOptionLabel, LIMITS.shortText, "Answer");
    capJson(spacePortfolios, LIMITS.document, "Space tables");
    await checkRateLimit();

    const system = `You are a form design assistant. The user is refining a form through interactive design probes.`;

    const prompt = `Current form description: ${basePrompt}

Current form schema:
${serializeSchemaForLLM(currentSchema)}
${spaceTablesBlock(spacePortfolios)}
The user was asked: "${interactionText}"
They chose: "${selectedOptionLabel}"

Based on this choice, you must:
1. Write a SHORT "refinementDelta" — one tight changelog sentence (e.g. "Added recurring booking fields.")
2. Write "updatedPurpose" — rewrite the ENTIRE purpose section as a concise 2-4 sentence paragraph that incorporates this decision. Do NOT list each decision as a bullet or separate sentence. Synthesize into a coherent description of what the form is for, who uses it, and its key characteristics. Remove redundant or superseded details.
3. Return a "schemaPatch" with ONLY the changes — do NOT regenerate the entire schema. Use:
   - "addFields": new fields to add
   - "removeFieldKeys": camelCase keys of fields to remove
   - "updateFields": existing fields to modify (include full field definition with the same key)
   - Omit any section that has no changes.
4. Optionally generate 0-${maxFollowUps} follow-up design probes if the choice opens up new design decisions${maxFollowUps === 0 ? ". Do NOT generate any follow-up questions, return an empty followUpInteractions array." : ""}

RULES:
${schemaPatchRules(spacePortfolios.length > 0)}`;

    const result = await withTracing(
      { tags: ["design-probes", "resolve"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: resolveProbeSchema }),
          experimental_telemetry: telemetry("design-probe-action"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const parsedResult = result.output;

    // Apply schema patch to current schema (remove → update → add; keeps
    // type details/descriptions the coarse patch can't express; adds that
    // collide with an existing key become updates).
    const schemaPatch: SchemaPatch = parsedResult.schemaPatch;
    const validTargetIds = spacePortfolios.map((p) => p.id);
    const {
      schema: artifactFormSchema,
      applied,
      skipped,
    } = applySchemaPatch(currentSchema, schemaPatch, { validTargetIds });

    const appliedCount =
      applied.added.length + applied.updated.length + applied.removed.length;
    const skippedCount = skipped.updated.length + skipped.removed.length;
    if (skippedCount > 0) {
      console.warn(
        "[resolveDesignProbe] Patch referenced unknown fields:",
        skipped,
      );
    }
    // Don't let the changelog claim a schema change that didn't happen
    const refinementDelta =
      skippedCount > 0 && appliedCount === 0
        ? "No schema changes applied."
        : parsedResult.refinementDelta;

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
        priority: 2 as const,
        dimensionId: null,
        dimensionName: null,
      }));

    return {
      success: true,
      result: {
        refinementDelta,
        updatedPurpose: parsedResult.updatedPurpose,
        artifactFormSchema,
        followUpInteractions,
        schemaPatch,
        validTargetIds,
        applied,
        skipped,
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

// ---------------------------------------------------------------------------
// Preview: what each option of a probe would change, computed ahead of time
// so the deck can preview an answer and apply it without an LLM round trip
// ---------------------------------------------------------------------------

export interface PreviewDesignProbeOptionsRequest {
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  probe: {
    text: string;
    explanation?: string;
    options: { value: string; label: string }[];
  };
  spacePortfolios?: { id: string; title: string }[];
}

export interface PreviewDesignProbeOptionsResponse {
  success: boolean;
  /** The probe's options, each with its preview when the model produced one */
  options?: DesignProbeOption[];
  error?: string;
}

export async function previewDesignProbeOptionsAction(
  request: PreviewDesignProbeOptionsRequest,
): Promise<PreviewDesignProbeOptionsResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "previewDesignProbeOptionsAction",
      request,
      () => previewDesignProbeOptionsReal(request),
      { prompt: request.probe.text },
    );
  }
  return previewDesignProbeOptionsReal(request);
}

async function previewDesignProbeOptionsReal(
  request: PreviewDesignProbeOptionsRequest,
): Promise<PreviewDesignProbeOptionsResponse> {
  try {
    const { intent, currentSchema, probe, spacePortfolios = [] } = request;

    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(probe.text, LIMITS.shortText, "Question");
    capText(probe.explanation, LIMITS.shortText, "Explanation");
    capJson(probe.options, LIMITS.shortText, "Options");
    capJson(spacePortfolios, LIMITS.document, "Space tables");
    await checkRateLimit();

    const system = `You are a form design assistant. The user is refining a form through interactive design probes.`;

    const prompt = `Current form description: ${basePrompt}

Current form schema:
${serializeSchemaForLLM(currentSchema)}
${spaceTablesBlock(spacePortfolios)}
The user will be asked: "${probe.text}"${probe.explanation ? `\nContext: ${probe.explanation}` : ""}
Options:
${probe.options.map((o) => `- value "${o.value}": "${o.label}"`).join("\n")}

For EACH option, work out exactly how the form would change if the user chose it, so the change can be previewed and applied instantly. Return one outcome per option:
1. "value": the option's value, exactly as listed
2. "summary": what changes, as a short phrase (max ~8 words), e.g. "Adds session length and goal fields". If the option keeps the form as it is, say so and return an empty schemaPatch.
3. "schemaPatch": ONLY the changes to the current schema:
   - "addFields": new fields to add
   - "removeFieldKeys": camelCase keys of fields to remove
   - "updateFields": existing fields to modify (include full field definition with the same key)
   - Omit any section that has no changes.
   Each outcome is applied on its own to the current schema — never assume another option was chosen.
4. "followUp" (optional): at most ONE follow-up question this answer would open up, only if it raises a genuinely new decision. Headline max ~8 words, 2-4 options with short labels and camelCase values.

RULES:
${schemaPatchRules(spacePortfolios.length > 0)}
- The options are mutually exclusive, so their patches should differ in a way that reflects each choice.`;

    const result = await withTracing(
      { tags: ["design-probes", "preview"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: previewOptionsSchema }),
          experimental_telemetry: telemetry("design-probe-preview"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const validTargetIds = spacePortfolios.map((p) => p.id);
    const outcomes = new Map(result.output.outcomes.map((o) => [o.value, o]));

    const options: DesignProbeOption[] = probe.options.map((option) => {
      const outcome = outcomes.get(option.value);
      if (!outcome) return { value: option.value, label: option.label };

      const schemaPatch: SchemaPatch = outcome.schemaPatch;
      const { applied, skipped } = applySchemaPatch(currentSchema, schemaPatch, {
        validTargetIds,
      });
      const appliedCount =
        applied.added.length + applied.updated.length + applied.removed.length;
      const skippedCount = skipped.updated.length + skipped.removed.length;

      const preview: ProbeOptionPreview = {
        // Don't let the summary claim a change the patch can't make
        summary:
          skippedCount > 0 && appliedCount === 0
            ? "No form change"
            : outcome.summary,
        schemaPatch,
      };
      if (outcome.followUp?.options.length) preview.followUp = outcome.followUp;
      return { value: option.value, label: option.label, preview };
    });

    return { success: true, options };
  } catch (error) {
    console.error("Design probe preview error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// ---------------------------------------------------------------------------
// Sync intent from direct field edits (backpropagation)
// ---------------------------------------------------------------------------

const syncIntentSchema = z.object({
  shouldUpdate: z
    .boolean()
    .describe(
      "Whether the purpose text needs updating. False for trivial changes like typo fixes.",
    ),
  updatedPurpose: z
    .string()
    .optional()
    .describe("Minimally updated purpose text, only if shouldUpdate is true"),
});

export interface SyncIntentResponse {
  success: boolean;
  updatedPurpose?: string;
  shouldUpdate: boolean;
  error?: string;
}

export async function syncIntentFromFieldEditAction(request: {
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  editDescription: string;
  /**
   * "design-decision": the edits are answered design probes, which almost
   * always change what the form is about — the purpose should follow.
   */
  kind?: "field-edit" | "design-decision";
}): Promise<SyncIntentResponse> {
  const LOG = "[syncIntentFromFieldEdit]";
  try {
    const { intent, currentSchema, editDescription } = request;
    const isDecision = request.kind === "design-decision";
    console.log(LOG, "called with editDescription:", editDescription);

    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(editDescription, LIMITS.shortText, "Edit description");
    await checkRateLimit();
    console.log(LOG, "current purpose (first 120 chars):", basePrompt.slice(0, 120));

    const system = isDecision
      ? `You are a form design assistant. The user answered design questions about their form, and the form schema already reflects those decisions. Update the form's purpose description so it stays in sync with them.`
      : `You are a form design assistant. The user directly edited a form field. Decide whether the form's purpose description needs a minor update to stay in sync.`;

    const prompt = `Current form description:
${basePrompt}

Current form schema:
${serializeSchemaForLLM(currentSchema)}

${isDecision ? "The user made these design decisions" : "The user made this edit"}: ${editDescription}

RULES:
${
  isDecision
    ? `- Set shouldUpdate to true unless the decisions only kept the form as it was.
- Weave the decisions into the description — what the form collects and why — not as a list of answers.`
    : `- If the edit is trivial (typo fix, minor wording change), set shouldUpdate to false.
- If the edit meaningfully changes what the form collects (new field type, new options, renamed concept), set shouldUpdate to true.`
}
- When updating, make MINIMAL changes to the purpose text. Preserve the user's voice and wording.
- Do NOT add bullet lists of decisions. Keep it as a coherent paragraph.
- The updated purpose should be 2-4 sentences max.`;

    console.log(LOG, "calling LLM...");
    const result = await withTracing(
      { tags: ["intent-sync", "field-edit"] },
      () =>
        generateText({
          model: fastModel,
          system,
          prompt,
          output: Output.object({ schema: syncIntentSchema }),
          experimental_telemetry: telemetry("sync-intent-field-edit"),
        }),
    );

    if (!result.output) {
      console.error(LOG, "no structured output from LLM");
      return { success: false, shouldUpdate: false, error: "No LLM output" };
    }

    console.log(LOG, "LLM result:", {
      shouldUpdate: result.output.shouldUpdate,
      hasUpdatedPurpose: !!result.output.updatedPurpose,
      updatedPurposePreview: result.output.updatedPurpose?.slice(0, 120),
    });

    return {
      success: true,
      shouldUpdate: result.output.shouldUpdate,
      updatedPurpose: result.output.updatedPurpose,
    };
  } catch (error) {
    console.error(LOG, "error:", error);
    return {
      success: false,
      shouldUpdate: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
