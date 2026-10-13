"use server";

import type { DimensionObject } from "@/lib/dimension-types";
import type { DetectedStandard } from "@/lib/domain-standards";
import {
  FORM_MODEL_RULES,
  schemaPatchRules,
  schemaPatchSchema,
} from "@/lib/engine/form-model";
import {
  MAX_OPEN_PROBES,
  planProbeCuration,
  type ProbeReview,
} from "@/lib/engine/probe-curation";
import {
  applySchemaPatch,
  type ApplyPatchResult,
  type SchemaPatch,
} from "@/lib/engine/schema-patch";
import {
  serializeForLLM,
  serializeSchemaForLLM,
} from "@/lib/engine/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
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

const priorityEnum = z
  .enum(["high", "medium", "low"])
  .describe(
    "high: shapes what the form fundamentally collects or its structure; medium: a specific field decision; low: polish",
  );

const probeItemSchema = z.object({
  text: z.string().describe("Very short headline question, max ~8 words"),
  explanation: z
    .string()
    .optional()
    .describe("One short sentence of context — omit unless essential"),
  layer: z.enum(["intent", "dimensions", "both"]),
  priority: priorityEnum,
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
});

const probeResponseSchema = z.object({
  interactions: z.array(probeItemSchema),
});

/** Shared by every prompt that writes design probes. */
const PROBE_QUESTION_RULES = `- Question "text" must be VERY SHORT — max ~8 words, like a headline. No preamble.
- Omit "explanation" unless the headline is genuinely ambiguous without it; then keep it to one short sentence.
- Option labels must be SHORT: 2-5 words max, mutually exclusive
- Values should be camelCase identifiers
- Only ask about decisions the form can express: which fields it has, their types and options, wording, and whether they're required. Never offer an option that needs something the form can't do (see HOW FORMS WORK HERE) — e.g. a field for staff to fill in later.`;

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
  /** Questions already open or answered — the new ones must not repeat them */
  existingQuestions?: string[],
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
          existingQuestions,
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
    existingQuestions,
  );
}

async function generateDesignProbesReal(
  basePrompt: string,
  requestedProbes: number,
  dimensions?: DimensionObject[],
  requestedStandards?: DetectedStandard[],
  externalPrompt?: string,
  currentSchema?: PortfolioSchema,
  existingQuestions: string[] = [],
): Promise<GenerateDesignProbesResponse> {
  if (requestedProbes <= 0) return { success: true, interactions: [] };

  try {
    const maxProbes = clampCount(requestedProbes, 1, 10, 5);
    capText(basePrompt, LIMITS.document, "Intent");
    capText(externalPrompt, LIMITS.prompt, "Collaborator input");
    capJson(dimensions, LIMITS.document, "Dimensions");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    capJson(currentSchema, LIMITS.document, "Schema");
    capJson(existingQuestions, LIMITS.document, "Existing questions");
    await guardLlmRequest();

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

    if (existingQuestions.length > 0) {
      sections.push(
        `ALREADY ASKED (open or answered) — do not repeat or rephrase these:\n${existingQuestions.map((q) => `- ${q}`).join("\n")}`,
      );
    }

    const contextBlock =
      sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";

    const system = `You are a form design assistant.

${FORM_MODEL_RULES}`;

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
- Mix of intent-level and dimension-level questions
${PROBE_QUESTION_RULES}`;

    const result = await withTracing(
      { tags: ["design-probes", externalPrompt ? "external-prompt" : "generate"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: probeResponseSchema }),
          temperature: 0.3,
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
    await guardLlmRequest();

    const system = `You are a form design assistant. The user is refining a form through interactive design probes.

${FORM_MODEL_RULES}`;

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
${schemaPatchRules(spacePortfolios.length > 0)}
- Interpret the answer within HOW FORMS WORK HERE: if it asks for something the form can't do, make the closest change that fits (or none) rather than adding fields that only work with it.`;

    const result = await withTracing(
      { tags: ["design-probes", "resolve"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: resolveProbeSchema }),
          temperature: 0.3,
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
    await guardLlmRequest();

    const system = `You are a form design assistant. The user is refining a form through interactive design probes.

${FORM_MODEL_RULES}`;

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
- The options are mutually exclusive, so their patches should differ in a way that reflects each choice.
- If an option asks for something the form can't do (see HOW FORMS WORK HERE), make the closest change that fits, or none — never add fields that only work with it.`;

    const result = await withTracing(
      { tags: ["design-probes", "preview"] },
      () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: previewOptionsSchema }),
          temperature: 0.3,
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
// Curate: keep the open probes current after the form changed — retire the
// ones that no longer apply, re-rank the rest, add only what's missing
// ---------------------------------------------------------------------------

export interface CurateDesignProbesRequest {
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  /** Open probes in deck order (most important first) */
  openProbes: {
    id: string;
    text: string;
    options: { value: string; label: string }[];
    priority: ProbePriority;
  }[];
  /** Answered probes, most recent first */
  decisions: { question: string; answer: string }[];
  /**
   * "refine": the intent was just edited — also look for decisions it raises.
   * "changes": the form changed (answers, edits) — mostly retire what no
   * longer applies.
   */
  mode: "refine" | "changes";
  maxOpen?: number;
}

export interface CurateDesignProbesResponse {
  success: boolean;
  result?: {
    /** Ids of open probes to retire */
    drop: string[];
    /** Kept probes whose priority changed */
    priorities: Record<string, ProbePriority>;
    add: DesignProbeRaw[];
  };
  error?: string;
}

const PRIORITY_NAMES: Record<ProbePriority, "high" | "medium" | "low"> = {
  1: "high",
  2: "medium",
  3: "low",
};

const curateProbesSchema = z.object({
  open: z
    .array(
      z.object({
        ref: z.string().describe('The open question\'s ref exactly as listed, e.g. "q2"'),
        keep: z.boolean().describe("false retires the question"),
        priority: priorityEnum,
      }),
    )
    .describe("One entry per open question"),
  add: z.array(probeItemSchema).describe("New questions — often none"),
});

function normalizeQuestion(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export async function curateDesignProbesAction(
  request: CurateDesignProbesRequest,
): Promise<CurateDesignProbesResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "curateDesignProbesAction",
      request,
      () => curateDesignProbesReal(request),
      { prompt: request.mode },
    );
  }
  return curateDesignProbesReal(request);
}

