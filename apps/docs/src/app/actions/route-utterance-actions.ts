"use server";

import { serializeForLLM } from "@/lib/engine/structured-intent";
import { model } from "@/lib/model";
import { withTracing } from "@/lib/telemetry";
import type {
  PortfolioSchema,
  SectionKey,
  StructuredIntent,
} from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/**
 * Voice utterance router — the "smart" record-mode variant.
 *
 * Instead of appending raw transcripts to the purpose (which degrades the
 * intent into a transcript log and forces the full pipeline on every phrase),
 * this classifies an utterance and synthesizes it into the structured intent:
 *
 * - Section talk ("only staff will fill this in", "no phone numbers") is
 *   merged into the affected sections as coherent prose, so the pipeline can
 *   pick the minimal strategy (exclusions-only → deterministic filter, etc.).
 * - Direct form edits ("make the email field required") are flagged as
 *   `schemaEdit` so the caller can route them through the patch-based
 *   design-probe resolution path instead of a full regeneration.
 */

const routeUtteranceSchema = z.object({
  route: z
    .enum(["intent", "schemaEdit"])
    .describe(
      "'schemaEdit' only for direct commands about existing form fields; otherwise 'intent'",
    ),
  summary: z
    .string()
    .describe("One tight sentence describing what was understood, for the activity log"),
  sections: z
    .array(
      z.object({
        section: z.enum(["purpose", "audience", "exclusions", "constraints"]),
        mergedContent: z
          .string()
          .describe(
            "The COMPLETE rewritten content for this section with the utterance merged in",
          ),
      }),
    )
    .describe("Only sections the utterance affects. Empty when route is schemaEdit."),
});

export interface RoutedSection {
  section: SectionKey;
  mergedContent: string;
}

export interface RouteUtteranceResponse {
  success: boolean;
  route?: "intent" | "schemaEdit";
  summary?: string;
  sections?: RoutedSection[];
  error?: string;
}

export async function routeUtteranceAction(
  intent: StructuredIntent,
  currentSchema: PortfolioSchema,
  utterance: string,
): Promise<RouteUtteranceResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "routeUtteranceAction",
      { intent, fieldCount: currentSchema.fields.length, utterance },
      () => routeUtteranceReal(intent, currentSchema, utterance),
      { prompt: utterance },
    );
  }
  return routeUtteranceReal(intent, currentSchema, utterance);
}

async function routeUtteranceReal(
  intent: StructuredIntent,
  currentSchema: PortfolioSchema,
  utterance: string,
): Promise<RouteUtteranceResponse> {
  try {
    const hasSchema = currentSchema.fields.length > 0;
    const intentText = serializeForLLM(intent) || "(empty — nothing defined yet)";

    const fieldList = hasSchema
      ? currentSchema.fields
          .map((f) => `- ${f.name} ("${f.label}", ${f.type.kind}${f.required ? ", required" : ""})`)
          .join("\n")
      : "(no fields yet)";

    const prompt = `You are routing a spoken utterance from someone designing a data-collection form by voice. Spoken language is messy: it contains corrections, hesitations, and contradictions of earlier statements.

CURRENT STRUCTURED INTENT:
${intentText}

CURRENT FORM FIELDS:
${fieldList}

THE USER JUST SAID: "${utterance}"

Decide the route:
- "schemaEdit": ONLY if the utterance is a direct command about specific existing form fields (e.g. "remove the email field", "make phone number required", "add an option for vegan")${hasSchema ? "" : " — NOT available here because the form has no fields yet; use 'intent'"}.
- "intent": everything else — statements about what the form is for, who fills it in, what to exclude, or rules/constraints.

For route "intent", return the affected sections with their COMPLETE merged content:
- "purpose": what the form is for. Synthesize into a coherent 2-4 sentence paragraph — do NOT append the raw transcript. Drop filler words. If the utterance corrects or contradicts existing content, the newest statement wins.
- "audience": who fills the form in.
- "exclusions": fields/topics to NOT include, as a short comma-separated list of keywords (this is matched deterministically against field names).
- "constraints": rules, compliance, limits — short lines.
- Only include sections that actually change. Preserve existing content that the utterance doesn't touch.

Always return a one-sentence "summary" of what you understood, phrased as a confirmation (e.g. "Noted the audience: returning customers.").`;

    const result = await withTracing(
      { tags: ["voice", "route-utterance"] },
      () =>
        generateText({
          model,
          prompt,
          output: Output.object({ schema: routeUtteranceSchema }),
          temperature: 0.2,
          experimental_telemetry: {
            isEnabled: true,
            functionId: "route-utterance-action",
            recordInputs: true,
            recordOutputs: true,
          },
        }),
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    const parsed = result.output;

    // A schemaEdit route is only valid when there is a schema to edit
    const route =
      parsed.route === "schemaEdit" && hasSchema ? "schemaEdit" : "intent";

    return {
      success: true,
      route,
      summary: parsed.summary,
      sections: route === "intent" ? parsed.sections : [],
    };
  } catch (error) {
    console.error("Utterance routing error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
