/**
 * Client side of `/api/llm/<op>`: call an LLM-backed server action through
 * the Route Handler, so calls run in parallel instead of one at a time
 * (Next queues a client's server actions). Same arguments, same result.
 */

import type { LlmOperation, LlmOperations } from "@/app/api/llm/[op]/route";

export async function callLlm<Op extends LlmOperation>(
  op: Op,
  ...args: Parameters<LlmOperations[Op]>
): Promise<Awaited<ReturnType<LlmOperations[Op]>>> {
  const res = await fetch(`/api/llm/${op}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`The AI request failed (${res.status})`);
  }
  // Failures come back as { success: false, error } like the actions';
  // the auth proxy answers { error } only — normalize that
  if (!res.ok && body && typeof body === "object" && !("success" in body)) {
    const error = (body as { error?: unknown }).error;
    body = {
      success: false,
      error:
        res.status === 401
          ? "You're signed out. Reload the page to continue."
          : typeof error === "string"
            ? error
            : `The AI request failed (${res.status})`,
    };
  }
  return body as Awaited<ReturnType<LlmOperations[Op]>>;
}
