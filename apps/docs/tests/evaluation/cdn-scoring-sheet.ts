#!/usr/bin/env tsx
/**
 * CDN Scoring Sheet Generator
 *
 * Generates CSV scoring templates for human raters to fill in
 * while watching the session recordings.
 *
 * Usage:
 *   pnpm eval:cdn-sheets
 *   EVAL_RUN_DIR=results/cdn-run-... pnpm eval:cdn-sheets
 *   EVAL_RATERS=3 pnpm eval:cdn-sheets
 */

import path from "path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(path.resolve(__dirname, "../.."), false);

import fs from "fs";
import { cdnDimensions } from "./cdn-rubric";
import { personas, scenarios } from "./personas";

const RESULTS_BASE = path.resolve(__dirname, "results");
const NUM_RATERS = parseInt(process.env.EVAL_RATERS ?? "2", 10);

function findLatestCdnRun(): string {
  if (process.env.EVAL_RUN_DIR) {
    return path.resolve(__dirname, process.env.EVAL_RUN_DIR);
  }
  // Find the latest cdn-run-* directory
  const dirs = fs
    .readdirSync(RESULTS_BASE)
    .filter(
      (d) =>
        (d.startsWith("cdn-run-") || d.startsWith("run-")) &&
        fs.statSync(path.join(RESULTS_BASE, d)).isDirectory(),
    )
    .sort()
    .reverse();

  if (dirs.length === 0) {
    throw new Error("No run directories found. Run 'pnpm eval:cdn-evidence' first.");
  }
  return path.join(RESULTS_BASE, dirs[0]);
}

function generateCsv(raterName: string, runDir: string): string {
  const lines: string[] = [];

  // Header
  lines.push(
    [
      "Session",
      "Persona",
      "Skill Level",
      "Scenario",
      "Video File",
      ...cdnDimensions.flatMap((d) => [
        `${d.name} (${d.lowerIsBetter ? "lower better" : "higher better"}) [1-5]`,
        `${d.name} Evidence Notes`,
      ]),
    ].join(","),
  );

  // One row per session
  for (const persona of personas) {
    for (const scenario of scenarios) {
      const key = `${persona.id}-${scenario.id}`;
      const videoFile = `videos/${key}.webm`;

      lines.push(
        [
          key,
          persona.name,
          persona.skillLevel,
          scenario.name,
          videoFile,
          ...cdnDimensions.flatMap(() => ["", ""]), // empty score + notes columns
        ].join(","),
      );
    }
  }

  // Add reference section as comments
  lines.push("");
  lines.push("# === CDN Dimension Reference ===");
  for (const dim of cdnDimensions) {
    lines.push(`# ${dim.name} (${dim.lowerIsBetter ? "LOWER is better" : "HIGHER is better"})`);
    lines.push(`# ${dim.description}`);
    lines.push(`# Focus: ${dim.evaluationFocus}`);
    lines.push(`# 1: ${dim.anchors[1]}`);
    lines.push(`# 2: ${dim.anchors[2]}`);
    lines.push(`# 3: ${dim.anchors[3]}`);
    lines.push(`# 4: ${dim.anchors[4]}`);
    lines.push(`# 5: ${dim.anchors[5]}`);
    lines.push("#");
  }

  return lines.join("\n");
}

function main() {
  const runDir = findLatestCdnRun();
  const ratingsDir = path.join(runDir, "ratings");
  fs.mkdirSync(ratingsDir, { recursive: true });

  console.log(`📋 CDN Scoring Sheet Generator\n`);
  console.log(`   Run dir:    ${path.relative(process.cwd(), runDir)}`);
  console.log(`   Raters:     ${NUM_RATERS}`);
  console.log(`   Sessions:   ${personas.length * scenarios.length}`);
  console.log(`   Dimensions: ${cdnDimensions.length}\n`);

  for (let i = 1; i <= NUM_RATERS; i++) {
    const name = `rater-${i}`;
    const csv = generateCsv(name, runDir);
    const filePath = path.join(ratingsDir, `${name}.csv`);
    fs.writeFileSync(filePath, csv);
    console.log(`   Created ${path.relative(process.cwd(), filePath)}`);
  }

  console.log(`\n   Instructions:`);
  console.log(`   1. Each rater opens their CSV file`);
  console.log(`   2. Watch each session video in ${path.relative(process.cwd(), path.join(runDir, "videos"))}/`);
  console.log(`   3. Score each dimension 1-5 and add evidence notes`);
  console.log(`   4. Save the completed CSV back to the ratings/ directory`);
  console.log(`   5. Run 'pnpm eval:cdn-agreement' to compute results\n`);
}

main();
