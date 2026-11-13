import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  RetryError,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import { llmFallbackFromEnv } from "./llm-fallback";
import { resolveTemperature } from "./llm-temperature";

type ChatModel = ReturnType<typeof wrapLanguageModel>;

/**
 * OpenAI-compatible provider configured for self-hosted LiteLLM.
 *
 * No prompt-caching header is sent: Anthropic only caches up to explicit
 * `cache_control` breakpoints, which the OpenAI-compatible chat format
 * doesn't carry. Actions keep their static instructions in `system` so the
 * prefix is stable — if caching is wanted, configure it on the LiteLLM side
 * (e.g. `cache_control_injection_points` targeting the system message).
 */
const llm = createOpenAI({
  baseURL: process.env.LLM_HOST,
  apiKey: process.env.LLM_API_KEY,
  headers: {
    Accept: "application/json, text/event-stream",
  },
});

/**
 * Chat model with the temperature policy applied: actions pass their
 * preferred temperature, and it's dropped for models that only accept the
 * default (see `llm-temperature.ts`, override with `LLM_TEMPERATURE`).
 *
 * Uses the Chat Completions endpoint (`llm.chat`), not the provider default
 * (OpenAI's Responses API). LiteLLM's Responses emulation is incomplete for
 * non-OpenAI models — e.g. Claude's thinking comes back as a `reasoning`
 * item without the required `summary`, which the SDK rejects as "Invalid
 * JSON response". Chat Completions is LiteLLM's canonical, provider-neutral
 * interface.
 */
function chatModel(modelId: string, fallbackId?: string): LanguageModel {
  if (LLM_PROVIDER === "anthropic") return anthropicChatModel(modelId);
  const gateway = gatewayChatModel(modelId);
  return fallbackId
    ? withAnthropicFallback(gateway, anthropicChatModel(fallbackId), { label: fallbackId })
    : gateway;
}

/** A chat model on the gateway. `provider` is for tests. */
export function gatewayChatModel(
  modelId: string,
  provider: ReturnType<typeof createOpenAI> = llm,
): ChatModel {
  return wrapLanguageModel({
    model: provider.chat(modelId),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        temperature: resolveTemperature(modelId, params.temperature),
      }),
    },
  });
}

/**
 * Which API the chat models call:
 * - unset (default): the OpenAI-compatible gateway above (LiteLLM) — the
 *   deployed app;
 * - `anthropic`: Anthropic's Messages API directly, with `ANTHROPIC_API_KEY`
 *   — used by the evaluation harness (eval/PLAN.md), whose budget can't run
 *   through the capped gateway keys.
 */
const LLM_PROVIDER = process.env.LLM_PROVIDER?.trim().toLowerCase();

/**
 * Output cap for calls that set none. `@ai-sdk/anthropic` 3.0.x doesn't know
 * the Claude 5 models and would send 4096, which thinking (on by default on
 * Claude 5) also counts against.
 */
export const ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS = 16_000;

/**
 * A chat model on Anthropic's Messages API, with the same temperature
 * policy as the gateway route. Structured outputs use the API's native
 * `output_config.format` — as the gateway did — not the provider's "json
 * tool" fallback, which it picks for models it doesn't know.
 * `fetch` is for tests.
 */
export function anthropicChatModel(
  modelId: string,
  opts: { apiKey?: string; fetch?: typeof globalThis.fetch } = {},
): ChatModel {
  const anthropic = createAnthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
  });
  return wrapLanguageModel({
    model: anthropic(modelId),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        temperature: resolveTemperature(modelId, params.temperature),
        maxOutputTokens: params.maxOutputTokens ?? ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
        providerOptions: {
          ...params.providerOptions,
          anthropic: {
            structuredOutputMode: "outputFormat",
            ...params.providerOptions?.anthropic,
          },
        },
      }),
    },
  });
}

// ---------------------------------------------------------------------------
// Fallback: the gateway first, Anthropic's API when the gateway turns a call
// away (see `llm-fallback.ts` for the environment)
// ---------------------------------------------------------------------------

