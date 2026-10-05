import { headers } from "next/headers";

/**
 * Minimal abuse protection for server actions that call the LLM.
 *
 * The prototype has no auth, so every server action is reachable by anyone
 * who can load the app — effectively an open proxy to the LiteLLM key.
 * This adds (1) hard size caps on free-text inputs and (2) a per-client
 * sliding-window rate limit. The limiter is in-memory, i.e. per server
 * instance — good enough for a single study deployment, not a substitute
 * for real auth.
 */

export class LlmGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmGuardError";
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
 * Sliding-window rate limit per client IP and bucket. Disabled when
 * `LLM_RATE_LIMIT_PER_MIN=0`.
 */
export async function checkRateLimit(bucket = "llm"): Promise<void> {
  if (process.env.LLM_RATE_LIMIT_PER_MIN === "0") return;
  const key = `${bucket}:${await clientKey()}`;
  const now = Date.now();
  const recent = (calls.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_CALLS_PER_WINDOW) {
    throw new LlmGuardError("Too many AI requests — please wait a moment.");
  }
  recent.push(now);
  calls.set(key, recent);
}
