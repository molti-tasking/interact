"use server";

import type { DetectedStandard } from "@/lib/domain-standards";
import {
  llmFieldSchema,
  NEW_FIELD_RULES,
  SCALE_FIELD_RULES,
  schemaPatchRules,
  schemaPatchSchema,
  toSchemaPatch,
} from "interact/forms/form-model";
import {
  composeProbes,
  describeOps,
  findDisagreements,
  type CandidateDesign,
  type QuestionOrder,
} from "interact/forms/probe-disagreement";
import { fenced, formSystemPrompt } from "interact/forms/prompt";
import {
  applyPurposeEdit,
  PURPOSE_EDIT_RULES,
  purposeEditSchema,
} from "interact/forms/purpose-edit";
import {
  MAX_OPEN_PROBES,
  planProbeCuration,
  type ProbeReview,
} from "interact/forms/probe-curation";
import {
  applySchemaPatch,
  type ApplyPatchResult,
  type SchemaPatch,
} from "interact/forms/schema-patch";
import {
  normalizeFieldKey,
  serializeForLLM,
} from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { fastModel, model, llmErrorMessage, withLlmRetry } from "@/lib/model";
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
  /** Options carry a `preview` when it was computed with the probe */
  options: DesignProbeOption[];
  selectedOption: string | null;
  status: "pending" | "loading" | "resolved" | "dismissed";
  priority: ProbePriority;
  /** "ready": every option already has its preview — none to compute */
  previewStatus?: "ready";
  dimensionId?: string | null;
  dimensionName?: string | null;
}

/** Probe ids are only placeholders until the database assigns one. */
function newProbeId(): string {
  return `probe-${globalThis.crypto.randomUUID()}`;
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

/** Shared by every prompt that writes elicitation questions. */
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
  purposeEdit: purposeEditSchema,
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

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

/**
 * How new probes are chosen:
 * - "committee" (default): by disagreement between independently drafted
 *   designs (`engine/probe-disagreement.ts`); answers come with previews.
 * - "prompted": the model is asked for refinement questions directly.
 * The committee falls back to "prompted" when it finds too little to ask.
 */
function probeStrategy(): "committee" | "prompted" {
  return process.env.PROBE_STRATEGY === "prompted" ? "prompted" : "committee";
}

/**
 * Which of the committee's open decisions are asked first (`PROBE_ORDER`,
 * see `QuestionOrder`): "contested" (default) or "omissions" — fields most
 * drafts add that the form doesn't ask for yet come first.
 */
function questionOrder(): QuestionOrder {
  return process.env.PROBE_ORDER?.trim() === "omissions" ? "omissions" : "contested";
}

export async function generateDesignProbesAction(
  intent: StructuredIntent,
  maxProbes: number = 5,
  acceptedStandards?: DetectedStandard[],
  externalPrompt?: string,
  currentSchema?: PortfolioSchema,
  /** Questions already open or answered — the new ones must not repeat them */
  existingQuestions?: string[],
): Promise<GenerateDesignProbesResponse> {
  const run = () =>
    generateDesignProbesReal(
      intent,
      maxProbes,
      acceptedStandards,
      externalPrompt,
      currentSchema,
      existingQuestions,
    );
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const basePrompt = serializeForLLM(intent);
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "generateDesignProbesAction",
      { basePrompt, maxProbes, acceptedStandards, externalPrompt },
      run,
      { prompt: externalPrompt || basePrompt },
    );
  }
  return run();
}

