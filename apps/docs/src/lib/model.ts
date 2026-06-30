import { createOpenAI } from "@ai-sdk/openai";

/**
 * OpenAI-compatible provider configured for self-hosted LiteLLM.
 *
 * The `anthropic-beta` header enables prompt caching for Anthropic models,
 * reducing input token costs and latency for repeated system prompt prefixes.
 * LiteLLM forwards this header when routing to Anthropic.
 */
const llm = createOpenAI({
  baseURL: process.env.LLM_HOST,
  apiKey: process.env.LLM_API_KEY,
  headers: {
    Accept: "application/json, text/event-stream",
    "anthropic-beta": "prompt-caching-2024-07-31",
  },
});

export const model = llm(process.env.LLM_MODEL_NAME ?? "default");

/**
 * Whisper transcription model, routed through the same LiteLLM provider
 * (OpenAI-compatible `/audio/transcriptions`). Self-hosted, so audio never
 * leaves the deployment — no cloud ASR dependency.
 */
export const whisperModel = llm.transcription(
  process.env.WHISPER_MODEL_NAME ?? "cavi/faster-whisper-large-v3",
);
