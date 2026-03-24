import { createOpenAI } from "@ai-sdk/openai";

/**
 * OpenAI-compatible provider configured for self-hosted LiteLLM.
 */
const llm = createOpenAI({
  baseURL: process.env.LLM_HOST,
  apiKey: process.env.LLM_API_KEY,
  headers: {
    Accept: "application/json, text/event-stream",
  },
});

export const model = llm(process.env.LLM_MODEL_NAME ?? "default");
