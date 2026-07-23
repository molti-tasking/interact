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
 * - Concrete values ("I found one t-shirt, two hoodies and a blue beanie")
 *   are flagged as `dataEntry` and extracted into records keyed by the
 *   schema's field names, so the caller can insert them as form responses.
 */

const routeUtteranceSchema = z.object({
  route: z
    .enum(["intent", "schemaEdit", "dataEntry"])
    .describe(
      "'schemaEdit' for direct commands about existing form fields; 'dataEntry' when the utterance states concrete values to record; otherwise 'intent'",
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
    .describe("Only sections the utterance affects. Empty unless route is intent."),
  records: z
    .array(
      z.object({
        values: z.array(
          z.object({
            field: z.string().describe("EXACT field key from CURRENT FORM FIELDS"),
            value: z.string().describe("The value as a plain string"),
          }),
        ),
      }),
    )
    .describe(
      "Only when route is dataEntry: one record per real-world entry mentioned. Empty otherwise.",
    ),
});

export interface RoutedSection {
  section: SectionKey;
  mergedContent: string;
}

export interface RoutedRecord {
  values: { field: string; value: string }[];
}

export interface RouteUtteranceResponse {
  success: boolean;
  route?: "intent" | "schemaEdit" | "dataEntry";
  summary?: string;
  sections?: RoutedSection[];
  records?: RoutedRecord[];
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
- "dataEntry": the utterance states CONCRETE VALUES to record with the form — observations, counts, found items, measurements (e.g. "I found one t-shirt, two hoodies and a blue beanie")${hasSchema ? "" : " — NOT available here because the form has no fields yet; use 'intent'"}. Design talk about what KINDS of data to collect is "intent", not "dataEntry".
- "intent": everything else — statements about what the form is for, who fills it in, what to exclude, or rules/constraints.

For route "dataEntry", extract "records":
- One record per real-world entry (e.g. three items mentioned → three records).
- Each value uses the EXACT field key from CURRENT FORM FIELDS ("name" property) — never invent keys.
- Values as plain strings ("2", not "two"); for select fields use one of the defined option values.
- Skip fields the utterance says nothing about.

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

    // schemaEdit and dataEntry are only valid when there is a schema
    const route =
      (parsed.route === "schemaEdit" || parsed.route === "dataEntry") &&
      !hasSchema
        ? "intent"
        : parsed.route;

    // Keep only values that reference real field keys
    const validKeys = new Set(currentSchema.fields.map((f) => f.name));
    const records =
      route === "dataEntry"
        ? (parsed.records ?? [])
            .map((r) => ({
              values: r.values.filter((v) => validKeys.has(v.field)),
            }))
            .filter((r) => r.values.length > 0)
        : [];

    return {
      success: true,
      route,
      summary: parsed.summary,
      sections: route === "intent" ? parsed.sections : [],
      records,
    };
  } catch (error) {
    console.error("Utterance routing error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
