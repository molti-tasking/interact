import { propagateAttributes } from "@langfuse/tracing";
import { cookies } from "next/headers";

const ANON_USER_COOKIE = "lf_anon_uid";

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

  return propagateAttributes(
    {
      userId,
      sessionId: opts.sessionId,
      tags: opts.tags,
      metadata: opts.metadata,
    },
    fn,
  );
}