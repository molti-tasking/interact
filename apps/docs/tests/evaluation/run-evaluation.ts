#!/usr/bin/env tsx
/**
 * CDN Evaluation Runner
 *
 * Orchestrates the full evaluation pipeline:
 *   Phase 1: Persona simulation (Playwright × live app)
 *   Phase 2: CDN rubric judging (LLM-as-judge)
 *   Phase 3: Results aggregation + LaTeX generation
 *
 * Each run creates a timestamped directory under results/ so you can
 * iterate without overwriting previous data.
 *
 * Usage:
 *   pnpm eval                                      # full run
 *   EVAL_BASE_URL=http://localhost:3000 pnpm eval   # against local app
 *   pnpm eval:headed                                # watch the browser
 *   pnpm eval:judge-only                            # re-judge latest run
 *   EVAL_RUN_DIR=results/run-2026-03-25_143022 pnpm eval:judge-only  # re-judge specific run
 *
 * Environment variables:
 *   EVAL_BASE_URL        — App URL (default: https://interact-molt.vercel.app)
 *   EVAL_HEADED          — Run browser visibly (default: false)
 *   LLM_HOST             — LiteLLM proxy for persona decisions
 *   LLM_API_KEY          — API key for LiteLLM
 *   LLM_MODEL_NAME       — Model for persona simulation (fallback)
 *   EVAL_SIM_MODEL       — Override model for persona simulation
 *   EVAL_JUDGE_HOST      — LLM host for judging (defaults to LLM_HOST)
 *   EVAL_JUDGE_KEY       — API key for judge (defaults to LLM_API_KEY)
 *   EVAL_JUDGE_MODEL     — Model for CDN judging (defaults to LLM_MODEL_NAME)
 *   EVAL_SKIP_SIMULATION — Skip Phase 1, use cached artifacts
 *   EVAL_JUDGE_RUNS      — Number of judge runs per session (default: 1)
 *   EVAL_RUN_DIR         — Re-use a specific run directory (for judge-only)
 */

import path from "path";

// Load .env before other evaluation modules read process.env at import time
import { loadEnvConfig } from "@next/env";
loadEnvConfig(path.resolve(__dirname, "../.."), false);

import { chromium } from "@playwright/test";
import fs from "fs";
import { personas, scenarios } from "./personas";
import { simulatePersona } from "./simulate-persona";
import { judgeSession, type SessionScores } from "./judge-cdn";
import { aggregateScores, generateLatexTable } from "./aggregate";
import type { SessionArtifacts } from "./cdn-rubric";

// ---------------------------------------------------------------------------
// Run directory setup
// ---------------------------------------------------------------------------

const RESULTS_BASE = path.resolve(__dirname, "results");
const SKIP_SIMULATION = process.env.EVAL_SKIP_SIMULATION === "true";
const HEADED = process.env.EVAL_HEADED === "true";
const JUDGE_RUNS = parseInt(process.env.EVAL_JUDGE_RUNS ?? "1", 10);

function createRunDir(): string {
  const now = new Date();
  const ts = now.toISOString().replace(/[T]/g, "_").replace(/[:]/g, "").slice(0, 15);
  const dir = path.join(RESULTS_BASE, `run-${ts}`);
  fs.mkdirSync(path.join(dir, "artifacts"), { recursive: true });
  fs.mkdirSync(path.join(dir, "screenshots"), { recursive: true });
  return dir;
}

function resolveRunDir(): string {
  // Explicit run dir via env
  if (process.env.EVAL_RUN_DIR) {
    const dir = path.resolve(__dirname, process.env.EVAL_RUN_DIR);
    if (!fs.existsSync(dir)) {
      throw new Error(`EVAL_RUN_DIR does not exist: ${dir}`);
    }
    return dir;
  }

  // Follow the "latest" symlink
  const latest = path.join(RESULTS_BASE, "latest");
  if (fs.existsSync(latest)) {
    return fs.realpathSync(latest);
  }

  throw new Error(
    "No previous run found. Run a full evaluation first, or set EVAL_RUN_DIR.",
  );
}

function linkLatest(runDir: string): void {
  const latest = path.join(RESULTS_BASE, "latest");
  try {
    if (fs.existsSync(latest)) fs.unlinkSync(latest);
    fs.symlinkSync(path.basename(runDir), latest);
  } catch {
    // Symlinks may fail on some systems — not critical
  }
}

