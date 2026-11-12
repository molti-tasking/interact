/**
 * Every model call of an experiment: what it cost, how long it took, what it
 * returned. `lib/setup.ts` wraps the AI SDK's `generateText` so each call
 * lands here, filed under the step that is running (AsyncLocalStorage, so
 * concurrent steps don't mix).
 *
 * Cost is computed from the call's token counts at the frozen prices in
 * `eval/prices.json` — the Anthropic API has no per-key budget to ask.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

export interface CallRecord {
  /** `experimental_telemetry.functionId`, e.g. "design-probe-preview" */
  functionId: string;
  model: string;
  startedAt: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  error?: string;
  /** The structured output (or text), kept as the fixture of this call */
  output?: unknown;
}

const PRICES_FILE = path.resolve(__dirname, "../prices.json");

type Prices = Record<string, { input: number; output: number; cache_write_5m: number; cache_read: number }>;
let prices: Prices | null = null;

function priceOf(model: string) {
  prices ??= JSON.parse(fs.readFileSync(PRICES_FILE, "utf-8")) as Prices;
  const p = prices[model];
  if (!p) throw new Error(`No frozen price for model "${model}" in eval/prices.json`);
  return p;
}

/** USD for one call's tokens at the frozen prices. */
export function costOf(
  model: string,
  t: Pick<CallRecord, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">,
): number {
  const p = priceOf(model);
  return (
    (t.inputTokens * p.input +
      t.outputTokens * p.output +
      t.cacheReadTokens * p.cache_read +
      t.cacheWriteTokens * p.cache_write_5m) /
    1_000_000
  );
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Token counts from an AI SDK `usage` object. Uncached input only: the
 * provider reports cache reads/writes separately (none are expected).
 */
export function usageTokens(usage: unknown) {
  const u = (usage ?? {}) as Record<string, unknown>;
  const d = (u.inputTokenDetails ?? {}) as Record<string, unknown>;
  const cacheRead = num(d.cacheReadTokens) || num(u.cachedInputTokens);
  const cacheWrite = num(d.cacheWriteTokens);
  const noCache = num(d.noCacheTokens);
  return {
    inputTokens: noCache || Math.max(0, num(u.inputTokens) - cacheRead - cacheWrite),
    outputTokens: num(u.outputTokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
  };
}

const storage = new AsyncLocalStorage<CallRecord[]>();
const listeners = new Set<(call: CallRecord) => void>();

export function recordCall(call: CallRecord): void {
  storage.getStore()?.push(call);
  for (const l of listeners) l(call);
}

/** Run `fn`, collecting the model calls made inside it. */
export async function withCalls<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; calls: CallRecord[] }> {
  const calls: CallRecord[] = [];
  const value = await storage.run(calls, fn);
  return { value, calls };
}

/** Every call from now on, wherever it runs (for the budget). */
export function onCall(listener: (call: CallRecord) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/**
 * The evaluation's spend so far, across all runs, in `eval/out/spend.json`
 * (updated after every call). The cap is the authors' $40; a run starts
 * only if its estimate fits in what is left, and is never cut off midway.
 */
export class Budget {
  private readonly file: string;
  private state: { capUsd: number; spentUsd: number; calls: number };

  constructor(file: string, capUsd: number) {
    this.file = file;
    const saved = fs.existsSync(file)
      ? (JSON.parse(fs.readFileSync(file, "utf-8")) as { spentUsd: number; calls: number })
      : { spentUsd: 0, calls: 0 };
    this.state = { capUsd, spentUsd: saved.spentUsd, calls: saved.calls };
  }

  get spent(): number {
    return this.state.spentUsd;
  }

  get remaining(): number {
    return this.state.capUsd - this.state.spentUsd;
  }

  /** May a run estimated at `estimateUsd` start? */
  fits(estimateUsd: number): boolean {
    return estimateUsd <= this.remaining;
  }

  add(call: CallRecord): void {
    this.state.spentUsd += call.costUsd;
    this.state.calls += 1;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(this.state, null, 2)}\n`);
  }
}
