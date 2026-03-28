#!/usr/bin/env tsx
/**
 * CDN Inter-Rater Agreement & Aggregation
 *
 * Reads completed scoring sheets from all raters, computes
 * Krippendorff's alpha for inter-rater reliability, and
 * generates the final aggregated CDN scores + LaTeX table.
 *
 * Usage:
 *   pnpm eval:cdn-agreement
 *   EVAL_RUN_DIR=results/cdn-run-... pnpm eval:cdn-agreement
 */

import path from "path";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(path.resolve(__dirname, "../.."), false);

import fs from "fs";
import { cdnDimensions } from "./cdn-rubric";
import { scenarios } from "./personas";

const RESULTS_BASE = path.resolve(__dirname, "results");

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

interface RaterScore {
  rater: string;
  session: string;
  persona: string;
  scenario: string;
  scores: Record<string, number>; // dimensionId → score
  notes: Record<string, string>;  // dimensionId → evidence notes
}

function parseCsv(filePath: string, raterName: string): RaterScore[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));

  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const results: RaterScore[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length < 5) continue;

    const session = cols[0].trim();
    const persona = cols[1].trim();
    const scenario = cols[3].trim();

    const scores: Record<string, number> = {};
    const notes: Record<string, string> = {};

    // Dimension columns start at index 5, alternating score/notes
    for (let d = 0; d < cdnDimensions.length; d++) {
      const scoreIdx = 5 + d * 2;
      const notesIdx = 5 + d * 2 + 1;
      const scoreStr = cols[scoreIdx]?.trim();
      const note = cols[notesIdx]?.trim() ?? "";

      if (scoreStr && !isNaN(parseInt(scoreStr, 10))) {
        scores[cdnDimensions[d].id] = parseInt(scoreStr, 10);
      }
      if (note) {
        notes[cdnDimensions[d].id] = note;
      }
    }

    results.push({ rater: raterName, session, persona, scenario, scores, notes });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Krippendorff's alpha (ordinal, simplified)
// ---------------------------------------------------------------------------

/**
 * Compute Krippendorff's alpha for ordinal data.
 * Uses the simplified coincidence matrix approach.
 */
function krippendorffAlpha(
  ratings: number[][], // raters × items, NaN for missing
): number {
  const n = ratings[0].length; // items
  const m = ratings.length;    // raters

  // Collect all non-missing pairs per item
  const allValues: number[] = [];
  let Do = 0; // observed disagreement
  let totalPairs = 0;

  for (let item = 0; item < n; item++) {
    const values = ratings
      .map((r) => r[item])
      .filter((v) => !isNaN(v));

    if (values.length < 2) continue;

    const pairs = values.length * (values.length - 1);
    totalPairs += pairs;

    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        Do += (values[i] - values[j]) ** 2;
      }
    }

    allValues.push(...values);
  }

  if (totalPairs === 0) return 0;
  Do = (2 * Do) / totalPairs;

  // Expected disagreement
  let De = 0;
  const totalValues = allValues.length;
  const totalExpectedPairs = totalValues * (totalValues - 1);

  for (let i = 0; i < totalValues; i++) {
    for (let j = i + 1; j < totalValues; j++) {
      De += (allValues[i] - allValues[j]) ** 2;
    }
  }
  De = (2 * De) / totalExpectedPairs;

  if (De === 0) return 1; // perfect agreement
  return 1 - Do / De;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function findLatestCdnRun(): string {
  if (process.env.EVAL_RUN_DIR) {
    return path.resolve(__dirname, process.env.EVAL_RUN_DIR);
  }
  const dirs = fs
    .readdirSync(RESULTS_BASE)
    .filter(
      (d) =>
        (d.startsWith("cdn-run-") || d.startsWith("run-")) &&
        fs.statSync(path.join(RESULTS_BASE, d)).isDirectory(),
    )
    .sort()
    .reverse();
  if (dirs.length === 0) throw new Error("No run directories found.");
  return path.join(RESULTS_BASE, dirs[0]);
}

