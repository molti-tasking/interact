"use server";

import {
  schemaPatchRules,
  schemaPatchSchema,
  toSchemaPatch,
} from "interact/forms/form-model";
import { fenced, formSystemPrompt } from "interact/forms/prompt";
import type { SchemaPatch } from "interact/forms/schema-patch";
import { normalizeFieldKey } from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { llmErrorMessage, model, withLlmRetry } from "@/lib/model";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { PortfolioSchema, StructuredIntent } from "@/lib/types";
import { generateText, Output } from "ai";
import { z } from "zod";

/** Earlier requests kept as context, newest last */
const MAX_HISTORY = 12;

export interface ChatEditRequest {
  /** The creator's first description (the form was generated from it) */
  intent: StructuredIntent;
  currentSchema: PortfolioSchema;
  /** What the creator just asked for */
  message: string;
  /** Their earlier requests in this conversation, oldest first */
  history?: string[];
}

export interface ChatEditResponse {
  success: boolean;
  result?: {
    /** One or two sentences to show as the tool's answer */
    reply: string;
    schemaPatch: SchemaPatch;
  };
  error?: string;
}

const chatEditResponseSchema = z.object({
  reply: z
    .string()
    .describe(
      "One or two plain sentences to the creator saying what you changed, e.g. 'I added a question about allergies and made the phone number optional.' If the request is unclear or needs no change, say so.",
    ),
  schemaPatch: schemaPatchSchema,
});

/**
 * The baseline study condition: a free-text change request applied to the
 * form by the same model, as a patch. It does what was asked and nothing
 * more — no questions back, no suggestions — so the comparison with design
 * probes is about who raises the open decisions, not about the model.
 */
export async function chatEditFormAction(
  request: ChatEditRequest,
): Promise<ChatEditResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    return fixtureGuard(
      "chatEditForm",
      { message: request.message, history: request.history },
      () => chatEditFormReal(request),
      { prompt: request.message },
    );
  }
  return chatEditFormReal(request);
}

async function chatEditFormReal(request: ChatEditRequest): Promise<ChatEditResponse> {
  try {
    const { intent, currentSchema, message, history = [] } = request;
    capText(message, LIMITS.document, "Message");
    capJson(currentSchema, LIMITS.document, "Schema");
    capJson(history, LIMITS.document, "Conversation");
    await guardLlmRequest();

    const system = formSystemPrompt({ intent, schema: currentSchema });
    const earlier = history.slice(-MAX_HISTORY);
    const historyBlock =
      earlier.length > 0
        ? `\nThe creator's earlier requests in this conversation (already applied to the schema above), oldest first:\n${fenced("earlier_requests", earlier.map((m, i) => `${i + 1}. ${m}`).join("\n"))}\n`
        : "";

    const prompt = `The creator is changing their form by writing to you. Apply their request to the form.
${historyBlock}
Their request:
${fenced("request", message)}

Return a "schemaPatch" with ONLY what the request asks for:
- "addFields": questions the request asks to add
- "updateFields": fields the request changes (same key, only the properties that change, keep values for the rest)
- "removeFieldKeys": fields the request asks to remove
- "sections": when the request is about sections or the form has sections and gets new fields
Do exactly what is asked. Do not add, change or remove anything the request doesn't mention, and do not ask questions back or suggest further changes. If the request is unclear or doesn't concern the form, return an empty patch and say so in "reply".

RULES:
${schemaPatchRules(false)}`;

    const result = await withLlmRetry("chat-edit", (abortSignal) =>
      withTracing({ tags: ["schema", "chat-edit"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: chatEditResponseSchema }),
          system,
          prompt,
          temperature: 0.2,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("chat-edit"),
        }),
      ),
    );

    if (!result.output) {
      return { success: false, error: "Model did not return structured output" };
    }

    const schemaPatch = toSchemaPatch(result.output.schemaPatch);
    const addFields = schemaPatch.addFields?.map((f, i) => ({
      ...f,
      key: normalizeFieldKey(f.key || f.label, `field${i + 1}`),
    }));
    return {
      success: true,
      result: {
        reply: result.output.reply.trim(),
        schemaPatch: { ...schemaPatch, addFields },
      },
    };
  } catch (error) {
    console.error("Chat edit error:", error);
    return { success: false, error: llmErrorMessage(error) };
  }
}
