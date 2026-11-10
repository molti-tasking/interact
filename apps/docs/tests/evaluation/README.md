# CDN Evaluation Automation

Automated evaluation harness for the UIST '26 paper.

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Evaluation Runner                    │
│                  (run-evaluation.ts)                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  Phase 1: Persona Simulation                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Persona 1│  │ Persona 2│  │ Persona 3│  × 3 sc. │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘          │
│       │              │              │                 │
│       ▼              ▼              ▼                 │
│  Playwright against live/local app                   │
│  → Creates portfolio, enters intent, resolves        │
│    elicitation questions based on persona profile             │
│  → Collects artifacts: intent, conversation log,     │
│    final schema, provenance                          │
│                                                       │
│  Phase 2: CDN Rubric Judging                         │
│  ┌──────────────────────────────────┐                │
│  │  LLM Judge (per dimension)       │                │
│  │  8 dimensions × 9 sessions       │                │
│  │  = 72 scoring prompts            │                │
│  │  → structured JSON scores (1-5)  │                │
│  └──────────────────────────────────┘                │
│                                                       │
│  Phase 3: Results Aggregation                        │
│  → Mean scores per dimension × scenario              │
│  → LaTeX table output for paper                      │
│  → Raw data as JSON for reproducibility              │
└─────────────────────────────────────────────────────┘
```

## Requirements

1. **Playwright** — browser automation for persona simulation (`@playwright/test`)
2. **LLM API access** — for both persona decisions and CDN judging
   - Persona simulation: uses the app's LLM backend (LiteLLM proxy via `LLM_HOST`)
   - CDN judging: separate LLM calls (can use a different, more capable model)
3. **Running app** — either local (`localhost:3000`) or deployed (`interact-molt.vercel.app`)

## Running

```bash
# Full evaluation against deployed app (default)
pnpm eval

# Against local app
EVAL_BASE_URL=http://localhost:3000 pnpm eval

# Skip simulation, re-judge cached artifacts only
pnpm eval:judge-only

# With separate models for simulation vs judging
EVAL_SIM_MODEL=gpt-4o-mini \
EVAL_JUDGE_MODEL=claude-sonnet-4-5-20250514 \
pnpm eval
```

### Fast local evaluation

For faster runs, start the app with a cheaper/faster model for form generation:

```bash
# Terminal 1: Start app with fast model
LLM_MODEL_NAME=devstral:latest pnpm dev

# Terminal 2: Run evaluation (uses fast model for app-side calls,
#             capable model for CDN judging)
EVAL_BASE_URL=http://localhost:3000 \
EVAL_JUDGE_MODEL=anthropic/claude-sonnet-4-6 \
pnpm eval
```

The evaluation automatically skips conflict detection during simulation
(`?skipConflicts=true`) to save ~25s per elicitation question resolution.

## Environment Variables

| Variable           | Description                           | Default                            |
| ------------------ | ------------------------------------- | ---------------------------------- |
| `LLM_HOST`         | LiteLLM proxy URL (shared with app)   | `http://localhost:4000/v1`         |
| `LLM_API_KEY`      | API key for LiteLLM                   | —                                  |
| `LLM_MODEL_NAME`   | Model for persona simulation          | `default`                          |
| `EVAL_BASE_URL`    | App URL for Playwright                | `https://interact-molt.vercel.app` |
| `EVAL_SIM_MODEL`   | Override model for persona simulation | falls back to `LLM_MODEL_NAME`     |
| `EVAL_JUDGE_HOST`  | LLM host for judging                  | falls back to `LLM_HOST`           |
| `EVAL_JUDGE_KEY`   | API key for judge                     | falls back to `LLM_API_KEY`        |
| `EVAL_JUDGE_MODEL` | Model for CDN judging                 | falls back to `LLM_MODEL_NAME`     |
| `EVAL_JUDGE_RUNS`  | Number of judge runs per session      | `1`                                |

---

# Replay: regression check for automated form changes

`pnpm eval:replay` replays recorded cases — a form, its intent, and the question,
answer or edit that came next — against the current prompts and model, and
reports how the automated changes behaved. Run it before and after a prompt or
model change; the second run is compared with the first.

It measures what the workshop pilot complained about
(`docs/decisions/2026-11-04-pilot-findings.md`): 5 of 112 answers to questions changed
fields their preview didn't show, and 8 of 11 participants said the tool made
changes they did not want.

```
replay/
  cases.ts               Case format (JSONL) and validation
  cases/seed.jsonl       11 committed cases built from tests/fixtures
  private/               Cases converted from study exports — gitignored
  from-fixtures.ts       Rebuilds cases/seed.jsonl
  from-study-export.ts   Study export (JSON) → cases
  execute.ts             Runs a case through the real action, measures it
  summary.ts             Roll-up, markdown, comparison with a previous run
  replay.eval.ts         The run (vitest, so the server actions can be imported)
run-replay.ts            CLI: loads .env.local, passes the flags on
packages/interact/src/forms/replay-metrics.ts The measures (pure, unit-tested)
```

## Running

