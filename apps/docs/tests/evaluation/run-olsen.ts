#!/usr/bin/env tsx
/**
 * Olsen Evaluation Runner
 *
 * Evaluates Malleable Forms against Olsen's UI systems research criteria
 * using multiple LLM models as independent judges.
 *
 * Usage:
 *   pnpm eval:olsen                           # all 10 models
 *   EVAL_JUDGE_MODEL=openai/gpt-4o pnpm eval:olsen  # single model override
 */

import path from "path";

// Load .env before other modules read process.env
import { loadEnvConfig } from "@next/env";
loadEnvConfig(path.resolve(__dirname, "../.."), false);

import fs from "fs";
import {
  JUDGE_MODELS,
  judgeOlsenWithModel,
  type OlsenScores,
} from "./judge-olsen";
import { olsenCriteria } from "./olsen-rubric";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RESULTS_DIR = path.resolve(__dirname, "results");

// If EVAL_JUDGE_MODEL is set, use only that model; otherwise use the full pool
const modelsToUse: string[] = JUDGE_MODELS;

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
  /** criterionId → mean score across all models */
  scores: Record<string, number>;
  /** criterionId → { model → score } for the detail view */
  perModel: Record<string, Record<string, number>>;
  /** All raw runs */
  raw: OlsenScores[];
  /** Models that participated */
  models: string[];
  /** Models that had failures */
  failures: Record<string, string[]>;
}

function aggregate(allRuns: OlsenScores[]): AggregatedOlsen {
  const scores: Record<string, number> = {};
  const perModel: Record<string, Record<string, number>> = {};
  const failures: Record<string, string[]> = {};

  for (const criterion of olsenCriteria) {
    perModel[criterion.id] = {};

    for (const run of allRuns) {
      const dimScore = run.criteria.find((c) => c.criterionId === criterion.id);
      if (dimScore) {
        perModel[criterion.id][run.model] = dimScore.score;
        if (dimScore.error) {
          if (!failures[run.model]) failures[run.model] = [];
          failures[run.model].push(`${criterion.name}: ${dimScore.error}`);
        }
      }
    }

    const validScores = allRuns
      .flatMap((r) => r.criteria)
      .filter((c) => c.criterionId === criterion.id && c.score > 0)
      .map((c) => c.score);

    if (validScores.length === 0) {
      scores[criterion.id] = -1;
    } else {
      const mean = validScores.reduce((a, b) => a + b, 0) / validScores.length;
      scores[criterion.id] = Math.round(mean * 10) / 10;
    }
  }

  return {
    scores,
    perModel,
    raw: allRuns,
    models: allRuns.map((r) => r.model),
    failures,
  };
}

// ---------------------------------------------------------------------------
// LaTeX table (models as columns)
// ---------------------------------------------------------------------------

