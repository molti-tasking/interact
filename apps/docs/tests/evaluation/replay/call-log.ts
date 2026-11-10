/**
 * Which LLM calls a case made: the replay wraps `generateText` and files
 * every call under the case that is running (AsyncLocalStorage, so cases
 * can run concurrently).
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface CallRecord {
  /** `experimental_telemetry.functionId` of the call, e.g. "design-probe-preview" */
  functionId: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  /** Input tokens read from the provider's prompt cache, when reported */
  cachedInputTokens: number;
  error?: string;
  /** The structured output, for metrics the action's result doesn't carry */
  output?: unknown;
}

const storage = new AsyncLocalStorage<CallRecord[]>();

export function recordCall(call: CallRecord): void {
  storage.getStore()?.push(call);
}

/**
 * Run `fn`, collecting the LLM calls made inside it. `fn` gets the live
 * list, so it can read the calls once its action has returned.
 */
export async function withCallLog<T>(
  fn: (calls: CallRecord[]) => Promise<T>,
): Promise<{ value: T; calls: CallRecord[] }> {
  const calls: CallRecord[] = [];
  const value = await storage.run(calls, () => fn(calls));
  return { value, calls };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Token counts from an AI SDK `usage` object (field names vary by version). */
export function usageCounts(usage: unknown): Pick<
  CallRecord,
  "inputTokens" | "outputTokens" | "cachedInputTokens"
> {
  const u = (usage ?? {}) as Record<string, unknown>;
  const details = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  return {
    inputTokens: num(u.inputTokens),
    outputTokens: num(u.outputTokens),
    cachedInputTokens: num(u.cachedInputTokens) || num(details.cacheReadTokens),
  };
}