async function main() {
  const baseUrl = process.env.EVAL_BASE_URL ?? "https://interact-molt.vercel.app";
  const llmHost = process.env.LLM_HOST ?? "(NOT SET)";
  const simModel = process.env.EVAL_SIM_MODEL ?? process.env.LLM_MODEL_NAME ?? "(NOT SET)";
  const judgeHost = process.env.EVAL_JUDGE_HOST ?? llmHost;
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? process.env.LLM_MODEL_NAME ?? "(NOT SET)";

  // Determine run directory
  const runDir = SKIP_SIMULATION ? resolveRunDir() : createRunDir();
  const artifactsDir = path.join(runDir, "artifacts");
  const screenshotsDir = path.join(runDir, "screenshots");

  console.log(`\n🔬 CDN Evaluation Runner`);
  console.log(`   Run dir:     ${path.relative(process.cwd(), runDir)}`);
  console.log(`   App:         ${baseUrl}`);
  console.log(`   Headed:      ${HEADED}`);
  console.log(`   LLM host:    ${llmHost}`);
  console.log(`   Sim model:   ${simModel}`);
  console.log(`   Judge host:  ${judgeHost}`);
  console.log(`   Judge model: ${judgeModel}`);
  console.log(`   Personas:    ${personas.length}`);
  console.log(`   Scenarios:   ${scenarios.length}`);
  console.log(`   Sessions:    ${personas.length * scenarios.length}`);
  console.log(`   Judge runs:  ${JUDGE_RUNS}`);
  console.log(`   Judge calls: ${personas.length * scenarios.length * 8 * JUDGE_RUNS}\n`);

  // Save run metadata
  if (!SKIP_SIMULATION) {
    fs.writeFileSync(
      path.join(runDir, "run-meta.json"),
      JSON.stringify(
        {
          startedAt: new Date().toISOString(),
          baseUrl,
          simModel,
          judgeModel,
          judgeHost,
          judgeRuns: JUDGE_RUNS,
          headed: HEADED,
          personas: personas.map((p) => p.id),
          scenarios: scenarios.map((s) => s.id),
        },
        null,
        2,
      ),
    );
  }

  // =========================================================================
  // Phase 1: Persona Simulation
  // =========================================================================
  const allArtifacts: Map<string, SessionArtifacts> = new Map();

  if (SKIP_SIMULATION) {
    console.log(`⏩ Skipping simulation — loading artifacts from ${path.relative(process.cwd(), artifactsDir)}`);
    for (const persona of personas) {
      for (const scenario of scenarios) {
        const key = `${persona.id}-${scenario.id}`;
        const file = path.join(artifactsDir, `${key}.json`);
        if (fs.existsSync(file)) {
          allArtifacts.set(key, JSON.parse(fs.readFileSync(file, "utf-8")));
          console.log(`   Loaded ${key}`);
        } else {
          console.warn(`   ⚠️  Missing artifacts for ${key}`);
        }
      }
    }
  } else {
    console.log("🎭 Phase 1: Persona Simulation\n");
    const browser = await chromium.launch({
      headless: !HEADED,
      slowMo: HEADED ? 300 : 0,
    });

    for (const persona of personas) {
      for (const scenario of scenarios) {
        const key = `${persona.id}-${scenario.id}`;
        try {
          const artifacts = await simulatePersona(
            persona,
            scenario,
            browser,
            screenshotsDir,
          );
          allArtifacts.set(key, artifacts);

          // Save artifacts
          fs.writeFileSync(
            path.join(artifactsDir, `${key}.json`),
            JSON.stringify(artifacts, null, 2),
          );
        } catch (err) {
          console.error(`   ❌ Failed: ${key}`, err);
        }
      }
    }

    await browser.close();
    console.log(`\n   ✅ Simulation complete: ${allArtifacts.size} sessions\n`);
  }

  // =========================================================================
  // Phase 2: CDN Rubric Judging
  // =========================================================================
  console.log("⚖️  Phase 2: CDN Rubric Judging\n");
  const allScores: SessionScores[] = [];

  for (const persona of personas) {
    for (const scenario of scenarios) {
      const key = `${persona.id}-${scenario.id}`;
      const artifacts = allArtifacts.get(key);
      if (!artifacts) {
        console.warn(`   Skipping ${key} — no artifacts`);
        continue;
      }

      for (let run = 0; run < JUDGE_RUNS; run++) {
        if (JUDGE_RUNS > 1) {
          console.log(`   Run ${run + 1}/${JUDGE_RUNS} for ${key}`);
        }
        const scores = await judgeSession(artifacts, persona.id, scenario.id);
        allScores.push(scores);
      }
    }
  }

  // Save raw scores
  fs.writeFileSync(
    path.join(runDir, "cdn-scores-raw.json"),
    JSON.stringify(allScores, null, 2),
  );
  console.log(`\n   ✅ Judging complete: ${allScores.length} scored sessions\n`);

  // =========================================================================
  // Phase 3: Aggregation
  // =========================================================================
  console.log("📊 Phase 3: Aggregation\n");
  const results = aggregateScores(allScores, scenarios);

  // Save aggregated results
  fs.writeFileSync(
    path.join(runDir, "cdn-scores.json"),
    JSON.stringify(results.table, null, 2),
  );

  // Generate LaTeX table
  const latexTable = generateLatexTable(results, scenarios);
  fs.writeFileSync(path.join(runDir, "cdn-table.tex"), latexTable);
  console.log("   Generated cdn-table.tex:\n");
  console.log(latexTable);

  // Summary
  console.log("\n\n📋 Summary:\n");
  const header = ["Dimension", ...scenarios.map((s) => s.paperLabel)];
  console.log(header.join("\t"));
  console.log("-".repeat(60));

  for (const dim of (await import("./cdn-rubric")).cdnDimensions) {
    const row = [
      `${dim.name} ${dim.lowerIsBetter ? "↓" : "↑"}`,
      ...scenarios.map((s) => {
        const score = results.table[s.id]?.[dim.id];
        return score && score > 0 ? score.toFixed(1) : "--";
      }),
    ];
    console.log(row.join("\t"));
  }

  // Update run metadata with completion time
  const metaPath = path.join(runDir, "run-meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.completedAt = new Date().toISOString();
    meta.sessionsCompleted = allArtifacts.size;
    meta.sessionsJudged = allScores.length;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }

  // Symlink latest
  linkLatest(runDir);

  console.log(`\n✅ Done. Results saved to ${path.relative(process.cwd(), runDir)}/`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
