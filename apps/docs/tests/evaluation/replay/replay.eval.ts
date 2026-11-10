/**
 * The replay itself, as a vitest file — not a unit test. It runs under
 * vitest because the actions are server modules: the `@/` alias, the
 * `next/*` imports and the two stubs below need a module graph that can be
 * intercepted. Start it with `pnpm eval:replay` (`run-replay.ts`), which
 * loads `.env.local` and passes the options as REPLAY_* variables.
 *
 * Stubbed, and only these:
 * - `@/lib/auth`: `guardLlmRequest` resolves the caller from the request's
 *   Supabase session, which a script doesn't have. The replay runs as an
 *   admin; size caps still apply, the rate limit is off.
 * - `@/lib/telemetry`: replays don't write traces into the app's Langfuse
 *   project (they would be counted as participant usage).
 * `generateText` is the real one, wrapped to log latency and token usage.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  const admin = { userId: "replay", kind: "admin" as const };
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
  const { recordCall, usageCounts } = await import("./call-log");
  const generateText = async (args: Parameters<typeof actual.generateText>[0]) => {
    const functionId = args.experimental_telemetry?.functionId ?? "unknown";
    const started = Date.now();
    try {
      const result = await actual.generateText(args);
      let output: unknown;
      try {
        output = result.output;
      } catch {
        output = undefined; // no structured output — the action reports it
      }
      recordCall({ functionId, ms: Date.now() - started, ...usageCounts(result.usage), output });
      return result;
    } catch (error) {
      recordCall({
        functionId,
        ms: Date.now() - started,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        error: error instanceof Error ? error.message.slice(0, 200) : String(error),
      });
      throw error;
    }
  };
  return { ...actual, generateText };
});

import { readCases, type GenerateProbesCase, type ReplayCase } from "./cases";
import { executeCase, recordedPreviewMeasures, type CaseResult } from "./execute";
import {
  renderMarkdown,
  renderProblems,
  summarize,
  type RunFile,
  type RunMeta,
} from "./summary";

const env = process.env;
const DATASET = env.REPLAY_CASES || path.join(__dirname, "cases");
const LIMIT = Number(env.REPLAY_LIMIT) || Infinity;
const CONCURRENCY = Math.max(1, Number(env.REPLAY_CONCURRENCY) || 3);
const OPS = env.REPLAY_OPS?.split(",").map((s) => s.trim()).filter(Boolean);
const OFFLINE = env.REPLAY_OFFLINE === "1";
const OUT_DIR = env.REPLAY_OUT || path.join(__dirname, "..", "results");
const COMPARE = env.REPLAY_COMPARE;

/** Relative to the working directory when inside it, absolute otherwise. */
function shown(target: string): string {
  const relative = path.relative(process.cwd(), target);
  return relative.startsWith("..") ? target : relative;
}

async function pool<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]);
        const r = results[index] as unknown as CaseResult;
        console.log(
          `  ${r.ok ? "ok  " : "FAIL"} ${r.id}${r.variant ? ` [${r.variant}]` : ""} ${(r.ms / 1000).toFixed(1)}s${r.error ? ` — ${r.error}` : ""}`,
        );
      }
    }),
  );
  return results;
}

function revision(): string | undefined {
  try {
    const head = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return undefined;
  }
}

function offlineResult(c: ReplayCase): CaseResult | null {
  if (c.op !== "preview-probe-options" || !c.recorded) return null;
  const { metrics, details } = recordedPreviewMeasures(c);
  return { id: c.id, op: c.op, source: c.source, ok: true, ms: 0, calls: [], metrics, details };
}

it("replays the recorded cases", async () => {
  let cases = readCases(DATASET);
  if (OPS?.length) cases = cases.filter((c) => OPS.includes(c.op));
  cases = cases.slice(0, LIMIT);
  expect(cases.length, `no cases in ${DATASET}`).toBeGreaterThan(0);

  if (!OFFLINE && (!env.LLM_HOST || !env.LLM_API_KEY)) {
    throw new Error("LLM_HOST / LLM_API_KEY are not set — run through `pnpm eval:replay`, or pass --offline");
  }

  const startedAt = new Date().toISOString();
  console.log(
    `Replaying ${cases.length} case(s) from ${shown(DATASET)}${OFFLINE ? " (offline)" : `, ${CONCURRENCY} at a time, model ${env.LLM_MODEL_NAME || "default"}`}`,
  );

  let results: CaseResult[];
  if (OFFLINE) {
    results = cases.map(offlineResult).filter((r): r is CaseResult => !!r);
  } else {
    const generate = cases.filter((c): c is GenerateProbesCase => c.op === "generate-probes");
    const others = cases.filter((c) => c.op !== "generate-probes");
    results = await pool(others, CONCURRENCY, (c) => executeCase(c));
    // The strategy is a process-wide setting the action reads while it runs,
    // so the two strategies never run at the same time
    const before = env.PROBE_STRATEGY;
    for (const strategy of ["committee", "prompted"] as const) {
      const batch = generate.filter((c) => (c.input.strategies ?? ["committee", "prompted"]).includes(strategy));
      // A committee case makes several calls at once already
      const size = strategy === "committee" ? Math.max(1, Math.floor(CONCURRENCY / 2)) : CONCURRENCY;
      results.push(...(await pool(batch, size, (c) => executeCase(c, strategy))));
    }
    if (before === undefined) delete env.PROBE_STRATEGY;
    else env.PROBE_STRATEGY = before;
  }

  const meta: RunMeta = {
    startedAt,
    model: env.LLM_MODEL_NAME || "default",
    fastModel: env.LLM_FAST_MODEL_NAME || env.LLM_MODEL_NAME || "default",
    dataset: shown(DATASET),
    cases: cases.length,
    offline: OFFLINE,
    revision: revision(),
  };
  const run: RunFile = { ...summarize(meta, results), results };

  // Compare with the given run, or with the last run of this dataset
  const latestPath = path.join(OUT_DIR, "replay-latest.json");
  const comparePath = COMPARE || (fs.existsSync(latestPath) ? latestPath : null);
  let previous: RunFile | null = null;
  if (comparePath) {
    try {
      previous = JSON.parse(fs.readFileSync(comparePath, "utf8")) as RunFile;
    } catch (error) {
      console.warn(`Couldn't read ${comparePath} for comparison:`, error);
    }
  }

  const stamp = startedAt.replace(/[:.]/g, "-").slice(0, 19);
  const runDir = path.join(OUT_DIR, `replay-${stamp}`);
  fs.mkdirSync(runDir, { recursive: true });
  const markdown = `${renderMarkdown(run, previous)}\n${renderProblems(results)}`;
  fs.writeFileSync(path.join(runDir, "results.json"), JSON.stringify(run, null, 2));
  fs.writeFileSync(path.join(runDir, "summary.md"), markdown);
  fs.writeFileSync(latestPath, JSON.stringify(run, null, 2));

  console.log(`\n${markdown}`);
  console.log(`Results: ${shown(runDir)}/{results.json,summary.md}`);

  // The run fails only when it couldn't measure anything
  expect(results.some((r) => r.ok), "every case failed").toBe(true);
});