async function generateDesignProbesReal(
  intent: StructuredIntent,
  requestedProbes: number,
  requestedStandards?: DetectedStandard[],
  externalPrompt?: string,
  currentSchema?: PortfolioSchema,
  existingQuestions: string[] = [],
): Promise<GenerateDesignProbesResponse> {
  if (requestedProbes <= 0) return { success: true, interactions: [] };

  try {
    const maxProbes = clampCount(requestedProbes, 1, 10, 5);
    capText(serializeForLLM(intent), LIMITS.document, "Intent");
    capText(externalPrompt, LIMITS.prompt, "Collaborator input");
    capJson(requestedStandards, LIMITS.document, "Accepted standards");
    capJson(currentSchema, LIMITS.document, "Schema");
    capJson(existingQuestions, LIMITS.document, "Existing questions");
    await guardLlmRequest();

    // Prompt content comes from the curated registry, not the request payload
    const acceptedStandards = resolveDetectedStandards(requestedStandards);
    const hasForm = !!currentSchema && currentSchema.fields.length > 0;
    const system = formSystemPrompt({
      intent,
      schema: hasForm ? currentSchema : undefined,
    });

    // Standards and collaborator input bring their own questions; everything
    // else is chosen by where independent drafts of the form disagree.
    if (
      probeStrategy() === "committee" &&
      hasForm &&
      !externalPrompt &&
      acceptedStandards.length === 0
    ) {
      const fromCommittee = await committeeProbes(
        system,
        currentSchema,
        maxProbes,
        existingQuestions,
      );
      if (fromCommittee.length >= Math.min(2, maxProbes)) {
        return { success: true, interactions: fromCommittee };
      }
      console.warn(
        `[design-probes] committee found ${fromCommittee.length} question(s) — asking the model directly`,
      );
    }

    return {
      success: true,
      interactions: await promptedProbes(
        system,
        maxProbes,
        acceptedStandards,
        externalPrompt,
        existingQuestions,
      ),
    };
  } catch (error) {
    console.error("Elicitation question generation error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
    };
  }
}

function alreadyAskedBlock(existingQuestions: string[]): string {
  return existingQuestions.length > 0
    ? `ALREADY ASKED (open or answered) — do not repeat or rephrase these:\n${fenced(
        "asked",
        existingQuestions.map((q) => `- ${q}`).join("\n"),
      )}`
    : "";
}

// ---- Committee: ask where independent drafts disagree ----------------------

const COMMITTEE_SIZE = clampCount(Number(process.env.PROBE_COMMITTEE_SIZE), 2, 6, 4);
/** Disagreements handed to the wording step (most contested first) */
const MAX_COMMITTEE_OPS = 14;

/**
 * A different emphasis per draft, so the committee doesn't collapse into
 * one design on models that ignore the sampling temperature.
 */
const COMMITTEE_LENSES = [
  "",
  "Your emphasis: the effort of the person filling it in — every question must earn its place.",
  "Your emphasis: what the creator will want to learn from the answers afterwards.",
  "Your emphasis: what is usual practice for this kind of form.",
  "Your emphasis: answers that are precise and comparable (choices and ratings over free text where that fits).",
  "Your emphasis: the situations and people the description doesn't mention but the form will meet.",
];

const candidateDesignSchema = z.object({
  fields: z
    .array(llmFieldSchema)
    .describe("Every field of the form you would ship, in order (max 15)"),
});

async function draftCandidate(
  system: string,
  currentSchema: PortfolioSchema,
  index: number,
): Promise<CandidateDesign | null> {
  const lens = COMMITTEE_LENSES[index % COMMITTEE_LENSES.length];
  const prompt = `Draft the complete form you would ship for this description. Other designers draft theirs independently, so decide what YOU judge best — not a cautious average.

- Start from the current fields. Keep a field by repeating it with the SAME key; you may change its options or whether it is required. Leave a field out only if you think this form should not ask it. Fields marked LOCKED must be kept as they are.
- Then add whatever else this form should ask to serve its purpose — usually 2 to 6 more fields, none if it is complete as it stands.
- At most 15 fields in total.
${lens ? `${lens}\n` : ""}
RULES:
${NEW_FIELD_RULES}
${SCALE_FIELD_RULES}`;

  try {
    const result = await withLlmRetry("probe-committee", (abortSignal) =>
      withTracing({ tags: ["design-probes", "committee-draft"] }, () =>
        generateText({
          model,
          system,
          prompt,
          output: Output.object({ schema: candidateDesignSchema }),
          // Drafts should differ where the description leaves room
          temperature: 1,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("design-probe-committee"),
        }),
      ),
    );
    if (!result.output) return null;
    const existingKeys = new Set(currentSchema.fields.map((f) => f.name));
    return {
      fields: result.output.fields.slice(0, 15).map((f, i) => ({
        ...f,
        // Existing keys must match verbatim; new ones become stored keys
        key: existingKeys.has(f.key)
          ? f.key
          : normalizeFieldKey(f.key || f.label, `field${i + 1}`),
      })),
    };
  } catch (error) {
    console.warn(`[design-probes] committee draft ${index + 1} failed:`, llmErrorMessage(error));
    return null;
  }
}

