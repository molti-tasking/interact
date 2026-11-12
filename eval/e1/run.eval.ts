/**
 * E1 runs: each scenario's script, per pipeline, repeated; requests in
 * order, each starting from the state the previous one left.
 *
 *   eval/run.sh e1/run.eval.ts --check [--requests soccer-1,soccer-5]
 *       plumbing only: the named requests (default: the first of each
 *       scenario), one run per pipeline; no measures
 *   eval/run.sh e1/run.eval.ts --dry
 *       every request, one run per pipeline and scenario; projects the cost
 *       of the final runs (stop and ask above $30)
 *   eval/run.sh e1/run.eval.ts --final [--runs 5]
 *       refuses unless every gold spec is reviewed, the material matches
 *       eval/FROZEN.md, and the projected cost is within the approved limit
 *
 * Common: --pipelines P,W,R  --scenarios soccer,sales  --concurrency 3
 *
 * Every run is saved, failed and aborted ones too:
 * eval/e1/runs/<label>/<scenario>/<pipeline>-r<k>.json (states before and
 * after each request, the model calls with their outputs, timings, cost).
 * The measures are computed from these files alone (summarize.eval.ts).
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS } from "@/lib/model";
import type { Portfolio, PortfolioSchema, StructuredIntent } from "@/lib/types";
import { assertEvalEnvironment } from "../lib/env";
import { Budget, onCall, withCalls, type CallRecord } from "../lib/ledger";
import { insertPortfolio, readPortfolio, signInEvalAdmin } from "../lib/db";
import {
  loadBaseSchema,
  loadIntent,
  loadScript,
  materialHash,
  SCENARIOS,
  type ScenarioName,
  type ScriptRequest,
} from "./material";
import {
  CARRIER_QUESTION,
  PIPELINES,
  promptHashes,
  runChange,
  runDerive,
  type PipelineName,
} from "./pipelines";

const EVAL_DIR = path.resolve(__dirname, "..");
const RUNS_DIR = path.join(__dirname, "runs");
const OUT = path.join(EVAL_DIR, "out");
const CAP_USD = 40;
const ASK_ABOVE_USD = 30;
const FINAL_RUNS = 5;
/** Before any run of a scenario × pipeline has been seen */
const FALLBACK_COST_PER_REQUEST = 0.06;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(text: string) {
  const parts = text.split(/\s+/).filter(Boolean);
  const flag = (name: string) => parts.includes(`--${name}`);
  const value = (name: string) => {
    const i = parts.indexOf(`--${name}`);
    return i >= 0 ? parts[i + 1] : undefined;
  };
  const list = (name: string) => value(name)?.split(",").map((s) => s.trim()).filter(Boolean);
  const mode = flag("final") ? "final" : flag("dry") ? "dry" : flag("check") ? "check" : null;
  if (!mode) throw new Error("Choose --check, --dry or --final");
  return {
    mode,
    pipelines: (list("pipelines") ?? PIPELINES) as PipelineName[],
    scenarios: (list("scenarios") ?? [...SCENARIOS]) as ScenarioName[],
    requests: list("requests"),
    runs: Number(value("runs") ?? (mode === "final" ? FINAL_RUNS : 1)),
    concurrency: Number(value("concurrency") ?? 3),
  } as const;
}

// ---------------------------------------------------------------------------
// Trajectories
// ---------------------------------------------------------------------------

interface FormState {
  schema: PortfolioSchema;
  intent: StructuredIntent;
}

export interface RequestRecord {
  id: string;
  kind: ScriptRequest["kind"];
  target: string;
  name?: string;
  request: string;
  before: FormState;
  after: FormState;
  /** derive: the base at that moment, and the new form */
  baseAtDerive?: PortfolioSchema;
  derived?: FormState;
  calls: CallRecord[];
  costUsd: number;
  foregroundMs: number;
  totalMs: number;
  notes: string[];
  error?: string;
}

export interface Trajectory {
  scenario: ScenarioName;
  pipeline: PipelineName;
  rep: number;
  status: "completed" | "failed" | "aborted";
  abortReason?: string;
  startedAt: string;
  finishedAt: string;
  requests: RequestRecord[];
  /** The forms at the end: the base and each derived form by name */
  final: { base?: PortfolioSchema; derived: Record<string, PortfolioSchema> };
}

const stateOf = (p: Portfolio): FormState => ({ schema: p.schema, intent: p.intent });