function generateLatexTable(results: AggregatedOlsen): string {
  const lines: string[] = [];
  const models = results.models;

  // Short model names for table headers
  const shortName = (m: string) => {
    const parts = m.split("/");
    return parts[parts.length - 1]
      .replace(/-preview.*/, "")
      .replace(/-latest/, "");
  };

  lines.push("\\begin{table*}");
  lines.push("  \\caption{Olsen's UI systems evaluation criteria scored by");
  lines.push(
    `  ${models.length} independent LLM judges (scale: 1--5, higher is better).`,
  );
  lines.push("  The Mean column averages across all judges.}");
  lines.push("  \\label{tab:olsen_results}");
  lines.push(`  \\begin{tabular}{l${"c".repeat(models.length)}|c}`);
  lines.push("    \\toprule");
  lines.push(
    `    Criterion & ${models.map(shortName).join(" & ")} & Mean \\\\`,
  );
  lines.push("    \\midrule");

  for (const criterion of olsenCriteria) {
    const modelScores = models.map((m) => {
      const s = results.perModel[criterion.id]?.[m];
      return s && s > 0 ? String(s) : "--";
    });
    const mean = results.scores[criterion.id];
    const meanStr = mean > 0 ? mean.toFixed(1) : "--";
    lines.push(
      `    ${criterion.name} & ${modelScores.join(" & ")} & \\textbf{${meanStr}} \\\\`,
    );
  }

  lines.push("    \\bottomrule");
  lines.push("  \\end{tabular}");
  lines.push("\\end{table*}");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Console summary
// ---------------------------------------------------------------------------

function printSummary(results: AggregatedOlsen) {
  const shortName = (m: string) => {
    const parts = m.split("/");
    return parts[parts.length - 1]
      .replace(/-preview.*/, "")
      .replace(/-latest/, "")
      .slice(0, 18);
  };

  console.log("\n📊 Olsen Evaluation Results\n");

  // Header
  const modelHeaders = results.models.map((m) => shortName(m).padStart(7));
  console.log(`  ${"Criterion".padEnd(25)} ${modelHeaders.join(" ")}  Mean`);
  console.log("  " + "─".repeat(25 + results.models.length * 8 + 6));

  for (const criterion of olsenCriteria) {
    const modelScores = results.models.map((m) => {
      const s = results.perModel[criterion.id]?.[m];
      return s && s > 0 ? String(s).padStart(7) : "     --";
    });
    const mean = results.scores[criterion.id];
    const meanStr = mean > 0 ? mean.toFixed(1).padStart(5) : "   --";
    console.log(
      `  ${criterion.name.padEnd(25)} ${modelScores.join(" ")}  ${meanStr}`,
    );
  }

  // Report failures
  if (Object.keys(results.failures).length > 0) {
    console.log("\n  ⚠️  Failures:");
    for (const [model, errors] of Object.entries(results.failures)) {
      for (const err of errors) {
        console.log(`     ${shortName(model)}: ${err.slice(0, 100)}`);
      }
    }
  }

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

  console.log("🔬 Olsen Evaluation Runner (Multi-Model)");
  console.log(`   Run dir:     ${path.relative(process.cwd(), runDir)}`);
  console.log(`   Judge host:  ${judgeHost}`);
  console.log(`   Models:      ${modelsToUse.length}`);
  for (const m of modelsToUse) {
    console.log(`                - ${m}`);
  }
  console.log(`   Criteria:    ${olsenCriteria.length}`);
  console.log(`   Total calls: ${olsenCriteria.length * modelsToUse.length}`);
  console.log();

  // Save run metadata
  const meta = {
    evalType: "olsen" as const,
    startedAt: new Date().toISOString(),
    judgeHost,
    judgeModels: modelsToUse,
    criteria: olsenCriteria.map((c) => c.id),
  };
  fs.writeFileSync(
    path.join(runDir, "run-meta.json"),
    JSON.stringify(meta, null, 2),
  );

  // Run each model sequentially (to avoid rate limits across models)
  const allRuns: OlsenScores[] = [];
  for (let i = 0; i < modelsToUse.length; i++) {
    const model = modelsToUse[i];
    console.log(`\n── Model ${i + 1}/${modelsToUse.length} ──`);
    try {
      const scores = await judgeOlsenWithModel(model);
      allRuns.push(scores);

      // Save intermediate results after each model (crash resilience)
      fs.writeFileSync(
        path.join(runDir, "olsen-scores-raw.json"),
        JSON.stringify(allRuns, null, 2),
      );
    } catch (err) {
      console.error(`\n  FATAL: Model ${model} failed entirely:`, err);
      // Continue with next model
    }
  }

  if (allRuns.length === 0) {
    console.error("\n❌ All models failed. No results to aggregate.");
    process.exit(1);
  }

  // Aggregate
  const results = aggregate(allRuns);

  // Save results
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

  // Generate LaTeX
  const latex = generateLatexTable(results);
  fs.writeFileSync(path.join(runDir, "olsen-table.tex"), latex);

  // Update meta
  fs.writeFileSync(
    path.join(runDir, "run-meta.json"),
    JSON.stringify(
      {
        ...meta,
        completedAt: new Date().toISOString(),
        modelsCompleted: allRuns.length,
        modelsFailed: modelsToUse.length - allRuns.length,
      },
      null,
      2,
    ),
  );

  // Print summary
  printSummary(results);
  console.log(`Results saved to ${path.relative(process.cwd(), runDir)}/`);
}

main().catch((err) => {
  console.error("Olsen evaluation failed:", err);
  process.exit(1);
});