const composedProbesSchema = z.object({
  questions: z.array(
    z.object({
      text: z.string().describe("Very short headline question, max ~8 words"),
      explanation: z
        .string()
        .nullable()
        .describe("One short sentence of context; null unless essential"),
      options: z.array(
        z.object({
          value: z.string().describe("camelCase identifier"),
          label: z.string().describe("2-5 words max"),
          ops: z
            .array(z.string())
            .describe('Refs of the changes this option applies, e.g. ["a1","a3"]; empty keeps the form as it is'),
        }),
      ),
    }),
  ),
});

async function committeeProbes(
  system: string,
  currentSchema: PortfolioSchema,
  maxProbes: number,
  existingQuestions: string[],
): Promise<DesignProbeRaw[]> {
  const drafts = (
    await Promise.all(
      Array.from({ length: COMMITTEE_SIZE }, (_, i) =>
        draftCandidate(system, currentSchema, i),
      ),
    )
  ).filter((d): d is CandidateDesign => !!d);
  if (drafts.length < 2) return [];

  const order = questionOrder();
  const ops = findDisagreements(currentSchema, drafts, order).slice(0, MAX_COMMITTEE_OPS);
  if (ops.length === 0) return [];

  const prompt = `${drafts.length} designers each drafted this form independently. Below is every point where their drafts differ from the current form, with how many drafts made that change. Points where the drafts are split are decisions the description leaves open — the creator should make them.

CHANGES:
${describeOps(ops)}

${alreadyAskedBlock(existingQuestions)}

Write up to ${maxProbes} questions that let the creator decide these points:
- One decision per question: a single change, or a few changes that belong together (fields about the same topic).
- Each option lists in "ops" the refs of the changes it applies. One option applies none (it keeps the form as it is). Options can apply different subsets — all of a group, just one, none.
- Use each ref in one question only, and only refs from the list.
${
  order === "omissions"
    ? `- First, ask about fields that most drafts add but the form doesn't ask for yet: the creator may not have thought of them, so they decide whether the form needs them. Then the points where the drafts are most split. Skip a change that asks what an ALREADY ASKED question covers.`
    : `- Prefer the points where the drafts are most split (closest to half). Skip a change that isn't worth a question, or that asks what an ALREADY ASKED question covers.`
}
- Order the questions by how much the answer shapes the form.
${PROBE_QUESTION_RULES}`;

  const result = await withLlmRetry("probe-committee-wording", (abortSignal) =>
    withTracing({ tags: ["design-probes", "committee-wording"] }, () =>
      generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema: composedProbesSchema }),
        temperature: 0.3,
        abortSignal,
        maxRetries: 0,
        experimental_telemetry: telemetry("design-probe-committee"),
      }),
    ),
  );
  if (!result.output) return [];

  return composeProbes(currentSchema, ops, result.output.questions, maxProbes, order).map(
    (probe) => {
      const top = probe.ops.reduce((a, b) => (b.votes / b.voters > a.votes / a.voters ? b : a));
      return {
        id: newProbeId(),
        text: probe.text,
        explanation:
          probe.explanation ??
          `${top.votes} of ${top.voters} design drafts would change this.`,
        layer: "dimensions" as const,
        source: "committee",
        options: probe.options,
        selectedOption: null,
        status: "pending" as const,
        priority: probe.priority,
        previewStatus: "ready" as const,
        dimensionId: null,
        dimensionName: null,
      };
    },
  );
}

// ---- Prompted: ask the model for questions ---------------------------------

async function promptedProbes(
  system: string,
  maxProbes: number,
  acceptedStandards: ReturnType<typeof resolveDetectedStandards>,
  externalPrompt: string | undefined,
  existingQuestions: string[],
): Promise<DesignProbeRaw[]> {
  const source = externalPrompt ? "external" : "llm";

  // Build optional context sections
  const sections: string[] = [];

  if (acceptedStandards.length > 0) {
    const optionalFields = acceptedStandards.flatMap((detected) =>
      detected.relevantConstraints
        .filter((c) => c.required === "recommended" || c.required === "optional")
        .map(
          (c) =>
            `- ${c.label} (${c.required}): ${c.description} [${detected.standard.name}: ${c.standardReference}]`,
        ),
    );
    if (optionalFields.length > 0) {
      sections.push(
        `DOMAIN STANDARD CONTEXT:\nThe form is being built to comply with: ${acceptedStandards.map((s) => s.standard.name).join(", ")}.\nThe following optional/recommended fields from the standard(s) could be included. Generate elicitation questions that ask the user whether to include these:\n${optionalFields.join("\n")}\n\nFor standard-related questions, frame them as "The [Standard Name] standard recommends including [field]. Should this form include it?" with options like "Yes, include it" / "No, not needed for this form".`,
      );
    }
  }

  if (externalPrompt) {
    sections.push(
      `ADDITIONAL INPUT (from a collaborator):\n${fenced("collaborator_input", externalPrompt)}\n\nSurface the collaborator's concerns as concrete decisions. Always include an option that preserves the current design (e.g. "Keep as is").`,
    );
  }

  const asked = alreadyAskedBlock(existingQuestions);
  if (asked) sections.push(asked);

  const contextBlock = sections.length > 0 ? `\n\n${sections.join("\n\n")}` : "";

  const prompt = `Generate ${Math.min(maxProbes, 3)}-${maxProbes} refinement questions to improve this form design. Each question has 2-4 options.${contextBlock}

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

  if (!result.output) throw new Error("No structured output from LLM");

  const validLayers = ["intent", "dimensions", "both"] as const;
  return result.output.interactions.slice(0, maxProbes).map((interaction) => ({
    id: newProbeId(),
    text: interaction.text,
    explanation: interaction.explanation || undefined,
    layer:
      interaction.layer && validLayers.includes(interaction.layer)
        ? interaction.layer
        : "both",
    source,
    options: interaction.options,
    selectedOption: null,
    status: "pending" as const,
    // Fixtures recorded before priorities existed have none
    priority: PRIORITY_VALUES[interaction.priority] ?? 2,
    dimensionId: null,
    dimensionName: null,
  }));
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

    capText(serializeForLLM(intent), LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(interactionText, LIMITS.shortText, "Question");
    capText(selectedOptionLabel, LIMITS.shortText, "Answer");
    capJson(spacePortfolios, LIMITS.document, "Space tables");
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema: currentSchema, spacePortfolios });

    const prompt = `The creator is refining the form through design questions. They were asked:
