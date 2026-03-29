#!/usr/bin/env tsx
/**
 * Olsen Evaluation Runner (Multi-Model, Multi-Role, with Baselines)
 *
 * 10 models × 3 roles (neutral, skeptical, comparative) = 30 evaluations
 * + limitation pass for each
 * + baseline comparison (Google Forms, Airtable) using 3 representative models
 *
 * Usage:
 *   pnpm eval:olsen
 *   EVAL_JUDGE_MODEL=openai/gpt-4o pnpm eval:olsen   # single model, all roles
 */

import path from "path";

import { loadEnvConfig } from "@next/env";
loadEnvConfig(path.resolve(__dirname, "../.."), false);

import fs from "fs";
import {
  BASELINES,
  JUDGE_MODELS,
  judgeBaselines,
  judgeOlsenWithModel,
  setLangfuseRunId,
  type BaselineScores,
  type OlsenScores,
} from "./judge-olsen";
import { flushLangfuse } from "./langfuse-eval";
import { JUDGE_ROLES, olsenCriteria, type JudgeRole } from "./olsen-rubric";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.resolve(__dirname, "results");

const modelsToUse: string[] = JUDGE_MODELS;

// Models used for baseline comparison (subset to save cost)
const BASELINE_MODELS = modelsToUse.slice(0, 3);

const roles: JudgeRole[] = JUDGE_ROLES.map((r) => r.id);

// ---------------------------------------------------------------------------
// Run directory
// ---------------------------------------------------------------------------

