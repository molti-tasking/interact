"use server";

import {
  pretestFields,
  sanitizeRespondents,
  TROUBLE_KINDS,
  type SimulatedRespondent,
} from "interact/forms/pretest";
import { formSystemPrompt } from "interact/forms/prompt";
import { serializeForLLM } from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { llmErrorMessage, model, withLlmRetry } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/**
 * Pretest: a model plays varied respondents who fill in the draft form and
 * note where they had trouble. It returns their answers and notes only —
 * what they add up to is worked out in `engine/pretest.ts`. Nothing is
 * stored: simulated answers never become responses.
 */

export interface SimulateRespondentsResponse {
  success: boolean;
  respondents?: SimulatedRespondent[];
  /** How many were asked for; fewer come back when a batch fails */
  requested?: number;
  error?: string;
}

const MIN_RESPONDENTS = 4;
const MAX_RESPONDENTS = 24;
const DEFAULT_RESPONDENTS = 12;
/** Respondents per call, so one call's output stays bounded */
const BATCH_SIZE = 6;

/**
 * Who each batch plays, so batches running in parallel don't all draw the
 * same typical respondent.
 */
const BATCH_BRIEFS = [
  "the people this form is most obviously for, in their usual situation",
  "people at the edges of the audience: newcomers, people filling it in for someone else, people in a hurry, people who don't know some of what is asked",
  "people whose situation the form's author probably didn't think of: unusual cases, answers that fit none of the choices, people wary of sharing personal details",
  "people who read carefully and take questions literally, and people who misread or skim",
];

const respondentsSchema = z.object({
  respondents: z.array(
    z.object({
      persona: z
        .string()
        .describe("Who this is, one line, e.g. 'Retired teacher, new to the club'"),
      answers: z
        .array(
          z.object({
            field: z.string().describe("The field's key, exactly as listed"),
            value: z
              .string()
              .nullable()
              .describe(
                "The answer as this person would enter it; null when they skip the question or can't answer it",
              ),
          }),
        )
        .describe("One entry per field, in form order"),
      troubles: z
        .array(
          z.object({
            field: z.string().describe("The field's key, exactly as listed"),
            kind: z
              .enum(TROUBLE_KINDS)
              .describe(
                "unclear: didn't understand what is asked; cant-answer: doesn't know or have this; missing-option: their answer isn't among the choices; too-personal: doesn't want to share this here",
              ),
            note: z.string().describe("In their words, one short sentence"),
            suggestion: z
              .string()
              .nullable()
              .describe(
                "missing-option: the choice they were looking for, 1-4 words; null otherwise",
              ),
          }),
        )
        .describe("Only real trouble this person would have — most have none"),
    }),
  ),
});

function clampCount(value: unknown): number {
  const n =
    typeof value === "number" && Number.isFinite(value)
      ? Math.floor(value)
      : DEFAULT_RESPONDENTS;
  return Math.min(MAX_RESPONDENTS, Math.max(MIN_RESPONDENTS, n));
}

export async function simulateRespondentsAction(
  intent: StructuredIntent,
  schema: PortfolioSchema,
  count: number = DEFAULT_RESPONDENTS,
): Promise<SimulateRespondentsResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "simulateRespondents",
      { intent: serializeForLLM(intent), schema, count },
      () => simulateRespondentsReal(intent, schema, count),
      { prompt: serializeForLLM(intent) },
    );
  }
  return simulateRespondentsReal(intent, schema, count);
}

async function simulateBatch(
  system: string,
  schema: PortfolioSchema,
  size: number,
  batch: number,
): Promise<SimulatedRespondent[]> {
  const prompt = `Pretest this form before real people see it. Play ${size} different people filling it in — ${BATCH_BRIEFS[batch % BATCH_BRIEFS.length]}. Make them differ from each other in background, situation and how they'd answer.

For each person:
- "persona": who they are, one line.
- "answers": what they would actually enter for every field, by key (${pretestFields(schema)
    .map((f) => f.name)
    .join(", ")}). Answer as that person, not as an ideal respondent: skip optional questions they wouldn't bother with (null), and give null when they can't or won't answer. For a choice, give the option's label — or what they would have wanted to answer if no option fits. Numbers as digits, dates as YYYY-MM-DD, yes/no as "yes" or "no".
- "troubles": where THIS person would hesitate, get stuck or give up, and why. Report only trouble that follows from who they are and how the question is put — don't invent problems to have something to say. Most people have none or one.`;

  const result = await withLlmRetry("pretest", (abortSignal) =>
    withTracing({ tags: ["pretest", "simulate"] }, () =>
      generateText({
        model,
        system,
        prompt,
        output: Output.object({ schema: respondentsSchema }),
        // Respondents should differ
        temperature: 0.9,
        abortSignal,
        maxRetries: 0,
        experimental_telemetry: telemetry("pretest-simulate"),
      }),
    ),
    { timeoutMs: 60_000 },
  );
  if (!result.output) return [];
  // A batch never counts for more people than it was asked to play
  return sanitizeRespondents(schema, result.output.respondents.slice(0, size));
}

async function simulateRespondentsReal(
  intent: StructuredIntent,
  schema: PortfolioSchema,
  requestedCount: number,
): Promise<SimulateRespondentsResponse> {
  try {
    const count = clampCount(requestedCount);
    capText(serializeForLLM(intent), LIMITS.document, "Intent");
    capJson(schema, LIMITS.document, "Schema");
    if (pretestFields(schema).length === 0) {
      return { success: false, error: "The form has no questions to pretest yet." };
    }
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema });
    const sizes: number[] = [];
    for (let left = count; left > 0; left -= BATCH_SIZE) sizes.push(Math.min(BATCH_SIZE, left));

    const batches = await Promise.allSettled(
      sizes.map((size, i) => simulateBatch(system, schema, size, i)),
    );
    const respondents = batches.flatMap((b) => (b.status === "fulfilled" ? b.value : []));
    // A model sometimes stops after fewer people than it was asked to play
    // (seen live: 1 of 6). Ask once more for the ones still missing.
    const missing = count - respondents.length;
    if (respondents.length > 0 && missing > 0) {
      const extra = await simulateBatch(
        system,
        schema,
        Math.min(BATCH_SIZE, missing),
        sizes.length,
      ).catch((error) => {
        console.warn("[pretest] the top-up batch failed:", llmErrorMessage(error));
        return [];
      });
      respondents.push(...extra);
    }
    if (respondents.length === 0) {
      const failed = batches.find((b) => b.status === "rejected");
      return {
        success: false,
        error: failed ? llmErrorMessage(failed.reason) : "The pretest returned no respondents.",
      };
    }
    for (const b of batches) {
      if (b.status === "rejected") {
        console.warn("[pretest] a batch failed:", llmErrorMessage(b.reason));
      }
    }
    return { success: true, respondents, requested: count };
  } catch (error) {
    console.error("Pretest error:", llmErrorMessage(error));
    return { success: false, error: llmErrorMessage(error) };
  }
}
