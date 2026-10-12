import { requireOwner, UnauthorizedError } from "@/lib/auth";
import { headers } from "next/headers";

/**
 * Abuse protection for server actions and routes that call the LLM.
 *
 * Server actions are reachable by anyone who can POST to the app, so every
 * LLM entry point calls `guardLlmRequest()`: (1) only signed-in app admins
 * (see `requireOwner`), (2) a per-client sliding-window rate limit, plus
 * hard size caps on free-text inputs (`capText`/`capJson`). The limiter is
 * in-memory, i.e. per server instance — fine for a single deployment.
 */

export class LlmGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmGuardError";
  }
}

/** Not signed in as an app admin (HTTP 401 in route handlers). */
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

/**
 * Call at the top of every LLM entry point (server action / route handler):
 * rejects anyone but an app admin, then applies the rate limit.
 */
export async function guardLlmRequest(bucket = "llm"): Promise<void> {
  try {
    await requireOwner();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw new LlmUnauthorizedError(error.message);
    }
    throw error;
  }
  await checkRateLimit(bucket);
}