```bash
pnpm eval:replay                                  # the seed cases (about 16 LLM calls)
pnpm eval:replay --limit 5                        # the first 5 cases
pnpm eval:replay --ops resolve-probe,sync-intent  # only these operations
pnpm eval:replay --cases tests/evaluation/replay/private/H7VTHW.jsonl
pnpm eval:replay --model <gateway-model-id> --fast-model <gateway-model-id>
pnpm eval:replay --compare tests/evaluation/results/replay-2026-11-10T09-00-00/results.json
pnpm eval:replay --offline                        # recorded previews only, no model calls
```

Other flags: `--concurrency n` (default 3), `--out dir`.

Each run writes `results/replay-<time>/results.json` (every case, with the
field keys behind each count) and `summary.md`, and prints the summary. It is
compared with the previous run (`results/replay-latest.json`) unless
`--compare` names another one. The comparison says "better" or "worse" per
metric; it is only meaningful for the same dataset.

The run calls the same server actions the app does. Auth and tracing are
stubbed (a script has no session, and replays shouldn't appear in Langfuse as
participant usage); the rate limit is off; the fixtures switch is ignored.

## Cases from a study session

1. On `/studies/<session>`, export the session (the JSON bundle).
2. Convert it:

   ```bash
   pnpm eval:replay:cases ~/Downloads/study-H7VTHW.json
   # → tests/evaluation/replay/private/H7VTHW.jsonl
   ```

3. `pnpm eval:replay --cases tests/evaluation/replay/private/H7VTHW.jsonl`

The converter makes one case per automated change in `provenance_log`, with
the form and intent as they were just before it:

| Provenance action | Case |
|---|---|
| `design_probe_resolved`, `design_probe_re_resolved` | `resolve-probe`; once per question also `preview-probe-options`, with the recorded previews and the final form as the later state |
| `schema_refined` | `refine-schema` (previous intent from the `intent_updated` row before it; earlier answers as decisions) |
| `intent_synced_from_edit` | `sync-intent` |
| `schema_generated` | `generate-probes`, on the form generation produced |

**Personal data.** The converter reads only portfolios, provenance and design
questions; it never copies participant ids, user ids, names, panel ids, events or
questionnaire answers, and it renumbers portfolios. What remains is what
participants typed into their forms — descriptions, labels, custom answers —
which can still identify someone. Converted cases belong in `replay/private/`
(gitignored); don't commit them or the export.

Cases are built from the export and not from Langfuse traces: a trace holds
the prompt as text, so it can't be replayed once the prompt is reworded, and
it lacks the later form states the spill measures need.

## Case format

One JSON object per line; lines starting with `//` are skipped.

```jsonc
{
  "id": "fitness-refine-reword",          // unique in the dataset
  "op": "refine-schema",                  // see below
  "source": "seed",                       // seed | fixture:<scenario> | study:<code>
  "note": "A rewording must not change the form",
  "input": { /* per operation */ },
  "expect": { "noFormChange": true }      // optional
}
```

| `op` | `input` |
|---|---|
| `preview-probe-options` | `intent`, `schema`, `probe { text, explanation?, options[{value,label}] }`, `laterSchema?`; plus top-level `recorded { options, selected }` from study exports |
| `resolve-probe` | `intent`, `schema`, `question`, `answer` |
| `refine-schema` | `previousIntent`, `intent`, `schema`, `decisions?` |
| `sync-intent` | `intent`, `schema`, `editDescription`, `kind` (`field-edit` or `design-decision`) |
| `generate-probes` | `intent`, `schema`, `existingQuestions?`, `strategies?` (default: `committee` and `prompted`, reported separately) |

`expect` states what must not happen: `mayChange` (the only existing fields
the change may alter or remove), `mustKeep`, `mayAdd: false`, `noFormChange`,
`purposeUnchanged`. Cases never store the model's answer.

## What is measured

| Measure | Meaning |
|---|---|
| skipped op share | Patch ops the form refused: unknown field keys, locked fields |
| ops on locked fields | Ops that tried to change a field the creator locked |
| …changing unmentioned properties | An existing field changed in a property its update left out, or an "add" overwrote a field whose key was taken. Should be 0 with partial updates |
| options changing fields their summary doesn't name | A preview's one-line summary shares no word with a field it touches (a heuristic) |
| replays spilling without / with scoping | A fresh preview replayed on `laterSchema` changes fields it didn't show — raw patch vs. scoped (`applyProbeOption`). "With scoping" must be 0 |
| recorded answers overwriting a field by add / spilling | The same for the previews participants actually picked, replayed on the form at answer time. No model call |
| cases with unwanted changes | Share of cases with an `expect` whose change touched a field it shouldn't |
| purpose kept verbatim / sentences lost | Every sentence of the purpose is still there after the edit, except the one a "replace" named |
| purpose changed against expectation | The purpose changed although `purposeUnchanged` was set |
| disagreement ops, mean vote entropy, unanimous ops | Committee: how many differences the drafts produced and how split they were (1 bit = even split) |
| fell back to prompted | The committee found too little and the model was asked directly |
| questions with ready previews | Questions that arrive with every answer's preview computed |
| latency, tokens, cached input share | Per case and per LLM call |

Unit tests: `tests/unit/replay-metrics.test.ts`, `tests/unit/replay-cases.test.ts`.