${fenced("question", interactionText)}
They answered:
${fenced("answer", selectedOptionLabel)}

Based on this answer, you must:
1. Write a SHORT "refinementDelta" — one tight changelog sentence (e.g. "Added recurring booking fields.")
2. Return a "purposeEdit" so the form's Purpose reflects the decision.
3. Return a "schemaPatch" with ONLY the changes — do NOT regenerate the entire schema. Use:
   - "addFields": new fields to add
   - "removeFieldKeys": camelCase keys of fields to remove
   - "updateFields": existing fields to modify — the same key, and only the properties that change (keep values for the rest)
   - Omit any section that has no changes.
4. Optionally generate 0-${maxFollowUps} follow-up elicitation questions if the choice opens up new design decisions${maxFollowUps === 0 ? ". Do NOT generate any follow-up questions, return an empty followUpInteractions array." : ""}

RULES:
${PURPOSE_EDIT_RULES}
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
    const schemaPatch: SchemaPatch = toSchemaPatch(parsedResult.schemaPatch);
    const validTargetIds = spacePortfolios.map((p) => p.id);
    const {
      schema: artifactFormSchema,
      applied,
      skipped,
    } = applySchemaPatch(currentSchema, schemaPatch, { validTargetIds });

    const appliedCount =
      applied.added.length + applied.updated.length + applied.removed.length;
    const skippedCount =
      skipped.updated.length + skipped.removed.length + skipped.locked.length;
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
      .map((interaction) => ({
        id: newProbeId(),
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
        // The creator's wording stays; the decision is one bounded edit
        updatedPurpose: applyPurposeEdit(
          intent.purpose.content,
          parsedResult.purposeEdit,
        ).purpose,
        artifactFormSchema,
        followUpInteractions,
        schemaPatch,
        validTargetIds,
        applied,
        skipped,
      },
    };
  } catch (error) {
    console.error("Elicitation question resolution error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
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
      // The question and the answers asked about: a typed answer to the
      // same question is a different call
      {
        prompt: [request.probe.text, ...request.probe.options.map((o) => o.label)].join(" | "),
      },
    );
  }
  return previewDesignProbeOptionsReal(request);
}

