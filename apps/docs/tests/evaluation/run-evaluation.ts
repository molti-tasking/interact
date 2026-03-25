#!/usr/bin/env tsx
/**
 * CDN Evaluation Runner
 *
 * Orchestrates the full evaluation pipeline:
 *   Phase 1: Persona simulation (Playwright × live app)
 *   Phase 2: CDN rubric judging (LLM-as-judge)
 *   Phase 3: Results aggregation + LaTeX generation
 *
 * Usage:
 *   # Against deployed app (default)
 *   pnpm tsx tests/evaluation/run-evaluation.ts
 *
 *   # Against local app
 *   EVAL_BASE_URL=http://localhost:3000 pnpm tsx tests/evaluation/run-evaluation.ts
 *
 *   # Skip simulation (use cached artifacts)
 *   EVAL_SKIP_SIMULATION=true pnpm tsx tests/evaluation/run-evaluation.ts
 *
 * Environment variables:
 *   EVAL_BASE_URL        — App URL (default: https://interact-molt.vercel.app)
 *   LLM_HOST             — LiteLLM proxy for persona decisions
 *   LLM_API_KEY          — API key for LiteLLM
 *   LLM_MODEL_NAME       — Model for persona simulation (fallback)
 *   EVAL_SIM_MODEL       — Override model for persona simulation
 *   EVAL_JUDGE_HOST      — LLM host for judging (defaults to LLM_HOST)
 *   EVAL_JUDGE_KEY       — API key for judge (defaults to LLM_API_KEY)
 *   EVAL_JUDGE_MODEL     — Model for CDN judging (defaults to LLM_MODEL_NAME)
 *   EVAL_SKIP_SIMULATION — Skip Phase 1, use cached artifacts
 *   EVAL_JUDGE_RUNS      — Number of judge runs per session (default: 1)
 */

import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";
import { personas, scenarios } from "./personas";
import { simulatePersona } from "./simulate-persona";
import { judgeSession, type SessionScores } from "./judge-cdn";
import { aggregateScores, generateLatexTable } from "./aggregate";
import type { SessionArtifacts } from "./cdn-rubric";

const RESULTS_DIR = path.resolve(__dirname, "results");
const ARTIFACTS_DIR = path.join(RESULTS_DIR, "artifacts");
const SKIP_SIMULATION = process.env.EVAL_SKIP_SIMULATION === "true";
const JUDGE_RUNS = parseInt(process.env.EVAL_JUDGE_RUNS ?? "1", 10);

async function main() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  const baseUrl = process.env.EVAL_BASE_URL ?? "https://interact-molt.vercel.app";
  console.log(`\n🔬 CDN Evaluation Runner`);
  console.log(`   App: ${baseUrl}`);
  console.log(`   Personas: ${personas.length}`);
  console.log(`   Scenarios: ${scenarios.length}`);
  console.log(`   Total sessions: ${personas.length * scenarios.length}`);
  console.log(`   CDN dimensions: 8`);
  console.log(`   Judge runs per session: ${JUDGE_RUNS}`);
  console.log(`   Total judge prompts: ${personas.length * scenarios.length * 8 * JUDGE_RUNS}\n`);

  // =========================================================================
  // Phase 1: Persona Simulation
  // =========================================================================
  const allArtifacts: Map<string, SessionArtifacts> = new Map();

  if (SKIP_SIMULATION) {
    console.log("⏩ Skipping simulation — loading cached artifacts...");
    for (const persona of personas) {
      for (const scenario of scenarios) {
        const key = `${persona.id}-${scenario.id}`;
        const file = path.join(ARTIFACTS_DIR, `${key}.json`);
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
    const browser = await chromium.launch({ headless: true });

    for (const persona of personas) {
      for (const scenario of scenarios) {
        const key = `${persona.id}-${scenario.id}`;
        try {
          const artifacts = await simulatePersona(persona, scenario, browser);
          allArtifacts.set(key, artifacts);

          // Cache artifacts
          fs.writeFileSync(
            path.join(ARTIFACTS_DIR, `${key}.json`),
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
    path.join(RESULTS_DIR, "cdn-scores-raw.json"),
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
    path.join(RESULTS_DIR, "cdn-scores.json"),
    JSON.stringify(results.table, null, 2),
  );

  // Generate LaTeX table
  const latexTable = generateLatexTable(results, scenarios);
  fs.writeFileSync(path.join(RESULTS_DIR, "cdn-table.tex"), latexTable);
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

  console.log(`\n✅ Done. Results saved to ${RESULTS_DIR}/`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
