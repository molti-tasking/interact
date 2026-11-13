import { requireDesigner, UnauthorizedError } from "@/lib/auth";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

/**
 * Abuse protection for server actions and routes that call the LLM.
 *
 * Server actions are reachable by anyone who can POST to the app, so every
 * LLM entry point calls `guardLlmRequest()`: (1) only signed-in app admins
 * and workshop participants (see `requireDesigner`), (2) a per-user
 * sliding-window rate limit, plus hard size caps on free-text inputs
 * (`capText`/`capJson`). The limiter is in-memory, i.e. per server
 * instance — fine for a single deployment.
 */

export class LlmGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmGuardError";
  }
}

/** Not signed in as an admin or participant (HTTP 401 in route handlers). */
export class LlmUnauthorizedError extends LlmGuardError {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnauthorizedError";
  }
}

/** Default caps (characters). */
export const LIMITS = {
  shortText: 2_000, // labels, probe text, a single utterance
  prompt: 8_000, // free-form user prompts
  document: 60_000, // serialized intent/schema/row payloads
} as const;

/** Throw when a string input exceeds `max` characters. */
export function capText(
  value: string | null | undefined,
  max: number,
  name: string,
): string {
  const text = value ?? "";
  if (text.length > max) {
    throw new LlmGuardError(
      `${name} is too long (${text.length} > ${max} characters)`,
    );
  }
  return text;
}

/** Throw when the JSON size of `value` exceeds `max` characters. */
export function capJson(value: unknown, max: number, name: string): void {
  const size = JSON.stringify(value ?? null).length;
  if (size > max) {
    throw new LlmGuardError(`${name} is too large (${size} > ${max} bytes)`);
  }
}

const WINDOW_MS = 60_000;
const MAX_CALLS_PER_WINDOW = Number(process.env.LLM_RATE_LIMIT_PER_MIN) || 60;
const calls = new Map<string, number[]>();

async function clientKey(): Promise<string> {
  try {
    const h = await headers();
    return (
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      h.get("x-real-ip") ||
      "local"
    );
  } catch {
    return "local"; // outside a request (scripts, tests)
  }
}

/**
 * Sliding-window rate limit per caller and bucket. Disabled when
 * `LLM_RATE_LIMIT_PER_MIN=0`. `userId` (from the verified session, never
 * from client input) keys the limit per user: a workshop room shares one
 * NAT IP, so a per-IP limit would throttle all participants together.
 * Falls back to the client IP.
 */
export async function checkRateLimit(
  bucket = "llm",
  userId?: string,
): Promise<void> {
  if (process.env.LLM_RATE_LIMIT_PER_MIN === "0") return;
  const key = `${bucket}:${userId ? `user:${userId}` : await clientKey()}`;
  const now = Date.now();
  const recent = (calls.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    throw new LlmGuardError("Too many AI requests — please wait a moment.");
  }
  recent.push(now);
  calls.set(key, recent);
}

/**
 * Call at the top of every LLM entry point (server action / route handler):
 * rejects anyone but an app admin or a workshop participant, then applies
 * the rate limit.
 */
export async function guardLlmRequest(bucket = "llm"): Promise<void> {
  let principal: Awaited<ReturnType<typeof requireDesigner>> | undefined;
  try {
    principal = await requireDesigner();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw new LlmUnauthorizedError(error.message);
    }
    throw error;
  }
  if (principal?.kind === "participant") await requireSessionModel();
  await checkRateLimit(bucket, principal?.userId);
}

/** A participant's calls went to a deployment running another model. */
export class WrongModelError extends Error {
  constructor() {
    super(
      "This study runs on another server. Please open it again from the link you were given.",
    );
    this.name = "WrongModelError";
  }
}

/**
 * Several deployments, one per model, can share the database. A
 * participant's session records the model it was opened with; calls from
 * another deployment's model are refused (migration 018), so one model's
 * forms can't end up in another model's session. Before migration 018, or
 * if the check can't run, nothing is refused.
 */
async function requireSessionModel(): Promise<void> {
  const model = process.env.LLM_MODEL_NAME?.trim();
  if (!model) return;
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("my_study_runs_on", { p_model: model });
  if (error) {
    console.warn("[llm-guard] model check skipped:", error.message);
    return;
  }
  if (data === false) {
    console.error(`[llm-guard] A participant's session runs with another model than ${model}: refused.`);
    throw new WrongModelError();
  }
}