async function previewDesignProbeOptionsReal(
  request: PreviewDesignProbeOptionsRequest,
): Promise<PreviewDesignProbeOptionsResponse> {
  try {
    const { intent, currentSchema, probe, spacePortfolios = [] } = request;

    capText(serializeForLLM(intent), LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(probe.text, LIMITS.shortText, "Question");
    capText(probe.explanation, LIMITS.shortText, "Explanation");
    capJson(probe.options, LIMITS.shortText, "Options");
    capJson(spacePortfolios, LIMITS.document, "Space tables");
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema: currentSchema, spacePortfolios });

    const prompt = `The creator is refining the form through design questions. They will be asked:
${fenced("question", probe.text)}${probe.explanation ? `\nContext:\n${fenced("context", probe.explanation)}` : ""}
Options:
${fenced("options", probe.options.map((o) => `- value ${JSON.stringify(o.value)}: ${JSON.stringify(o.label)}`).join("\n"))}

For EACH option, work out exactly how the form would change if the user chose it, so the change can be previewed and applied instantly. Return one outcome per option:
1. "value": the option's value, exactly as listed
2. "summary": what changes, as a short phrase (max ~8 words), e.g. "Adds session length and goal fields". If the option keeps the form as it is, say so and return an empty schemaPatch.
3. "schemaPatch": ONLY the changes to the current schema:
   - "addFields": new fields to add
   - "removeFieldKeys": camelCase keys of fields to remove
   - "updateFields": existing fields to modify — the same key, and only the properties that change (keep values for the rest)
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

      const schemaPatch: SchemaPatch = toSchemaPatch(outcome.schemaPatch);
      const { applied, skipped } = applySchemaPatch(currentSchema, schemaPatch, {
        validTargetIds,
      });
      const appliedCount =
        applied.added.length + applied.updated.length + applied.removed.length;
      const skippedCount =
        skipped.updated.length + skipped.removed.length + skipped.locked.length;

      const preview: ProbeOptionPreview = {
        // Don't let the summary claim a change the patch can't make
        summary:
          skippedCount > 0 && appliedCount === 0
            ? "No form change"
            : outcome.summary,
        schemaPatch,
        // What it touches now is all it may ever touch (see `scopePatch`)
        scope: {
          added: applied.added,
          updated: applied.updated,
          removed: applied.removed,
        },
      };
      if (outcome.followUp?.options.length) preview.followUp = outcome.followUp;
      return { value: option.value, label: option.label, preview };
    });

    return { success: true, options };
  } catch (error) {
    console.error("Elicitation question preview error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
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

    capText(serializeForLLM(intent), LIMITS.document, "Intent");
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
                `- ${ref} [${PRIORITY_NAMES[p.priority] ?? "medium"}] ${JSON.stringify(p.text)} — options: ${p.options.map((o) => o.label).join(" | ")}`,
            )
            .join("\n")
        : "(none)";
    const decisionList =
      decisions.length > 0
        ? decisions
            .map((d) => `- ${JSON.stringify(d.question)} → ${JSON.stringify(d.answer)}`)
            .join("\n")
        : "(none yet)";

    const system = formSystemPrompt({ intent, schema: currentSchema });

    const prompt = `You keep the list of open design questions ("elicitation questions") about this form short, current and free of repeats.

Decisions already made:
${fenced("decisions", decisionList)}

Open questions:
${fenced("open_questions", openList)}

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
        id: newProbeId(),
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
    console.error("Elicitation question curation error:", error);
    return {
      success: false,
      error: llmErrorMessage(error),
    };
  }
}

