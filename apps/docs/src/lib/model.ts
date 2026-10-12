import { createOpenAI } from "@ai-sdk/openai";
import {
  APICallError,
  RetryError,
  wrapLanguageModel,
  type LanguageModel,
} from "ai";
import { resolveTemperature } from "./llm-temperature";

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
function chatModel(modelId: string): LanguageModel {
  return wrapLanguageModel({
    model: llm.chat(modelId),
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        temperature: resolveTemperature(modelId, params.temperature),
      }),
    },
  });
}

// `||` (not `??`) so an empty/blank env var falls back instead of passing "".
export const model = chatModel(process.env.LLM_MODEL_NAME || "default");

/**
 * Model for cheap classification-style calls (conflict detection, intent
 * sync after a field edit). Defaults to the main model, so behaviour only
 * changes when `LLM_FAST_MODEL_NAME` is set.
 */
export const fastModel = chatModel(
  process.env.LLM_FAST_MODEL_NAME || process.env.LLM_MODEL_NAME || "default",
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
