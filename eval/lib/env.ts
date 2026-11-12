/**
 * The environment an experiment may run in, checked before anything runs:
 * the model through the direct Anthropic route with the evaluation's own
 * key, and a local, isolated database — never the developer's stack on the
 * default ports, never a hosted one.
 */

const DEFAULT_PORTS = /:(54321|54322)\b/;
const LOOPBACK = /^(https?|postgres(ql)?):\/\/([^@/]*@)?(127\.0\.0\.1|localhost)[:/]/;

export class UnsafeEnvironmentError extends Error {
  constructor(problems: string[]) {
    super(`The evaluation refuses to run:\n- ${problems.join("\n- ")}`);
    this.name = "UnsafeEnvironmentError";
  }
}

/** Throws unless the model route and the database are the evaluation's own. */
export function assertEvalEnvironment(opts: { model: boolean; database: boolean }): void {
  const env = process.env;
  const problems: string[] = [];

  if (opts.model) {
    if (env.LLM_PROVIDER !== "anthropic") problems.push("LLM_PROVIDER must be 'anthropic' (eval/.env.eval)");
    if (!env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is not set (eval/.env.eval)");
    if (!env.LLM_MODEL_NAME) problems.push("LLM_MODEL_NAME is not set");
    if ((env.LLM_FAST_MODEL_NAME || env.LLM_MODEL_NAME) !== env.LLM_MODEL_NAME) {
      problems.push("LLM_FAST_MODEL_NAME must equal LLM_MODEL_NAME (one model, as in the pilot)");
    }
    if (env.USE_FIXTURES || env.RECORD_FIXTURES) problems.push("USE_FIXTURES / RECORD_FIXTURES must be unset");
  }

  if (opts.database) {
    for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "E2E_DB_URL"] as const) {
      const value = env[key] ?? "";
      if (!value) problems.push(`${key} is not set (eval/stacks.sh current env)`);
      else if (!LOOPBACK.test(value)) problems.push(`${key} is not a local database`);
      else if (DEFAULT_PORTS.test(value)) problems.push(`${key} uses a default port (54321/54322): not the evaluation's stack`);
    }
  }

  if (problems.length) throw new UnsafeEnvironmentError(problems);
}