// ---------------------------------------------------------------------------
// Sync intent from direct field edits (backpropagation)
// ---------------------------------------------------------------------------

const syncIntentSchema = z.object({
  purposeEdit: purposeEditSchema,
});

export interface SyncIntentResponse {
  success: boolean;
  /** The purpose with the edit applied (when `shouldUpdate`) */
  updatedPurpose?: string;
  shouldUpdate: boolean;
  error?: string;
}

interface SyncIntentRequest {
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  editDescription: string;
  /**
   * "design-decision": the edits are answered elicitation questions, which almost
   * always change what the form is about — the purpose should follow.
   */
  kind?: "field-edit" | "design-decision";
}

export async function syncIntentFromFieldEditAction(
  request: SyncIntentRequest,
): Promise<SyncIntentResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "syncIntentFromFieldEdit",
      { editDescription: request.editDescription, kind: request.kind },
      () => syncIntentFromFieldEditReal(request),
      { prompt: request.editDescription },
    );
  }
  return syncIntentFromFieldEditReal(request);
}

async function syncIntentFromFieldEditReal(
  request: SyncIntentRequest,
): Promise<SyncIntentResponse> {
  // Logs here carry no form content: descriptions, purposes and edits are
  // what participants wrote.
  const LOG = "[syncIntentFromFieldEdit]";
  try {
    const { intent, currentSchema, editDescription } = request;
    const isDecision = request.kind === "design-decision";

    capText(serializeForLLM(intent), LIMITS.document, "Intent");
    capJson(currentSchema, LIMITS.document, "Schema");
    capText(editDescription, LIMITS.shortText, "Edit description");
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema: currentSchema });

    const prompt = `${
      isDecision
        ? "The creator answered design questions about the form, and the schema above already reflects those decisions"
        : "The creator directly edited the form, and the schema above already reflects the edit"
    }:
${fenced(isDecision ? "decisions" : "edits", editDescription)}

Return a "purposeEdit" that keeps the form's Purpose in sync.

RULES:
${PURPOSE_EDIT_RULES}
${
  isDecision
    ? `- Use op "none" only when the decisions kept the form as it was, or the purpose already says it.`
    : `- If the edit is trivial (typo fix, minor wording change, reordering), use op "none".
- If the edit meaningfully changes what the form collects (new field type, new options, renamed concept), make an edit.`
}`;

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

    const { purpose, applied } = applyPurposeEdit(
      intent.purpose.content,
      result.output.purposeEdit,
    );
    return {
      success: true,
      shouldUpdate: applied !== "none",
      updatedPurpose: applied !== "none" ? purpose : undefined,
    };
  } catch (error) {
    console.error(LOG, "failed:", llmErrorMessage(error));
    return {
      success: false,
      shouldUpdate: false,
      error: llmErrorMessage(error),
    };
  }
}