async function runScript(
  scenario: ScenarioName,
  pipeline: PipelineName,
  rep: number,
  requests: ScriptRequest[],
): Promise<Trajectory> {
  const startedAt = new Date().toISOString();
  const { intent, title } = loadIntent(scenario);
  const base = await insertPortfolio({ title: `E1 ${title} [${pipeline} r${rep}]`, intent, schema: loadBaseSchema(scenario) });
  const ids: Record<string, string> = { base: base.id };
  const records: RequestRecord[] = [];
  let failed = false;

  for (const r of requests) {
    const targetId = ids[r.target];
    if (!targetId) throw new Error(`${r.id}: unknown target "${r.target}"`);
    const before = await readPortfolio(targetId);
    const record: RequestRecord = {
      id: r.id,
      kind: r.kind,
      target: r.target,
      name: r.name,
      request: r.request,
      before: stateOf(before),
      after: stateOf(before),
      calls: [],
      costUsd: 0,
      foregroundMs: 0,
      totalMs: 0,
      notes: [],
    };
    try {
      const { value, calls } = await withCalls(() =>
        r.kind === "derive"
          ? runDerive(pipeline, before, r.request, r.name ?? r.id)
          : runChange(pipeline, before, r.request),
      );
      record.calls = calls;
      record.foregroundMs = value.foregroundMs;
      record.totalMs = value.totalMs;
      record.notes = value.notes;
      if (value.derivedId) {
        ids[r.name ?? r.id] = value.derivedId;
        record.baseAtDerive = before.schema;
        record.derived = stateOf(await readPortfolio(value.derivedId));
      }
      record.after = stateOf(await readPortfolio(targetId));
    } catch (error) {
      failed = true;
      record.error = error instanceof Error ? error.message.slice(0, 500) : String(error);
      record.after = stateOf(await readPortfolio(targetId));
    }
    record.costUsd = record.calls.reduce((s, c) => s + c.costUsd, 0);
    records.push(record);
  }

  const derived: Record<string, PortfolioSchema> = {};
  for (const [name, id] of Object.entries(ids)) {
    if (name !== "base") derived[name] = (await readPortfolio(id)).schema;
  }
  return {
    scenario,
    pipeline,
    rep,
    status: failed ? "failed" : "completed",
    startedAt,
    finishedAt: new Date().toISOString(),
    requests: records,
    final: { base: (await readPortfolio(base.id)).schema, derived },
  };
}

/** Mean cost of earlier complete runs of this scenario × pipeline. */
function estimateCost(scenario: ScenarioName, pipeline: PipelineName, requests: number): number {
  const costs: number[] = [];
  if (fs.existsSync(RUNS_DIR)) {
    for (const label of fs.readdirSync(RUNS_DIR)) {
      const dir = path.join(RUNS_DIR, label, scenario);
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.startsWith(`${pipeline}-`))) {
        const t = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8")) as Trajectory;
        if (t.status !== "aborted" && t.requests.length) {
          costs.push((t.requests.reduce((s, r) => s + r.costUsd, 0) / t.requests.length) * requests);
        }
      }
    }
  }
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : FALLBACK_COST_PER_REQUEST * requests;
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, concurrency) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
}

// ---------------------------------------------------------------------------
// Preconditions of a final run
// ---------------------------------------------------------------------------

