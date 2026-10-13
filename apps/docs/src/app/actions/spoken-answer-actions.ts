"use server";

import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { fastModel, withLlmRetry } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { SpokenAnswer, VoiceQuestion } from "@/lib/voice/spoken-answer";
import { generateText, Output } from "ai";
import { z } from "zod";

/**
 * Talk to the deck: map a spoken phrase to answers for the open questions
 * (design probes, conflict fixes). The question on screen is the default
 * target; others are answered only when the user clearly refers to them.
 */

export interface InterpretSpokenAnswerRequest {
  utterance: string;
  /** Open questions in deck order */
  questions: VoiceQuestion[];
  /** The question on screen */
  currentId: string;
  /** The previous phrase and what it did — for corrections and continuations */
  previous?: { utterance: string; outcome: string };
}

export interface InterpretSpokenAnswerResponse {
  success: boolean;
  answers?: { questionId: string; answer: SpokenAnswer }[];
  /** What was heard, when it answered nothing */
  note?: string;
  error?: string;
}

const interpretSchema = z.object({
  answers: z
    .array(
      z.object({
        ref: z.string().describe('The question\'s ref exactly as listed, e.g. "q1"'),
        action: z.enum(["option", "custom", "skip"]),
        option: z
          .string()
          .optional()
          .describe('For "option": the option\'s value exactly as listed in [brackets]'),
        customAnswer: z
          .string()
          .optional()
          .describe('For "custom": the answer in a few clean words, without filler'),
      }),
    )
    .describe("Empty when the speech answers none of the questions"),
  note: z
    .string()
    .optional()
    .describe("When there are no answers: what you heard, in a few words"),
});

export async function interpretSpokenAnswerAction(
  request: InterpretSpokenAnswerRequest,
): Promise<InterpretSpokenAnswerResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "interpretSpokenAnswerAction",
      request,
      () => interpretSpokenAnswerReal(request),
      { prompt: request.utterance },
    );
  }
  return interpretSpokenAnswerReal(request);
}

async function interpretSpokenAnswerReal({
  utterance,
  questions,
  currentId,
  previous,
}: InterpretSpokenAnswerRequest): Promise<InterpretSpokenAnswerResponse> {
  try {
    capText(utterance, LIMITS.shortText, "Utterance");
    capJson(questions, LIMITS.document, "Questions");
    capJson(previous, LIMITS.prompt, "Previous phrase");
    await guardLlmRequest();
    if (questions.length === 0) return { success: true, answers: [] };

    const byRef = new Map(questions.map((q, i) => [`q${i + 1}`, q]));
    const questionList = [...byRef]
      .map(([ref, q]) => {
        const current = q.id === currentId ? " (CURRENT — on screen)" : "";
        const options = q.options
          .map((o) => `[${o.value}] "${o.label}"`)
          .join(" | ");
        return `${ref}${current}: "${q.text}"\n  options: ${options}\n  free-text answers: ${q.allowCustom ? "allowed" : "not allowed"}`;
      })
      .join("\n");

    const system = `You map what a user said aloud to answers for the open design questions about their form. The speech is transcribed and messy: filler words, hesitations, self-corrections (the last statement wins).`;

    const prompt = `Open questions:
${questionList}
${previous ? `\nPrevious phrase: "${previous.utterance}" → ${previous.outcome}\n` : ""}
The user just said: "${utterance}"

Return "answers":
- Answer the CURRENT question unless the user clearly refers to another one by its topic.
- "option" with the option's value when what they said means one of the options — paraphrases, "the first one", a "yes"/"no" that clearly picks one.
- "custom" with "customAnswer" when it answers the question but no option fits (e.g. a combination or a nuance). Only where free-text answers are allowed; otherwise use the closest option, or leave the question out if none is close.
- "skip" when they want to skip the question or say it doesn't apply.
- At most one answer per question. Answer several questions only when they clearly answered several.
- Return NO answers for filler, thinking aloud, unfinished fragments, questions back, or talk that isn't about these questions — then set "note" to what you heard in a few words.`;

    const result = await withLlmRetry(
      "interpret-spoken-answer",
      (abortSignal) =>
        withTracing({ tags: ["voice", "probe-answer"] }, () =>
          generateText({
            model: fastModel,
            system,
            prompt,
            output: Output.object({ schema: interpretSchema }),
            temperature: 0.1,
            abortSignal,
            maxRetries: 0,
            experimental_telemetry: telemetry("interpret-spoken-answer"),
          }),
        ),
      { timeoutMs: 20_000 },
    );

    if (!result.output) {
      return { success: false, error: "No structured output from LLM" };
    }

    // Only answers that point at a listed question with a valid choice
    const answers: { questionId: string; answer: SpokenAnswer }[] = [];
    const answered = new Set<string>();
    for (const a of result.output.answers) {
      const question = byRef.get(a.ref.trim());
      if (!question || answered.has(question.id)) continue;

      let answer: SpokenAnswer | null = null;
      if (a.action === "skip") {
        answer = { action: "skip" };
      } else if (a.action === "option") {
        // Tolerate the label being returned instead of the value
        const ref = a.option?.trim().toLowerCase();
        const option = question.options.find(
          (o) => o.value.toLowerCase() === ref || o.label.toLowerCase() === ref,
        );
        if (option) answer = { action: "option", value: option.value };
      } else if (question.allowCustom && a.customAnswer?.trim()) {
        answer = { action: "custom", text: a.customAnswer.trim() };
      }

      if (answer) {
        answered.add(question.id);
        answers.push({ questionId: question.id, answer });
      }
    }

    return {
      success: true,
      answers,
      note: answers.length === 0 ? result.output.note : undefined,
    };
  } catch (error) {
    console.error("Spoken answer interpretation error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
