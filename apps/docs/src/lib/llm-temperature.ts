/**
 * Which sampling temperature (if any) to send to a model.
 *
 * Newer reasoning models reject a custom temperature — e.g. Claude Sonnet 5
 * via LiteLLM: "does not support temperature=0.3. Only temperature=1 is
 * supported". For those the parameter is dropped and the model's default
 * applies. Callers keep their preferred value; this decides centrally.
 *
 * `LLM_TEMPERATURE` overrides the detection:
 *   - unset / "auto"  drop for known fixed-temperature models (below)
 *   - "off"           never send a temperature
 *   - a number        send this value for every call
 *
 * Pure (no Next/AI SDK imports) so evaluation scripts can use it too.
 */

/** Model ids (or LiteLLM aliases) that only accept the default temperature. */
const FIXED_TEMPERATURE_MODELS = [
  /claude-(opus|sonnet|haiku)-[5-9]/i,
  /claude-(fable|mythos)/i,
  /(^|[/-])o[134](-|$)/i, // OpenAI o-series reasoning models
  /gpt-5/i,
];

export function supportsCustomTemperature(modelId: string): boolean {
  return !FIXED_TEMPERATURE_MODELS.some((pattern) => pattern.test(modelId));
}

/**
 * The temperature to send for `modelId`, or `undefined` to omit it.
 * `setting` defaults to `process.env.LLM_TEMPERATURE`.
 */
export function resolveTemperature(
  modelId: string,
  requested: number | undefined,
  setting: string | undefined = process.env.LLM_TEMPERATURE,
): number | undefined {
  const mode = setting?.trim().toLowerCase();
  if (mode === "off" || mode === "none") return undefined;
  if (mode && mode !== "auto") {
    const value = Number(mode);
    if (Number.isFinite(value)) return value;
  }
  if (requested === undefined) return undefined;
  return supportsCustomTemperature(modelId) ? requested : undefined;
}