async function curateDesignProbesReal(
  request: CurateDesignProbesRequest,
): Promise<CurateDesignProbesResponse> {
  try {
    const { intent, currentSchema, openProbes, decisions, mode } = request;
    const maxOpen = clampCount(request.maxOpen, 1, 10, MAX_OPEN_PROBES);
    const maxNew = mode === "refine" ? Math.min(5, maxOpen) : 2;

    const basePrompt = serializeForLLM(intent);
    capText(basePrompt, LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capJson(openProbes, LIMITS.document, "Open questions");
    capJson(decisions, LIMITS.document, "Decisions");
    await guardLlmRequest();

    // Short refs instead of ids: fewer tokens, and nothing to mangle
    const byRef = new Map(openProbes.map((p, i) => [`q${i + 1}`, p]));
    const openList =
      openProbes.length > 0
        ? [...byRef]
            .map(
              ([ref, p]) =>
                `- ${ref} [${PRIORITY_NAMES[p.priority] ?? "medium"}] "${p.text}" — options: ${p.options.map((o) => o.label).join(" | ")}`,
            )
            .join("\n")
        : "(none)";
    const decisionList =
      decisions.length > 0
        ? decisions.map((d) => `- "${d.question}" → "${d.answer}"`).join("\n")
        : "(none yet)";

    const system = `You are a form design assistant. You keep the list of open design questions ("design probes") about a form short, current and free of repeats.

${FORM_MODEL_RULES}`;

    const prompt = `Form description:
${basePrompt}

Current form schema:
${serializeSchemaForLLM(currentSchema)}

Decisions already made:
${decisionList}

Open questions:
${openList}

${
  mode === "refine"
    ? "The form description was just edited, so some open questions may no longer fit and the edit may raise new decisions."
    : "The form just changed (answers applied or fields edited), so some open questions may no longer apply."
}

1. Review EVERY open question and return one "open" entry per ref:
   - keep: false when it is already settled by the current form or a decision, repeats or overlaps another open question (keep the better one), no longer fits the description, or asks for something the form can't do.
   - otherwise keep: true, with its priority re-assessed for the form as it is now.
2. "add" at most ${maxNew} NEW questions — ${
      mode === "refine"
        ? "for important decisions the edited description raises that no open question covers"
        : "only for an important decision that is now open and not covered; usually none"
    }. Never repeat a decision already made or an open question.
At most ${maxOpen} questions should stay open in total (kept + added); when more are worth asking, keep the most consequential.

Question rules:
- "priority": high = shapes what the form fundamentally collects or its structure; medium = a specific field decision; low = polish
${PROBE_QUESTION_RULES}`;

    const result = await withTracing(
      { tags: ["design-probes", "curate", mode] },
      () =>
        generateText({
          // Retiring questions is classification; writing new ones after an
          // intent edit deserves the main model.
          model: mode === "refine" ? model : fastModel,
          system,
          prompt,
          output: Output.object({ schema: curateProbesSchema }),
          temperature: 0.2,
          experimental_telemetry: telemetry("design-probe-curate"),
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const reviews = new Map<string, ProbeReview>();
    for (const entry of result.output.open) {
      const probe = byRef.get(entry.ref.trim());
      if (!probe) continue;
      reviews.set(probe.id, {
        keep: entry.keep,
        priority: PRIORITY_VALUES[entry.priority] ?? probe.priority,
      });
    }

    const asked = new Set(
      [
        ...openProbes.map((p) => p.text),
        ...decisions.map((d) => d.question),
      ].map(normalizeQuestion),
    );
    const added: DesignProbeRaw[] = [];
    for (const p of result.output.add) {
      const key = normalizeQuestion(p.text);
      if (!key || asked.has(key) || p.options.length < 2) continue;
      asked.add(key);
      added.push({
        id: `probe-${Date.now()}-curated-${added.length}`,
        text: p.text,
        explanation: p.explanation || undefined,
        layer: p.layer,
        source: "llm",
        options: p.options,
        selectedOption: null,
        status: "pending",
        priority: PRIORITY_VALUES[p.priority] ?? 2,
        dimensionId: null,
        dimensionName: null,
      });
      if (added.length >= maxNew) break;
    }

    return {
      success: true,
      result: planProbeCuration(openProbes, reviews, added, maxOpen),
    };
  } catch (error) {
    console.error("Design probe curation error:", error);
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
    await guardLlmRequest();
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
          temperature: 0.2,
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
