# Evaluation harness (EICS 2027)

How to run the technical evaluation of Malleable Forms.
- **Plan and decisions:** `PLAN.md`
- **Claim audit:** `CLAIMS.md`
- **Changes from the specification:** `DEVIATIONS.md`
- **Every run that called a model, with its cost:** `RUNLOG.md`
- **Frozen material, by hash:** `FROZEN.md`

## Setup (once)

1. **`eval/.env.eval`** (git-ignored): the evaluation's own Anthropic key.
   ```sh
   LLM_PROVIDER=anthropic
   ANTHROPIC_API_KEY=…
   LLM_MODEL_NAME=claude-sonnet-5
   LLM_FAST_MODEL_NAME=claude-sonnet-5
   EVAL_DATA_DIR=study/data      # raw exports (git-ignored), for E2/E3
   ```
2. **The local database** of the current profile. It runs on its own ports and never touches 54321/54322.
   ```sh
   eval/stacks.sh current up       # stop: eval/stacks.sh current down
   eval/stacks.sh pilot up         # E2/E3 only: worktree of a64d230 + its database
   ```
3. **`eval/node_modules`:** a symlink to `apps/docs/node_modules` (git-ignored). The app's dependencies must be installed.

## Commands

| Step | Command | Model calls | Expected cost |
|---|---|---|---|
| Harness unit tests | `eval/run.sh test` | none | $0 |
| Freeze base forms (done) | `EVAL_NO_DB=1 eval/run.sh e1/generate-base.eval.ts` | 3, once | $0.07 (spent) |
| Seeded responses (done) | `EVAL_NO_DB=1 eval/run.sh e1/generate-responses.eval.ts` | none | $0 |
| Material hash, for `FROZEN.md` | `EVAL_NO_DB=1 eval/run.sh e1/hash.eval.ts` | none | $0 |
| E1 plumbing check | `eval/run.sh e1/run.eval.ts --check [--requests …]` | a few | < $0.50 |
| E1 dry run | `eval/run.sh e1/run.eval.ts --dry` | ~170 | ~$2–3 (estimate) |
| E1 final runs | `eval/run.sh e1/run.eval.ts --final` | ~850 | ~$10–15 (projected by the dry run) |

## Budget

The cap is $40.
- **Ledger:** every call's cost is computed from its tokens at the frozen prices in `prices.json` and added to `out/spend.json`.
- **Before each run:** the runner checks that the run's estimated cost fits in what is left. It stops between runs, never during one, and saves the runs it skipped as `aborted`.
- **Projection:** the dry run projects the cost of the final runs. Above $30, `--final` refuses until the authors approve (`EVAL_COST_APPROVED_USD=<amount>`).

## E1 rules

- **`--final` refuses unless:**
  - every gold spec in `e1/scenarios/*/script.yaml` has `reviewed: true`;
  - the material's hash is recorded in `FROZEN.md` as `e1-material:`;
  - the dry run's projection is within the approved limit.
- **Every run is saved** in `e1/runs/<label>/`, including failed and aborted ones. The numbers are computed from these files alone (`e1/summarize.ts`), so they can be recomputed offline.
