/**
 * Agreement between two raters' coding sheets of the panel study.
 *
 *   pnpm study:agreement rater-a/coding-requirements.csv rater-b/coding-requirements.csv
 *
 * Works for coding-requirements.csv (columns in_first_prompt, in_final_form)
 * and coding-fields.csv (column requirement_id). Rows are matched on the
 * identifying columns, not on their order. Prints Cohen's kappa per coded
 * column and lists the rows the raters disagree on.
 */

import fs from "fs";
import { cohenKappa } from "../../src/lib/study/coding";
import { parseCsv } from "../../src/lib/study/export";

const CODED = ["in_first_prompt", "in_final_form", "requirement_id"];
const KEYS = ["form", "requirement_id", "question_no"];

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
  const isFields = a.header.includes("question_no");
  const keyColumns = KEYS.filter(
    (k) => a.header.includes(k) && !(isFields && k === "requirement_id"),
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
    let skipped = 0;
    for (const row of a.rows) {
      const key = keyOf(a.header, row);
      const other = byKeyB.get(key);
      const va = (row[a.header.indexOf(column)] ?? "").trim().toLowerCase();
      const vb = (other?.[b.header.indexOf(column)] ?? "").trim().toLowerCase();
      if (!other || va === "" || vb === "") {
        skipped++;
        continue;
      }
      codesA.push(va);
      codesB.push(vb);
      if (va !== vb) disagreements.push(`  ${key}: ${va} vs ${vb}`);
    }
    const kappa = cohenKappa(codesA, codesB);
    console.log(
      `${column}: kappa = ${kappa === null ? "n/a" : kappa.toFixed(3)} ` +
        `(${codesA.length} rows, ${disagreements.length} disagreements, ${skipped} not coded by both)`,
    );
    if (disagreements.length > 0) console.log(disagreements.join("\n"));
  }
}

main();
