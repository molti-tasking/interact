/**
 * E1's summary from saved runs only (no model, no database):
 *
 *   EVAL_NO_DB=1 eval/run.sh e1/summarize.eval.ts --runs final-2026-…[,final-…]
 *
 * Writes eval/out/e1-summary.json: per pipeline (with 95 % bootstrap
 * intervals), per scenario and per request, plus the runs' metadata.
 */
import fs from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { summarize } from "./summarize";

const RUNS_DIR = path.join(__dirname, "runs");
const OUT = path.resolve(__dirname, "../out");

it("summarizes E1", () => {
  const args = (process.env.EVAL_ARGS ?? "").split(/\s+/).filter(Boolean);
  const i = args.indexOf("--runs");
  const labels = i >= 0 ? args[i + 1].split(",") : [];
  if (!labels.length) throw new Error("Name the runs: --runs <label>[,<label>]");
  const dirs = labels.map((l) => path.join(RUNS_DIR, l));
  for (const d of dirs) if (!fs.existsSync(d)) throw new Error(`No run ${d}`);

  const summary = summarize(dirs);
  const meta = dirs.map((d) => JSON.parse(fs.readFileSync(path.join(d, "meta.json"), "utf-8")));
  const out = { generatedAt: new Date().toISOString(), meta, ...summary };
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "e1-summary.json"), `${JSON.stringify(out, null, 2)}\n`);
  process.stderr.write(
    `\nSUMMARY ${JSON.stringify({ trajectories: summary.trajectories, totalCostUsd: summary.totalCostUsd })}\n`,
  );
});
