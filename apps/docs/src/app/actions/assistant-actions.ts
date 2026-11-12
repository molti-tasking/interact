"use server";

import { toSchemaPatch } from "interact/forms/form-model";
import type { SchemaPatch } from "interact/forms/schema-patch";
import { normalizeFieldKey } from "interact/forms/structured-intent";
import { capJson, capText, guardLlmRequest, LIMITS } from "@/lib/llm-guard";
import { llmErrorMessage, model, withLlmRetry } from "@/lib/model";
import {
  ASSISTANT_PROMPT_VERSION,
  assistantSystemPrompt,
  assistantTurnSchema,
} from "@/lib/study/prompts/assistant";
import { telemetry, withTracing } from "@/lib/telemetry";
import type { PortfolioSchema } from "@/lib/types";
import { generateText, Output, type ModelMessage } from "ai";

export interface AssistantMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantTurnRequest {
  /** The form as it is now (including the participant's own edits) */
  schema: PortfolioSchema;
  /** The whole conversation, oldest first; the last message is the participant's new one */
  messages: AssistantMessage[];
}

export interface AssistantTurnResponse {
  success: boolean;
  result?: {
    reply: string;
    /** Null: the turn leaves the form as it is */
    schemaPatch: SchemaPatch | null;
    promptVersion: string;
  };
  error?: string;
}

/**
 * One turn of the `assistant` study arm: the participant's message, the
 * whole conversation and the current form go to the same model the full
 * tool uses; it answers in text and, if it wants, changes the form with a
 * patch in the chat edits' vocabulary. What it does — build, ask, suggest —
 * is the model's own choice (see `lib/study/prompts/assistant.ts`).
 */
export async function assistantTurnAction(
  request: AssistantTurnRequest,
): Promise<AssistantTurnResponse> {
  if (process.env.USE_FIXTURES || process.env.RECORD_FIXTURES) {
    const { fixtureGuard } = await import("@/lib/testing/fixture-guard");
    const last = request.messages[request.messages.length - 1]?.text ?? "";
    return fixtureGuard(
      "assistantTurn",
      { messages: request.messages },
      () => assistantTurnReal(request),
      { prompt: last },
    );
  }
  return assistantTurnReal(request);
}

async function assistantTurnReal(request: AssistantTurnRequest): Promise<AssistantTurnResponse> {
  try {
    const { schema, messages } = request;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user" || !last.text.trim()) {
      return { success: false, error: "Write a message first" };
    }
    capText(last.text, LIMITS.prompt, "Message");
    capJson(schema, LIMITS.document, "Form");
    capJson(messages, LIMITS.document, "Conversation");
    await guardLlmRequest();

    const conversation: ModelMessage[] = messages
      .filter((m) => m.text.trim())
      .map((m) => ({ role: m.role, content: m.text }));

    const result = await withLlmRetry("assistant-turn", (abortSignal) =>
      withTracing({ tags: ["study", "assistant"] }, () =>
        generateText({
          model,
          output: Output.object({ schema: assistantTurnSchema }),
          system: assistantSystemPrompt(schema),
          messages: conversation,
          // As the full tool's form generation; dropped for models that
          // only take their default (see llm-temperature.ts)
          temperature: 0.3,
          abortSignal,
          maxRetries: 0,
          experimental_telemetry: telemetry("assistant-turn"),
        }),
      ),
    );

    if (!result.output) {
      return { success: false, error: "Model did not return structured output" };
    }

    const raw = result.output.schemaPatch;
    let schemaPatch: SchemaPatch | null = null;
    if (raw) {
      const patch = toSchemaPatch(raw);
      const addFields = patch.addFields?.map((f, i) => ({
        ...f,
        key: normalizeFieldKey(f.key || f.label, `field${i + 1}`),
      }));
      schemaPatch = { ...patch, ...(addFields ? { addFields } : {}) };
    }
    return {
      success: true,
      result: {
        reply: result.output.reply.trim(),
        schemaPatch,
        promptVersion: ASSISTANT_PROMPT_VERSION,
      },
    };
  } catch (error) {
    console.error("Assistant turn error:", error);
    return { success: false, error: llmErrorMessage(error) };
  }
}