function main() {
  const runDir = findLatestCdnRun();
  const ratingsDir = path.join(runDir, "ratings");

  if (!fs.existsSync(ratingsDir)) {
    console.error(`No ratings directory found at ${ratingsDir}`);
    console.error(`Run 'pnpm eval:cdn-sheets' first, then have raters fill in the CSVs.`);
    process.exit(1);
  }

  // Load all rater CSVs
  const raterFiles = fs
    .readdirSync(ratingsDir)
    .filter((f) => f.endsWith(".csv"));

  if (raterFiles.length === 0) {
    console.error("No CSV files found in ratings directory.");
    process.exit(1);
  }

  console.log(`📊 CDN Inter-Rater Agreement\n`);
  console.log(`   Run dir:  ${path.relative(process.cwd(), runDir)}`);
  console.log(`   Raters:   ${raterFiles.length}`);

  const allRaterScores: RaterScore[][] = [];
  for (const file of raterFiles) {
    const raterName = file.replace(".csv", "");
    const scores = parseCsv(path.join(ratingsDir, file), raterName);
    allRaterScores.push(scores);
    const filled = scores.filter(
      (s) => Object.keys(s.scores).length > 0,
    ).length;
    console.log(`   ${raterName}: ${filled}/${scores.length} sessions scored`);
  }

  // Build session list (all unique sessions across raters)
  const sessionIds = [
    ...new Set(allRaterScores.flat().map((s) => s.session)),
  ].sort();

  // Compute alpha per dimension
  console.log(`\n   Krippendorff's Alpha by Dimension:\n`);
  console.log(`   ${"Dimension".padEnd(28)} Alpha`);
  console.log(`   ${"─".repeat(40)}`);

  const alphas: Record<string, number> = {};

  for (const dim of cdnDimensions) {
    // Build ratings matrix: raters × sessions
    const matrix = allRaterScores.map((raterScores) =>
      sessionIds.map((session) => {
        const entry = raterScores.find((s) => s.session === session);
        return entry?.scores[dim.id] ?? NaN;
      }),
    );

    const alpha = krippendorffAlpha(matrix);
    alphas[dim.id] = Math.round(alpha * 1000) / 1000;

    const alphaStr = alpha.toFixed(3);
    const quality =
      alpha >= 0.8 ? "good" : alpha >= 0.667 ? "acceptable" : "low";
    console.log(
      `   ${dim.name.padEnd(28)} ${alphaStr}  (${quality})`,
    );
  }

  // Overall alpha (all dimensions pooled)
  const allMatrix = allRaterScores.map((raterScores) =>
    sessionIds.flatMap((session) =>
      cdnDimensions.map((dim) => {
        const entry = raterScores.find((s) => s.session === session);
        return entry?.scores[dim.id] ?? NaN;
      }),
    ),
  );
  const overallAlpha = krippendorffAlpha(allMatrix);
  console.log(`\n   Overall Alpha: ${overallAlpha.toFixed(3)}\n`);

  // Aggregate scores: mean across raters per scenario × dimension
  const table: Record<string, Record<string, number>> = {};

  for (const scenario of scenarios) {
    table[scenario.id] = {};
    for (const dim of cdnDimensions) {
      const scores = allRaterScores
        .flat()
        .filter(
          (s) =>
            s.scenario === scenario.name &&
            s.scores[dim.id] !== undefined &&
            !isNaN(s.scores[dim.id]),
        )
        .map((s) => s.scores[dim.id]);

      if (scores.length === 0) {
        table[scenario.id][dim.id] = -1;
      } else {
        const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
        table[scenario.id][dim.id] = Math.round(mean * 10) / 10;
      }
    }
  }

  // Print summary table
  console.log("   CDN Scores (mean across raters):\n");
  const header = ["Dimension", ...scenarios.map((s) => s.paperLabel)];
  console.log(`   ${header.join("\t")}`);
  console.log(`   ${"─".repeat(60)}`);
  for (const dim of cdnDimensions) {
    const row = [
      `${dim.name} ${dim.lowerIsBetter ? "↓" : "↑"}`,
      ...scenarios.map((s) => {
        const score = table[s.id]?.[dim.id];
        return score && score > 0 ? score.toFixed(1) : "--";
      }),
    ];
    console.log(`   ${row.join("\t")}`);
  }

  // Generate LaTeX
  const latex = generateLatex(table);

  // Save results
  fs.writeFileSync(
    path.join(runDir, "cdn-scores-human.json"),
    JSON.stringify(table, null, 2),
  );
  fs.writeFileSync(
    path.join(runDir, "cdn-agreement.json"),
    JSON.stringify(
      { alphas, overallAlpha: Math.round(overallAlpha * 1000) / 1000, raters: raterFiles.length },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(runDir, "cdn-table-human.tex"), latex);

  console.log(
    `\n   Results saved to ${path.relative(process.cwd(), runDir)}/`,
  );
}

function generateLatex(
  table: Record<string, Record<string, number>>,
): string {
  const lines: string[] = [];
  const scenarioHeaders = scenarios.map((s) => s.paperLabel).join(" & ");

  lines.push("\\begin{table}");
  lines.push("  \\caption{CDN rubric evaluation by human raters across");
  lines.push(`  ${scenarios.length} scenarios. Scores are means across raters`);
  lines.push("  (scale: 1--5). For Viscosity, Premature Commitment,");
  lines.push("  and Hidden Dependencies, lower is better ($\\downarrow$).");
  lines.push("  For all others, higher is better ($\\uparrow$).}");
  lines.push("  \\label{tab:cdn_results}");
  lines.push(`  \\begin{tabular}{l${"c".repeat(scenarios.length)}}`);
  lines.push("    \\toprule");
  lines.push(`    CDN Dimension & ${scenarioHeaders} \\\\`);
  lines.push("    \\midrule");

  for (const dim of cdnDimensions) {
    const arrow = dim.lowerIsBetter ? "$\\downarrow$" : "$\\uparrow$";
    const scores = scenarios
      .map((s) => {
        const score = table[s.id]?.[dim.id];
        return score && score > 0 ? score.toFixed(1) : "--";
      })
      .join(" & ");
    lines.push(`    ${dim.name} ${arrow} & ${scores} \\\\`);
  }

  lines.push("    \\bottomrule");
  lines.push("  \\end{tabular}");
  lines.push("\\end{table}");

  return lines.join("\n");
}

main();
