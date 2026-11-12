/**
 * The direct route to Anthropic's Messages API (`LLM_PROVIDER=anthropic`,
 * used by the evaluation harness). What goes over the wire for a structured
 * call on a Claude 5 model:
 * - no temperature (Claude 5 models reject a non-default one);
 * - an explicit output cap (the provider would send 4096 for a model it
 *   doesn't know);
 * - native structured output (`output_config.format`), not a "json" tool.
 */
import { anthropicChatModel, ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS } from "@/lib/model";
import { generateText, Output } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";

function recordingFetch() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: '{"answer":"yes"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { fetch: fetch as typeof globalThis.fetch, bodies };
}

describe("Anthropic Messages API route", () => {
  it("sends a structured call the way Claude 5 needs it", async () => {
    const { fetch, bodies } = recordingFetch();
    const model = anthropicChatModel("claude-sonnet-5", { apiKey: "test", fetch });

    const result = await generateText({
      model,
      temperature: 0.2,
      prompt: "Is this a test?",
      output: Output.object({ schema: z.object({ answer: z.string() }) }),
    });

    expect(result.output).toEqual({ answer: "yes" });
    const [body] = bodies;
    expect(body.model).toBe("claude-sonnet-5");
    expect(body).not.toHaveProperty("temperature");
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS);
    expect(body.output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(body.tools ?? []).toEqual([]);
  });

  it("keeps an output cap the call sets itself", async () => {
    const { fetch, bodies } = recordingFetch();
    await generateText({
      model: anthropicChatModel("claude-sonnet-5", { apiKey: "test", fetch }),
      maxOutputTokens: 2_000,
      prompt: "Short answer",
    });
    expect(bodies[0].max_tokens).toBe(2_000);
  });
});
