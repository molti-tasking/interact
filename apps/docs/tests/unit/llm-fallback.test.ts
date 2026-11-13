// @vitest-environment node
/**
 * Gateway first, Anthropic's API when the gateway turns a call away (rate
 * limit, budget, overload): the same call, structured output included, goes
 * to Anthropic, and for a while after that the gateway is skipped. Other
 * failures are not handed over. No real calls: both APIs are stubbed.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { anthropicModelId, llmFallbackFromEnv } from "@/lib/llm-fallback";
import { anthropicChatModel, gatewayChatModel, shouldFallBack, withAnthropicFallback } from "@/lib/model";

function gateway(status: number, body: unknown) {
  const calls: string[] = [];
  const fetch = (async (url: RequestInfo | URL) => {
    calls.push(String(url));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  const provider = createOpenAI({ baseURL: "http://gateway.test/v1", apiKey: "gateway-key", fetch });
  return { model: gatewayChatModel("anthropic/claude-sonnet-5-5", provider), calls };
}

const GATEWAY_OK = {
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 0,
  model: "anthropic/claude-sonnet-5-5",
  choices: [{ index: 0, message: { role: "assistant", content: '{"answer":"from the gateway"}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 3, completion_tokens: 3, total_tokens: 6 },
};

function anthropic() {
  const bodies: Record<string, unknown>[] = [];
  const fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return new Response(
      JSON.stringify({
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5-5",
        content: [{ type: "text", text: '{"answer":"from Anthropic"}' }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
  return { model: anthropicChatModel("claude-sonnet-5-5", { apiKey: "anthropic-key", fetch }), bodies };
}

const ask = (model: Parameters<typeof generateText>[0]["model"]) =>
  generateText({
    model,
    maxRetries: 0,
    prompt: "Is this a test?",
    output: Output.object({ schema: z.object({ answer: z.string() }) }),
  });

describe("fallback to Anthropic's API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends a call the gateway rate-limits to Anthropic, structured output included", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = gateway(429, { error: { message: "Rate limit exceeded", type: "rate_limit_error" } });
    const fallback = anthropic();
    const model = withAnthropicFallback(primary.model, fallback.model, {
      label: "claude-sonnet-5-5",
      state: { restingUntil: 0 },
    });

    const result = await ask(model);

    expect(result.output).toEqual({ answer: "from Anthropic" });
    expect(primary.calls).toHaveLength(1);
    expect(fallback.bodies).toHaveLength(1);
    expect(fallback.bodies[0].model).toBe("claude-sonnet-5-5");
    expect(fallback.bodies[0].output_config).toMatchObject({ format: { type: "json_schema" } });
    expect(fallback.bodies[0]).not.toHaveProperty("temperature");
  });

  it("falls back when the key is over its budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const primary = gateway(400, { error: { message: "ExceededBudget: User=abc over budget", type: "budget_exceeded" } });
    const fallback = anthropic();
    const model = withAnthropicFallback(primary.model, fallback.model, { label: "x", state: { restingUntil: 0 } });
    expect((await ask(model)).output).toEqual({ answer: "from Anthropic" });
  });

  it("skips the gateway for a while after a fallback, then tries it again", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let clock = 1_000_000;
    const state = { restingUntil: 0 };
    const primary = gateway(429, { error: { message: "Rate limit exceeded" } });
    const fallback = anthropic();
    const model = withAnthropicFallback(primary.model, fallback.model, {
      label: "claude-sonnet-5-5",
      cooldownMs: 60_000,
      state,
      now: () => clock,
    });

    await ask(model);
    clock += 30_000;
    await ask(model);
    expect(primary.calls).toHaveLength(1); // the second call went straight to Anthropic
    expect(fallback.bodies).toHaveLength(2);
    expect(warn).toHaveBeenCalledTimes(1);

    clock += 31_000;
    await ask(model);
    expect(primary.calls).toHaveLength(2); // rested long enough: the gateway again
  });

  it("uses the gateway when it answers", async () => {
    const primary = gateway(200, GATEWAY_OK);
    const fallback = anthropic();
    const model = withAnthropicFallback(primary.model, fallback.model, { label: "x", state: { restingUntil: 0 } });
    expect((await ask(model)).output).toEqual({ answer: "from the gateway" });
    expect(fallback.bodies).toHaveLength(0);
  });

  it("doesn't hand over a request the gateway rejects for other reasons", async () => {
    const primary = gateway(400, { error: { message: "Invalid schema for response_format" } });
    const fallback = anthropic();
    const model = withAnthropicFallback(primary.model, fallback.model, { label: "x", state: { restingUntil: 0 } });
    await expect(ask(model)).rejects.toThrow(/Invalid schema/);
    expect(fallback.bodies).toHaveLength(0);
  });

  it("classifies gateway failures", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const network = Object.assign(new Error("connect"), { code: "ECONNREFUSED" });
    expect(shouldFallBack(abort)).toBe(false);
    expect(shouldFallBack(timeout)).toBe(false);
    expect(shouldFallBack(network)).toBe(true);
    expect(shouldFallBack(new Error("fetch failed"))).toBe(true);
    expect(shouldFallBack(new Error("Model did not return structured output"))).toBe(false);
  });
});

describe("llmFallbackFromEnv", () => {
  const base = { LLM_MODEL_NAME: "anthropic/claude-sonnet-5-5", ANTHROPIC_API_KEY: "sk-ant-test" };

  it("is on with a key, using the gateway model's Anthropic id", () => {
    expect(llmFallbackFromEnv(base)).toEqual({
      fallback: { model: "claude-sonnet-5-5", fastModel: "claude-sonnet-5-5" },
      problem: null,
    });
    expect(
      llmFallbackFromEnv({ ...base, LLM_FAST_MODEL_NAME: "anthropic/claude-haiku-5-5" }).fallback?.fastModel,
    ).toBe("claude-haiku-5-5");
  });

  it("takes explicit model names", () => {
    expect(
      llmFallbackFromEnv({
        ...base,
        LLM_MODEL_NAME: "my-alias",
        LLM_FALLBACK_MODEL_NAME: "claude-sonnet-5-5",
        LLM_FALLBACK_FAST_MODEL_NAME: "claude-haiku-5-5",
      }).fallback,
    ).toEqual({ model: "claude-sonnet-5-5", fastModel: "claude-haiku-5-5" });
  });

  it("says why it is off when the model name isn't a Claude id", () => {
    const { fallback, problem } = llmFallbackFromEnv({ ...base, LLM_MODEL_NAME: "my-alias" });
    expect(fallback).toBeNull();
    expect(problem).toMatch(/LLM_FALLBACK_MODEL_NAME/);
  });

  it("is off without a key, when switched off, or when everything goes to Anthropic already", () => {
    expect(llmFallbackFromEnv({ LLM_MODEL_NAME: base.LLM_MODEL_NAME }).fallback).toBeNull();
    expect(llmFallbackFromEnv({ ...base, ANTHROPIC_API_KEY: " " }).fallback).toBeNull();
    expect(llmFallbackFromEnv({ ...base, LLM_FALLBACK: "off" }).fallback).toBeNull();
    expect(llmFallbackFromEnv({ ...base, LLM_PROVIDER: "anthropic" }).fallback).toBeNull();
  });

  it("maps gateway names to Anthropic ids", () => {
    expect(anthropicModelId("anthropic/claude-sonnet-5-5")).toBe("claude-sonnet-5-5");
    expect(anthropicModelId("claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(anthropicModelId("gpt-5")).toBeNull();
    expect(anthropicModelId(undefined)).toBeNull();
  });
});

describe("run settings of a study session", () => {
  const env = {
    LLM_MODEL_NAME: "anthropic/claude-sonnet-5-5",
    PROBE_STRATEGY: "committee",
    PROBE_COMMITTEE_SIZE: "4",
  };

  it("record the fallback when there is one, and nothing otherwise", async () => {
    const { parseRunSettings, runSettingsFromEnv } = await import("@/lib/study/types");
    const withKey = runSettingsFromEnv({ ...env, ANTHROPIC_API_KEY: "sk-ant-test" }).run!;
    expect(withKey.fallback).toEqual({ model: "claude-sonnet-5-5", fastModel: "claude-sonnet-5-5" });
    expect(parseRunSettings(JSON.parse(JSON.stringify(withKey)))?.fallback).toEqual(withKey.fallback);

    const withoutKey = runSettingsFromEnv(env).run!;
    expect(withoutKey).not.toHaveProperty("fallback");
    expect(parseRunSettings({ model: "m", questionStrategy: "committee", committeeSize: 4 })).not.toHaveProperty("fallback");
  });
});

describe("run settings: the question order", () => {
  const env = { LLM_MODEL_NAME: "m", PROBE_STRATEGY: "committee", PROBE_COMMITTEE_SIZE: "4" };

  it("records omissions-first when it is set, nothing otherwise, and says so in the exports", async () => {
    const { parseRunSettings, runSettingsFromEnv } = await import("@/lib/study/types");
    const { withRunColumns } = await import("@/lib/study/coding");
    const run = runSettingsFromEnv({ ...env, PROBE_ORDER: "omissions" }).run!;
    expect(run.questionOrder).toBe("omissions");
    expect(parseRunSettings(JSON.parse(JSON.stringify(run)))?.questionOrder).toBe("omissions");
    expect(runSettingsFromEnv(env).run).not.toHaveProperty("questionOrder");
    expect(runSettingsFromEnv({ ...env, PROBE_ORDER: "random" }).run).not.toHaveProperty("questionOrder");
    expect(withRunColumns("a\n1\n", run).trim().split("\n")[1]).toBe("1,m,committee+omissions-first,4");
  });
});