/**
 * Gateway failures after which the same call goes to Anthropic: rate limit
 * (429), the key's budget, an overloaded or failing upstream (5xx, 529), or
 * the gateway not answering at all. Not our own timeout or a cancelled
 * request: the fallback would inherit the same expired signal.
 */
export function shouldFallBack(error: unknown): boolean {
  if (RetryError.isInstance(error)) return shouldFallBack(error.lastError);
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    if (status === 429 || (status !== undefined && status >= 500)) return true;
    return /ExceededBudget|budget.*exceeded|over budget|rate.?limit/i.test(
      `${error.message} ${error.responseBody ?? ""}`,
    );
  }
  if (typeof error !== "object" || error === null) return false;
  const { name } = error as { name?: unknown };
  if (name === "AbortError" || name === "TimeoutError") return false;
  return isTransientLlmError(error);
}

/** When a fallback starts, later calls skip the gateway for this long. */
const FALLBACK_COOLDOWN_MS = 60_000;

/** Shared by every model on the same gateway key */
const gatewayState = { restingUntil: 0 };

/**
 * `primary` (the gateway) with `fallback` (Anthropic's API) behind it. A
 * call the gateway turns away is sent again, unchanged, to the fallback;
 * after that the gateway rests for `cooldownMs` and calls go straight to
 * the fallback. Failures of the fallback itself are thrown as they are.
 */
export function withAnthropicFallback(
  primary: ChatModel,
  fallback: ChatModel,
  {
    label,
    cooldownMs = FALLBACK_COOLDOWN_MS,
    state = gatewayState,
    now = Date.now,
  }: {
    label: string;
    cooldownMs?: number;
    state?: { restingUntil: number };
    now?: () => number;
  },
): ChatModel {
  const rest = (error: unknown) => {
    const resting = now() < state.restingUntil;
    state.restingUntil = now() + cooldownMs;
    if (resting) return;
    const status = APICallError.isInstance(error) ? error.statusCode : undefined;
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[LLM FALLBACK] The gateway turned a call away (${status ?? "no answer"}: ${message.slice(0, 160)}). ` +
        `Using Anthropic's API (${label}) for the next ${Math.round(cooldownMs / 1000)} s.`,
    );
  };
  return wrapLanguageModel({
    model: primary,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate, params }) => {
        if (now() < state.restingUntil) return fallback.doGenerate(params);
        try {
          return await doGenerate();
        } catch (error) {
          if (!shouldFallBack(error) || params.abortSignal?.aborted) throw error;
          rest(error);
          return fallback.doGenerate(params);
        }
      },
      wrapStream: async ({ doStream, params }) => {
        if (now() < state.restingUntil) return fallback.doStream(params);
        try {
          return await doStream();
        } catch (error) {
          if (!shouldFallBack(error) || params.abortSignal?.aborted) throw error;
          rest(error);
          return fallback.doStream(params);
        }
      },
    },
  });
}

const { fallback: FALLBACK, problem: FALLBACK_PROBLEM } = llmFallbackFromEnv(process.env);
if (FALLBACK_PROBLEM) console.warn(`[LLM FALLBACK] ${FALLBACK_PROBLEM}`);

// `||` (not `??`) so an empty/blank env var falls back instead of passing "".
export const model = chatModel(process.env.LLM_MODEL_NAME || "default", FALLBACK?.model);

/**
 * Model for cheap classification-style calls (conflict detection, intent
 * sync after a field edit). Defaults to the main model, so behaviour only
 * changes when `LLM_FAST_MODEL_NAME` is set.
 */
export const fastModel = chatModel(
  process.env.LLM_FAST_MODEL_NAME || process.env.LLM_MODEL_NAME || "default",
  FALLBACK?.fastModel,
);