function createRunDir(): string {
  const now = new Date();
  const stamp = now
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 13)
    .replace("T", "_");
  const dir = path.join(RESULTS_DIR, `olsen-run-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface AggregatedOlsen {
  /** criterionId → mean score across ALL model×role combinations */
  scores: Record<string, number>;
  /** criterionId → role → mean score across models */
  perRole: Record<string, Record<string, number>>;
  /** criterionId → model → mean score across roles */
  perModel: Record<string, Record<string, number>>;
  /** criterionId → "model|role" → score */
  perModelRole: Record<string, Record<string, number>>;
  /** Collected limitations across all models */
  limitations: Record<string, string[]>;
  /** Baseline scores: baselineId → criterionId → mean score */
  baselines: Record<string, Record<string, number>>;
  /** All raw */
  raw: OlsenScores[];
  baselineRaw: BaselineScores[];
  models: string[];
  failures: Record<string, string[]>;
  /** Aggregated performance metrics */
  metrics: {
    totalLatencyMs: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalCalls: number;
    avgLatencyMs: number;
  };
}

function aggregate(
  allRuns: OlsenScores[],
  baselineRuns: BaselineScores[],
): AggregatedOlsen {
  const scores: Record<string, number> = {};
  const perRole: Record<string, Record<string, number>> = {};
  const perModel: Record<string, Record<string, number>> = {};
  const perModelRole: Record<string, Record<string, number>> = {};
  const limitations: Record<string, string[]> = {};
  const failures: Record<string, string[]> = {};

  for (const criterion of olsenCriteria) {
    perRole[criterion.id] = {};
    perModel[criterion.id] = {};
    perModelRole[criterion.id] = {};
    limitations[criterion.id] = [];

    // Per role
    for (const role of roles) {
      const roleScores = allRuns
        .filter((r) => r.role === role)
        .flatMap((r) => r.criteria)
        .filter((c) => c.criterionId === criterion.id && c.score > 0)
        .map((c) => c.score);
      if (roleScores.length > 0) {
        perRole[criterion.id][role] =
          Math.round(
            (roleScores.reduce((a, b) => a + b, 0) / roleScores.length) * 10,
          ) / 10;
      }
    }

    // Per model (mean across roles)
    const modelSet = [...new Set(allRuns.map((r) => r.model))];
    for (const model of modelSet) {
      const modelScores = allRuns
        .filter((r) => r.model === model)
        .flatMap((r) => r.criteria)
        .filter((c) => c.criterionId === criterion.id && c.score > 0)
        .map((c) => c.score);
      if (modelScores.length > 0) {
        perModel[criterion.id][model] =
          Math.round(
            (modelScores.reduce((a, b) => a + b, 0) / modelScores.length) * 10,
          ) / 10;
      }
    }

    // Per model×role
    for (const run of allRuns) {
      const dim = run.criteria.find((c) => c.criterionId === criterion.id);
      if (dim) {
        perModelRole[criterion.id][`${run.model}|${run.role}`] = dim.score;
        if (dim.error) {
          if (!failures[run.model]) failures[run.model] = [];
          failures[run.model].push(
            `${criterion.name} [${run.role}]: ${dim.error}`,
          );
        }
        if (dim.limitations) {
          limitations[criterion.id].push(...dim.limitations);
        }
      }
    }

    // Overall mean
    const allValid = allRuns
      .flatMap((r) => r.criteria)
      .filter((c) => c.criterionId === criterion.id && c.score > 0)
      .map((c) => c.score);
    scores[criterion.id] =
      allValid.length > 0
        ? Math.round(
            (allValid.reduce((a, b) => a + b, 0) / allValid.length) * 10,
          ) / 10
        : -1;

    // Deduplicate limitations
    limitations[criterion.id] = [...new Set(limitations[criterion.id])];
  }

  // Baselines
  const baselines: Record<string, Record<string, number>> = {};
  for (const bl of BASELINES) {
    baselines[bl.id] = {};
    for (const criterion of olsenCriteria) {
      const blScores = baselineRuns
        .filter((r) => r.baselineId === bl.id)
        .flatMap((r) => r.criteria)
        .filter((c) => c.criterionId === criterion.id && c.score > 0)
        .map((c) => c.score);
      baselines[bl.id][criterion.id] =
        blScores.length > 0
          ? Math.round(
              (blScores.reduce((a, b) => a + b, 0) / blScores.length) * 10,
            ) / 10
          : -1;
    }
  }

  // Aggregate metrics from all calls (scoring + limitation passes + baselines)
  const allMetrics = [
    ...allRuns.flatMap((r) =>
      r.criteria.flatMap((c) => [c.metrics, c.limitationMetrics].filter(Boolean)),
    ),
    ...baselineRuns.flatMap((r) => r.criteria.map((c) => c.metrics).filter(Boolean)),
  ];
  const totalLatencyMs = allMetrics.reduce((s, m) => s + (m?.latencyMs ?? 0), 0);
  const totalInputTokens = allMetrics.reduce((s, m) => s + (m?.inputTokens ?? 0), 0);
  const totalOutputTokens = allMetrics.reduce((s, m) => s + (m?.outputTokens ?? 0), 0);
  const totalTokens = allMetrics.reduce((s, m) => s + (m?.totalTokens ?? 0), 0);
  const totalCalls = allMetrics.length;

  return {
    scores,
    perRole,
    perModel,
    perModelRole,
    limitations,
    baselines,
    raw: allRuns,
    baselineRaw: baselineRuns,
    models: [...new Set(allRuns.map((r) => r.model))],
    failures,
    metrics: {
      totalLatencyMs,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      totalCalls,
      avgLatencyMs: totalCalls > 0 ? Math.round(totalLatencyMs / totalCalls) : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// LaTeX table (comparative: Malleable Forms vs baselines, by role)
// ---------------------------------------------------------------------------

function generateLatexTable(results: AggregatedOlsen): string {
  const lines: string[] = [];

  lines.push("\\begin{table}");
  lines.push("  \\caption{Olsen's UI systems evaluation criteria.");
  lines.push(
    `  Malleable Forms scored by ${results.models.length} LLM judges across three roles`,
  );
  lines.push("  (N=neutral, S=skeptical, C=comparative). Baselines scored by");
  lines.push(
    `  ${BASELINE_MODELS.length} judges. Scale: 1--5, higher is better.}`,
  );
  lines.push("  \\label{tab:olsen_results}");
  lines.push("  \\begin{tabular}{l ccc c cc}");
  lines.push("    \\toprule");
  lines.push(
    "    & \\multicolumn{3}{c}{Malleable Forms} & & \\multicolumn{2}{c}{Baselines} \\\\",
  );
  lines.push("    \\cmidrule(lr){2-4} \\cmidrule(lr){6-7}");
  lines.push("    Criterion & N & S & C & Mean & Google F. & Airtable \\\\");
  lines.push("    \\midrule");

  for (const c of olsenCriteria) {
    const n = results.perRole[c.id]?.neutral ?? -1;
    const s = results.perRole[c.id]?.skeptical ?? -1;
    const comp = results.perRole[c.id]?.comparative ?? -1;
    const mean = results.scores[c.id] ?? -1;
    const gf = results.baselines["google-forms"]?.[c.id] ?? -1;
    const at = results.baselines["airtable"]?.[c.id] ?? -1;
    const fmt = (v: number) => (v > 0 ? v.toFixed(1) : "--");

    lines.push(
      `    ${c.name} & ${fmt(n)} & ${fmt(s)} & ${fmt(comp)} & \\textbf{${fmt(mean)}} & ${fmt(gf)} & ${fmt(at)} \\\\`,
    );
  }

  lines.push("    \\bottomrule");
  lines.push("  \\end{tabular}");
  lines.push("\\end{table}");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(results: AggregatedOlsen) {
  console.log("\n  Olsen Evaluation Results\n");
  console.log(
    `  ${"Criterion".padEnd(25)} ${"Neutral".padStart(8)} ${"Skeptic".padStart(8)} ${"Compar.".padStart(8)} ${"Mean".padStart(6)}  ${"GForms".padStart(6)} ${"Airtbl".padStart(6)}`,
  );
  console.log("  " + "-".repeat(75));

  for (const c of olsenCriteria) {
    const n = results.perRole[c.id]?.neutral ?? -1;
    const s = results.perRole[c.id]?.skeptical ?? -1;
    const comp = results.perRole[c.id]?.comparative ?? -1;
    const mean = results.scores[c.id] ?? -1;
    const gf = results.baselines["google-forms"]?.[c.id] ?? -1;
    const at = results.baselines["airtable"]?.[c.id] ?? -1;
    const fmt = (v: number) => (v > 0 ? v.toFixed(1).padStart(5) : "   --");

    console.log(
      `  ${c.name.padEnd(25)} ${fmt(n)}    ${fmt(s)}    ${fmt(comp)}   ${fmt(mean)}   ${fmt(gf)}  ${fmt(at)}`,
    );
  }

  // Limitations
  console.log("\n  Key Limitations Identified:\n");
  for (const c of olsenCriteria) {
    const lims = results.limitations[c.id];
    if (lims.length > 0) {
      console.log(`  ${c.name}:`);
      for (const lim of lims.slice(0, 3)) {
        console.log(`    - ${lim.slice(0, 120)}`);
      }
    }
  }

  if (Object.keys(results.failures).length > 0) {
    console.log("\n  Failures:");
    for (const [model, errors] of Object.entries(results.failures)) {
      console.log(`    ${model}: ${errors.length} error(s)`);
    }
  }

  // Performance metrics
  const m = results.metrics;
  console.log("\n  Performance Metrics:");
  console.log(`    Total LLM calls:    ${m.totalCalls}`);
  console.log(`    Total runtime:      ${(m.totalLatencyMs / 1000).toFixed(1)}s (${(m.totalLatencyMs / 60000).toFixed(1)}min)`);
  console.log(`    Avg latency/call:   ${(m.avgLatencyMs / 1000).toFixed(1)}s`);
  console.log(`    Total input tokens:  ${m.totalInputTokens.toLocaleString()}`);
  console.log(`    Total output tokens: ${m.totalOutputTokens.toLocaleString()}`);
  console.log(`    Total tokens:        ${m.totalTokens.toLocaleString()}`);

  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const runDir = createRunDir();
  const judgeHost =
    process.env.EVAL_JUDGE_HOST ??
    process.env.LLM_HOST ??
    "http://localhost:4000/v1";

  const totalCalls =
    modelsToUse.length * roles.length * olsenCriteria.length + // scoring
    modelsToUse.length * roles.length * olsenCriteria.length + // limitations
    BASELINE_MODELS.length * BASELINES.length * olsenCriteria.length; // baselines

  console.log("  Olsen Evaluation Runner (Multi-Model x Multi-Role)");
  console.log(`   Run dir:     ${path.relative(process.cwd(), runDir)}`);
  console.log(`   Judge host:  ${judgeHost}`);
  console.log(`   Models:      ${modelsToUse.length}`);
  console.log(`   Roles:       ${roles.join(", ")}`);
  console.log(`   Criteria:    ${olsenCriteria.length}`);
  console.log(
    `   Evaluations: ${modelsToUse.length * roles.length} (${modelsToUse.length} models x ${roles.length} roles)`,
  );
  console.log(
    `   Baselines:   ${BASELINES.map((b) => b.name).join(", ")} (${BASELINE_MODELS.length} models each)`,
  );
  console.log(`   Total calls: ~${totalCalls}`);
  console.log();

  // Set Langfuse run ID for trace grouping
  const runId = path.basename(runDir);
  setLangfuseRunId(runId);
  console.log(`   Langfuse ID: ${runId}`);
  console.log();

  const meta = {
    evalType: "olsen" as const,
    startedAt: new Date().toISOString(),
    langfuseRunId: runId,
    judgeHost,
    judgeModels: modelsToUse,
    roles,
    baselineModels: BASELINE_MODELS,
    baselines: BASELINES.map((b) => b.id),
    criteria: olsenCriteria.map((c) => c.id),
  };
  fs.writeFileSync(
    path.join(runDir, "run-meta.json"),
    JSON.stringify(meta, null, 2),
  );

  // ── Phase 1: Main evaluation (models × roles) ──
  const allRuns: OlsenScores[] = [];
  let evalCount = 0;
  const totalEvals = modelsToUse.length * roles.length;

  for (const model of modelsToUse) {
    for (const role of roles) {
      evalCount++;
      console.log(`\n── Evaluation ${evalCount}/${totalEvals} ──`);
      try {
        const scores = await judgeOlsenWithModel(model, role);
        allRuns.push(scores);

        // Intermediate save
        fs.writeFileSync(
          path.join(runDir, "olsen-scores-raw.json"),
          JSON.stringify(allRuns, null, 2),
        );
      } catch (err) {
        console.error(`  FATAL: ${model} [${role}] failed:`, err);
      }
    }
  }

  // ── Phase 2: Baseline comparison ──
  console.log("\n── Baseline Comparisons ──");
  const allBaselines: BaselineScores[] = [];

  for (const model of BASELINE_MODELS) {
    try {
      const results = await judgeBaselines(model);
      allBaselines.push(...results);

      fs.writeFileSync(
        path.join(runDir, "olsen-baselines-raw.json"),
        JSON.stringify(allBaselines, null, 2),
      );
    } catch (err) {
      console.error(`  FATAL: Baseline ${model} failed:`, err);
    }
  }

  if (allRuns.length === 0) {
    console.error("\n  All evaluations failed. No results.");
    process.exit(1);
  }

  // ── Aggregate ──
  const results = aggregate(allRuns, allBaselines);

  // ── Save ──
  fs.writeFileSync(
    path.join(runDir, "olsen-scores-raw.json"),
    JSON.stringify(allRuns, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-scores.json"),
    JSON.stringify(results.scores, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-per-model.json"),
    JSON.stringify(results.perModel, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-per-role.json"),
    JSON.stringify(results.perRole, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-limitations.json"),
    JSON.stringify(results.limitations, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-baselines.json"),
    JSON.stringify(results.baselines, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "olsen-baselines-raw.json"),
    JSON.stringify(allBaselines, null, 2),
  );

  // Save metrics
  fs.writeFileSync(
    path.join(runDir, "olsen-metrics.json"),
    JSON.stringify(results.metrics, null, 2),
  );

  const latex = generateLatexTable(results);
  fs.writeFileSync(path.join(runDir, "olsen-table.tex"), latex);

  const wallClockMs = Date.now() - new Date(meta.startedAt).getTime();
  fs.writeFileSync(
    path.join(runDir, "run-meta.json"),
    JSON.stringify(
      {
        ...meta,
        completedAt: new Date().toISOString(),
        wallClockMs,
        evaluationsCompleted: allRuns.length,
        evaluationsExpected: totalEvals,
        baselinesCompleted: allBaselines.length,
        metrics: results.metrics,
      },
      null,
      2,
    ),
  );

  printSummary(results);

  // Flush Langfuse traces before exiting
  console.log("  Flushing Langfuse traces...");
  await flushLangfuse();

  console.log(`Results saved to ${path.relative(process.cwd(), runDir)}/`);
}

main().catch((err) => {
  console.error("Olsen evaluation failed:", err);
  process.exit(1);
});
