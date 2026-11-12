/**
 * Stubs for running the app's server actions from a script, as in the app's
 * replay evaluation — and only these:
 * - `@/lib/auth`: the actions resolve the caller from a request's Supabase
 *   session, which a script doesn't have; they run as an admin. Size caps
 *   still apply.
 * - `@/lib/telemetry`: no traces into the app's Langfuse project.
 * - `ai`: the real `generateText`, wrapped so every call is recorded in the
 *   ledger (tokens, cost at frozen prices, latency, output).
 */
import { vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const admin = { userId: "eval", kind: "admin" as const };
  return {
    ...actual,
    requireOwner: async () => {},
    requireDesigner: async () => admin,
    getPrincipal: async () => admin,
  };
});

vi.mock("@/lib/telemetry", () => ({
  withTracing: (_opts: unknown, fn: () => unknown) => fn(),
  telemetry: (functionId: string) => ({ isEnabled: false, functionId }),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  const { costOf, recordCall, usageTokens } = await import("./ledger");
  const generateText = async (args: Parameters<typeof actual.generateText>[0]) => {
    const functionId = args.experimental_telemetry?.functionId ?? "unknown";
    const model =
      typeof args.model === "string"
        ? args.model
        : ((args.model as { modelId?: string }).modelId ?? "unknown");
    const startedAt = new Date().toISOString();
    const started = Date.now();
    let result: Awaited<ReturnType<typeof actual.generateText>>;
    try {
      result = await actual.generateText(args);
    } catch (error) {
      recordCall({
        functionId,
        model,
        startedAt,
        ms: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        // A failed call may still have been billed; the API doesn't say how
        // much, so it counts as 0 here and the Console total is the check
        costUsd: 0,
        error: error instanceof Error ? error.message.slice(0, 300) : String(error),
      });
      throw error;
    }
    // Outside the call's try: a missing frozen price stops the run, it is
    // not a failed model call
    const tokens = usageTokens(result.usage);
    const servedBy = result.response?.modelId ?? model;
    let output: unknown;
    try {
      output = result.output;
    } catch {
      output = result.text;
    }
    recordCall({
      functionId,
      model: servedBy,
      startedAt,
      ms: Date.now() - started,
      ...tokens,
      costUsd: costOf(servedBy, tokens),
      output,
    });
    return result;
  };
  return { ...actual, generateText };
});