/**
 * Whisper transcription model, routed through the same LiteLLM provider
 * (OpenAI-compatible `/audio/transcriptions`). Record mode uploads audio to
 * this self-hosted endpoint only. Note that live mode does NOT use it: it
 * relies on the browser's Web Speech API, which streams audio to the browser
 * vendor's cloud recognizer (e.g. Google for Chrome, Apple for Safari).
 */
export const whisperModel = llm.transcription(
  // `||` so an empty/missing env var falls back to a working default rather
  // than passing "" to the transcription endpoint (which fails silently).
  process.env.WHISPER_MODEL_NAME || "cavi/faster-whisper-large-v3",
);

// ---------------------------------------------------------------------------
// Timeout + single retry for slow generation calls
// ---------------------------------------------------------------------------

const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EPIPE",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
]);

/**
 * Errors worth another attempt: our own timeout, network failures, and
 * 408/409/429/5xx responses. Schema-validation failures, 4xx and guard
 * errors are not — retrying would just repeat them.
 */
export function isTransientLlmError(error: unknown): boolean {
  if (RetryError.isInstance(error)) return isTransientLlmError(error.lastError);
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    return (
      error.isRetryable ||
      status === 408 ||
      status === 429 ||
      (status !== undefined && status >= 500)
    );
  }
  // Duck-typed: abort/timeout errors are DOMExceptions, which aren't
  // `instanceof Error` in every runtime.
  if (typeof error !== "object" || error === null) return false;
  const { name, message, code, cause } = error as {
    name?: unknown;
    message?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  if (name === "AbortError" || name === "TimeoutError") return true;
  const networkCode = code ?? cause?.code;
  if (typeof networkCode === "string" && TRANSIENT_NETWORK_CODES.has(networkCode)) {
    return true;
  }
  return message === "fetch failed";
}

/**
 * Run an LLM call with a hard timeout, retrying once on a transient error.
 * Pass the signal as `abortSignal` and set `maxRetries: 0` on the AI SDK
 * call so the SDK's own retries (default 2) don't stack on top of this —
 * worst case is two attempts of `timeoutMs` each.
 */
export async function withLlmRetry<T>(
  label: string,
  call: (abortSignal: AbortSignal) => Promise<T>,
  { timeoutMs = 45_000 }: { timeoutMs?: number } = {},
): Promise<T> {
  try {
    return await call(AbortSignal.timeout(timeoutMs));
  } catch (error) {
    if (!isTransientLlmError(error)) throw error;
    console.warn(
      `[${label}] Transient failure (${error instanceof Error ? error.message : error}), retrying once...`,
    );
    const rateLimited =
      APICallError.isInstance(error) && error.statusCode === 429;
    await new Promise((resolve) => setTimeout(resolve, rateLimited ? 2_000 : 500));
    return call(AbortSignal.timeout(timeoutMs));
  }
}

// ---------------------------------------------------------------------------
// Error messages for the person using the app
// ---------------------------------------------------------------------------

/**
 * What to show for a failed LLM call. The gateway's own messages are long
 * and technical — e.g. in the pilot the per-key spending cap ran out mid
 * session and 50 calls failed with "ExceededBudget: User=… over budget",
 * shown to participants as is. Budget and rate-limit failures get a plain
 * sentence (and a loud server log, so the operator notices); anything else
 * keeps its message.
 */
export function llmErrorMessage(error: unknown): string {
  // After the SDK's own retries, the cause is the last attempt's error
  if (RetryError.isInstance(error) && error.lastError) {
    return llmErrorMessage(error.lastError);
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const status = APICallError.isInstance(error) ? error.statusCode : undefined;
  if (/ExceededBudget|budget.*exceeded|over budget/i.test(message)) {
    console.error(
      "[LLM BUDGET] The LLM gateway key is over its budget — raise it now:",
      message.slice(0, 200),
    );
    return "The AI service has reached its usage limit. Please tell the study team; your work so far is saved.";
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return "The AI service is busy right now. Please try again in a moment.";
  }
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return "The AI took too long to answer. Please try again.";
  }
  return message || "Unknown error";
}
