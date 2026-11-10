/**
 * Replay recorded cases against the current prompts and model, and report
 * how the automated form changes behaved (see tests/evaluation/README.md).
 *
 *   pnpm eval:replay                       # the committed seed cases
 *   pnpm eval:replay --cases <file|dir>    # e.g. replay/private/H7VTHW.jsonl
 *   pnpm eval:replay --limit 5 --ops resolve-probe,sync-intent
 *   pnpm eval:replay --offline             # recorded previews only, no model
 *   pnpm eval:replay --compare <results.json>
 *
 * The work happens in `replay/replay.eval.ts`, run by vitest so the server
 * actions can be imported with auth and tracing stubbed. This wrapper loads
 * `.env.local` (vitest itself would load the test environment, which has no
 * gateway credentials) and turns the flags into REPLAY_* variables.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

const projectDir = path.resolve(__dirname, "../..");
loadEnvConfig(projectDir, true);

const FLAGS: Record<string, string> = {
  "--cases": "REPLAY_CASES",
  "--limit": "REPLAY_LIMIT",
  "--concurrency": "REPLAY_CONCURRENCY",
  "--ops": "REPLAY_OPS",
  "--out": "REPLAY_OUT",
  "--compare": "REPLAY_COMPARE",
  "--model": "LLM_MODEL_NAME",
  "--fast-model": "LLM_FAST_MODEL_NAME",
};
const PATH_FLAGS = new Set(["--cases", "--out", "--compare"]);

const env: NodeJS.ProcessEnv = { ...process.env, LLM_RATE_LIMIT_PER_MIN: "0" };
// The fixtures switch would answer from recordings instead of the model
delete env.USE_FIXTURES;
delete env.RECORD_FIXTURES;

const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--offline") {
    env.REPLAY_OFFLINE = "1";
  } else if (arg === "--help" || arg === "-h") {
    console.log(
      "Usage: pnpm eval:replay [--cases <file|dir>] [--limit n] [--concurrency n] [--ops a,b]\n" +
        "                        [--model id] [--fast-model id] [--compare results.json] [--out dir] [--offline]",
    );
    process.exit(0);
  } else if (FLAGS[arg]) {
    const value = args[++i];
    if (value === undefined) {
      console.error(`${arg} needs a value`);
      process.exit(1);
    }
    // Paths are given relative to where the command was run
    env[FLAGS[arg]] = PATH_FLAGS.has(arg) ? path.resolve(value) : value;
  } else {
    console.error(`Unknown option ${arg} (try --help)`);
    process.exit(1);
  }
}

const result = spawnSync(
  path.join(projectDir, "node_modules/.bin/vitest"),
  ["run", "--config", path.join(projectDir, "tests/evaluation/replay/vitest.config.ts")],
  { cwd: projectDir, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
