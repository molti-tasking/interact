/**
 * Falling back from the LLM gateway (LiteLLM) to Anthropic's Messages API
 * when the gateway turns a call away: its rate limit, the key's budget, or
 * the gateway or its upstream being down or overloaded. The same call (same
 * prompt, same structured output) goes to Anthropic directly instead.
 *
 * Environment (e.g. Coolify):
 *   ANTHROPIC_API_KEY             the key; setting it turns the fallback on
 *   LLM_FALLBACK_MODEL_NAME       the model on Anthropic's API; default:
 *                                 LLM_MODEL_NAME without a leading
 *                                 "anthropic/", if that is a Claude model id
 *                                 ("anthropic/claude-sonnet-5-5" →
 *                                 "claude-sonnet-5-5")
 *   LLM_FALLBACK_FAST_MODEL_NAME  the same for LLM_FAST_MODEL_NAME; default:
 *                                 derived like the above, else the fallback
 *                                 model
 *   LLM_FALLBACK=off              switch it off
 *
 * Not with LLM_PROVIDER=anthropic: every call already goes to Anthropic.
 *
 * Pure (no AI SDK imports): `model.ts` wires it, and a study session records
 * it with the model it runs with (`runSettingsFromEnv`).
 */

export interface LlmFallback {
  /** Anthropic model id for the main model */
  model: string;
  /** Anthropic model id for background checks (`fastModel`) */
  fastModel: string;
}

/**
 * The Anthropic API's id for a gateway model name, or null when the name
 * isn't a Claude model id: "anthropic/claude-sonnet-5-5" → "claude-sonnet-5-5".
 */
export function anthropicModelId(name: string | undefined): string | null {
  const id = name?.trim().replace(/^anthropic\//i, "") ?? "";
  return /^claude-[a-z0-9.-]+$/i.test(id) ? id : null;
}

export function llmFallbackFromEnv(
  env: Record<string, string | undefined>,
): { fallback: LlmFallback | null; problem: string | null } {
  const off = { fallback: null, problem: null };
  if (env.LLM_PROVIDER?.trim().toLowerCase() === "anthropic") return off;
  if (env.LLM_FALLBACK?.trim().toLowerCase() === "off") return off;
  if (!env.ANTHROPIC_API_KEY?.trim()) return off;

  const model =
    env.LLM_FALLBACK_MODEL_NAME?.trim() || anthropicModelId(env.LLM_MODEL_NAME);
  if (!model) {
    return {
      fallback: null,
      problem: `ANTHROPIC_API_KEY is set, but "${env.LLM_MODEL_NAME ?? ""}" is not a Claude model id: set LLM_FALLBACK_MODEL_NAME to the model to use on Anthropic's API (e.g. claude-sonnet-5-5). The fallback is off until then.`,
    };
  }
  const fastModel =
    env.LLM_FALLBACK_FAST_MODEL_NAME?.trim() ||
    (env.LLM_FAST_MODEL_NAME?.trim() ? anthropicModelId(env.LLM_FAST_MODEL_NAME) : null) ||
    model;
  return { fallback: { model, fastModel }, problem: null };
}
