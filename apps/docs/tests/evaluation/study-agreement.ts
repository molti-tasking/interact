/**
 * Agreement between two raters' coding sheets of the panel study.
 *
 *   pnpm study:agreement rater-a/coding-requirements.csv rater-b/coding-requirements.csv
 *
 * Works for every rater sheet (see docs/study/coding-guide.md):
 *
 *   coding-requirements.csv  in_first_prompt, in_final_form   Cohen's kappa
 *   coding-fields.csv        requirement_id                    Cohen's kappa
 *   coding-recall.csv        matches_field, requirement_id     Cohen's kappa
 *   coding-why.csv           score (0, 1, 2)                   weighted kappa
 *
 * Rows are matched on the identifying columns, not on their order. Prints
 * the kappa per coded column and lists the rows the raters disagree on.
 * `score` is ordinal: weighted kappa with linear weights (quadratic printed
 * alongside); a score other than 0, 1 or 2 is listed and left out.
 */

import fs from "fs";
import { cohenKappa, weightedKappa } from "../../src/lib/study/coding";
import { parseCsv } from "../../src/lib/study/export";

const CODED = ["in_first_prompt", "in_final_form", "requirement_id", "matches_field", "score"];
const KEYS = ["form", "requirement_id", "question_no", "line_no", "item_no"];
/** Row-numbered sheets: there `requirement_id` is a code, not a key */
const ROW_KEYS = ["question_no", "line_no", "item_no"];
const ORDINAL: Record<string, string[]> = { score: ["0", "1", "2"] };

function load(file: string) {
  const [header, ...rows] = parseCsv(fs.readFileSync(file, "utf-8"));
  return { header, rows };
}

function main() {
  const [fileA, fileB] = process.argv.slice(2);
  if (!fileA || !fileB) {
    console.error("Usage: study:agreement <rater-a.csv> <rater-b.csv>");
    process.exit(1);
  }
  const a = load(fileA);
  const b = load(fileB);
  const numbered = ROW_KEYS.some((k) => a.header.includes(k));
  const keyColumns = KEYS.filter(
    (k) => a.header.includes(k) && !(numbered && k === "requirement_id"),
  );
  const coded = CODED.filter(
    (c) => a.header.includes(c) && b.header.includes(c) && !keyColumns.includes(c),
  );
  if (keyColumns.length === 0 || coded.length === 0) {
    console.error("These don't look like coding sheets of the same kind.");
    process.exit(1);
  }
  const keyOf = (header: string[], row: string[]) =>
    keyColumns.map((k) => row[header.indexOf(k)] ?? "").join(" / ");
  const byKeyB = new Map(b.rows.map((row) => [keyOf(b.header, row), row]));

  for (const column of coded) {
    const codesA: string[] = [];
    const codesB: string[] = [];
    const disagreements: string[] = [];
    const invalid: string[] = [];
    let skipped = 0;
    const scale = ORDINAL[column];
    for (const row of a.rows) {
      const key = keyOf(a.header, row);
      const other = byKeyB.get(key);
      const va = (row[a.header.indexOf(column)] ?? "").trim().toLowerCase();
      const vb = (other?.[b.header.indexOf(column)] ?? "").trim().toLowerCase();
      if (!other || va === "" || vb === "") {
        skipped++;
        continue;
      }
      if (scale && (!scale.includes(va) || !scale.includes(vb))) {
        invalid.push(`  ${key}: ${va} vs ${vb}`);
        continue;
      }
      codesA.push(va);
      codesB.push(vb);
      if (va !== vb) disagreements.push(`  ${key}: ${va} vs ${vb}`);
    }
    const fmt = (k: number | null) => (k === null ? "n/a" : k.toFixed(3));
    const summary = `(${codesA.length} rows, ${disagreements.length} disagreements, ${skipped} not coded by both)`;
    if (scale) {
      console.log(
        `${column}: weighted kappa (linear) = ${fmt(weightedKappa(codesA, codesB, scale, "linear"))}, ` +
          `quadratic = ${fmt(weightedKappa(codesA, codesB, scale, "quadratic"))} ${summary}`,
      );
      if (invalid.length > 0) {
        console.log(`  ${invalid.length} rows with a score other than ${scale.join(", ")} (left out):`);
        console.log(invalid.join("\n"));
      }
    } else {
      console.log(`${column}: kappa = ${fmt(cohenKappa(codesA, codesB))} ${summary}`);
    }
    if (disagreements.length > 0) console.log(disagreements.join("\n"));
  }
}

main();
