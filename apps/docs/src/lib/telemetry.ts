import { propagateAttributes } from "@langfuse/tracing";
import { cookies } from "next/headers";
import { after } from "next/server";

const ANON_USER_COOKIE = "lf_anon_uid";

/**
 * Whether LLM prompts and completions are attached to traces.
 *
 * Prompts carry respondent data (on FHIR forms possibly PHI), so production
 * defaults to metadata-only traces. Dev/eval keep full traces because the
 * researchers rely on them. `TELEMETRY_RECORD_IO=true|false` overrides.
 */
function shouldRecordIO(): boolean {
  const flag = process.env.TELEMETRY_RECORD_IO?.trim().toLowerCase();
  if (flag === "true") return true;
  if (flag === "false") return false;
  return process.env.NODE_ENV !== "production";
}

/**
 * `experimental_telemetry` settings for an AI SDK call.
 *
 * ```ts
 * generateText({ model, prompt, experimental_telemetry: telemetry("schema-action") })
 * ```
 */
export function telemetry(functionId: string): {
  isEnabled: true;
  functionId: string;
  recordInputs: boolean;
  recordOutputs: boolean;
} {
  const recordIO = shouldRecordIO();
  return {
    isEnabled: true,
    functionId,
    recordInputs: recordIO,
    recordOutputs: recordIO,
  };
}

/**
 * Reads or creates an anonymous user ID from cookies.
 * Persists for 1 year so Langfuse can track returning users.
 */
export async function getAnonymousUserId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(ANON_USER_COOKIE)?.value;
  if (existing) return existing;

  const newId = `anon_${crypto.randomUUID()}`;
  cookieStore.set(ANON_USER_COOKIE, newId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });
  return newId;
}

/** Set by src/instrumentation.ts (shared via globalThis — see there). */
type FlushableProcessor = { forceFlush(): Promise<void> };
const PROCESSOR_KEY = "__langfuseSpanProcessor";

/**
 * On serverless platforms the instance may be frozen right after the
 * response, before the batching span processor exports. Schedule a flush
 * that runs after the response is sent.
 */
function flushAfterResponse(): void {
  const isServerless =
    !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!isServerless) return;
  const processor = (globalThis as Record<string, unknown>)[PROCESSOR_KEY] as
    | FlushableProcessor
    | undefined;
  if (!processor) return;
  try {
    after(() => processor.forceFlush().catch(() => {}));
  } catch {
    // Outside a request scope (scripts, tests) — nothing to schedule.
  }
}

/**
 * Wraps an async function with Langfuse trace attributes (userId, sessionId, tags).
 *
 * Usage in server actions:
 * ```ts
 * const result = await withTracing({ sessionId: portfolioId, tags: ["elicitation"] }, async () => {
 *   return generateObject({ ... });
 * });
 * ```
 */
export async function withTracing<T>(
  opts: {
    sessionId?: string;
    tags?: string[];
    metadata?: Record<string, string>;
  },
  fn: () => Promise<T>,
): Promise<T> {
  const userId = await getAnonymousUserId();

  try {
    return await propagateAttributes(
      {
        userId,
        sessionId: opts.sessionId,
        tags: opts.tags,
        metadata: opts.metadata,
      },
      fn,
    );
  } finally {
    flushAfterResponse();
  }
}