function finalBlockers(scenarios: ScenarioName[]): string[] {
  const problems: string[] = [];
  const unreviewed = scenarios.flatMap((s) => loadScript(s).filter((r) => !r.gold.reviewed).map((r) => r.id));
  if (unreviewed.length) problems.push(`gold specs not reviewed: ${unreviewed.join(", ")}`);
  const frozen = path.join(EVAL_DIR, "FROZEN.md");
  const hash = materialHash();
  if (!fs.existsSync(frozen) || !fs.readFileSync(frozen, "utf-8").includes(`e1-material: ${hash}`)) {
    problems.push(`the material (hash ${hash.slice(0, 12)}…) isn't the one recorded in eval/FROZEN.md`);
  }
  const projection = path.join(OUT, "e1-projection.json");
  if (!fs.existsSync(projection)) problems.push("no dry run yet (eval/out/e1-projection.json)");
  else {
    const { projectedUsd } = JSON.parse(fs.readFileSync(projection, "utf-8")) as { projectedUsd: number };
    const approved = Number(process.env.EVAL_COST_APPROVED_USD ?? 0);
    if (projectedUsd > ASK_ABOVE_USD && projectedUsd > approved) {
      problems.push(`projected cost $${projectedUsd.toFixed(2)} is above $${ASK_ABOVE_USD}: ask the authors, then set EVAL_COST_APPROVED_USD`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

it("E1", async () => {
  const args = parseArgs(process.env.EVAL_ARGS ?? "");
  assertEvalEnvironment({ model: true, database: true });
  if (args.mode === "final") {
    const blockers = finalBlockers(args.scenarios);
    if (blockers.length) throw new Error(`--final refused:\n- ${blockers.join("\n- ")}`);
  }

  const budget = new Budget(path.join(OUT, "spend.json"), CAP_USD);
  const stopLedger = onCall((call) => budget.add(call));
  await signInEvalAdmin();

  const label = `${args.mode}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const dir = path.join(RUNS_DIR, label);
  const commit = execSync("git rev-parse HEAD", { cwd: EVAL_DIR }).toString().trim();
  const dirty = execSync("git status --porcelain -- .", { cwd: EVAL_DIR }).toString().trim() !== "";
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    `${JSON.stringify(
      {
        label,
        mode: args.mode,
        args,
        startedAt: new Date().toISOString(),
        gitCommit: commit,
        gitDirtyEval: dirty,
        model: process.env.LLM_MODEL_NAME,
        fastModel: process.env.LLM_FAST_MODEL_NAME,
        route: "anthropic-messages (LLM_PROVIDER=anthropic)",
        settings: {
          temperature: "omitted (Claude 5 accepts only the default)",
          defaultMaxOutputTokens: ANTHROPIC_DEFAULT_MAX_OUTPUT_TOKENS,
          structuredOutput: "output_config.format",
          thinking: "API default (adaptive)",
        },
        carrierQuestion: CARRIER_QUESTION,
        promptHashes: promptHashes(),
        materialHash: materialHash(),
        spentBeforeUsd: budget.spent,
      },
      null,
      2,
    )}\n`,
  );

  const jobs: { scenario: ScenarioName; pipeline: PipelineName; rep: number; requests: ScriptRequest[] }[] = [];
  for (const scenario of args.scenarios) {
    const script = loadScript(scenario);
    const requests =
      args.mode === "check"
        ? script.filter((r) => (args.requests ? args.requests.includes(r.id) : r === script[0]))
        : script;
    if (!requests.length) continue;
    for (const pipeline of args.pipelines) {
      for (let rep = 1; rep <= args.runs; rep++) jobs.push({ scenario, pipeline, rep, requests });
    }
  }

  const summary: { job: string; status: string; costUsd: number; note?: string }[] = [];
  let stopped: string | null = null;
  await pool(jobs, args.concurrency, async (job) => {
    const name = `${job.scenario}/${job.pipeline}-r${job.rep}`;
    const file = path.join(dir, job.scenario, `${job.pipeline}-r${job.rep}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const estimate = estimateCost(job.scenario, job.pipeline, job.requests.length);
    if (stopped || !budget.fits(estimate)) {
      stopped ??= `budget: $${budget.remaining.toFixed(2)} left, next run estimated at $${estimate.toFixed(2)}`;
      const aborted: Trajectory = {
        scenario: job.scenario,
        pipeline: job.pipeline,
        rep: job.rep,
        status: "aborted",
        abortReason: stopped,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        requests: [],
        final: { derived: {} },
      };
      fs.writeFileSync(file, `${JSON.stringify(aborted, null, 2)}\n`);
      summary.push({ job: name, status: "aborted", costUsd: 0, note: stopped });
      return;
    }
    const t = await runScript(job.scenario, job.pipeline, job.rep, job.requests);
    fs.writeFileSync(file, `${JSON.stringify(t, null, 2)}\n`);
    const cost = t.requests.reduce((s, r) => s + r.costUsd, 0);
    const errors = t.requests.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`);
    summary.push({ job: name, status: t.status, costUsd: cost, ...(errors.length ? { note: errors.join(" | ") } : {}) });
  });
  stopLedger();

  const runCost = summary.reduce((s, x) => s + x.costUsd, 0);
  const result: Record<string, unknown> = { label, runCostUsd: runCost, spentTotalUsd: budget.spent, summary };
  if (args.mode === "dry") {
    // The final runs repeat each scenario × pipeline FINAL_RUNS times
    const projectedUsd = runCost * (FINAL_RUNS / args.runs);
    result.projectedUsd = projectedUsd;
    result.askAuthors = projectedUsd > ASK_ABOVE_USD;
    fs.writeFileSync(
      path.join(OUT, "e1-projection.json"),
      `${JSON.stringify({ fromRun: label, dryCostUsd: runCost, finalRuns: FINAL_RUNS, projectedUsd }, null, 2)}\n`,
    );
  }
  fs.writeFileSync(path.join(dir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  process.stderr.write(`\nE1 ${JSON.stringify(result)}\n`);
  expect(stopped === null || args.mode !== "check").toBe(true);
});
