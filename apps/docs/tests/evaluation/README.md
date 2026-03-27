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
│    design probes based on persona profile             │
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

## Environment Variables

| Variable               | Description                           | Default                            |
| ---------------------- | ------------------------------------- | ---------------------------------- |
| `LLM_HOST`             | LiteLLM proxy URL (shared with app)   | `http://localhost:4000/v1`         |
| `LLM_API_KEY`          | API key for LiteLLM                   | —                                  |
| `LLM_MODEL_NAME`       | Model for persona simulation          | `default`                          |
| `EVAL_BASE_URL`        | App URL for Playwright                | `https://interact-molt.vercel.app` |
| `EVAL_SIM_MODEL`       | Override model for persona simulation | falls back to `LLM_MODEL_NAME`     |
| `EVAL_JUDGE_HOST`      | LLM host for judging                  | falls back to `LLM_HOST`           |
| `EVAL_JUDGE_KEY`       | API key for judge                     | falls back to `LLM_API_KEY`        |
| `EVAL_JUDGE_MODEL`     | Model for CDN judging                 | falls back to `LLM_MODEL_NAME`     |
| `EVAL_JUDGE_RUNS`      | Number of judge runs per session      | `1`                                |
| `EVAL_SKIP_SIMULATION` | Skip Phase 1, use cached artifacts    | `false`                            |

## Output

- `tests/evaluation/results/artifacts/` — JSON artifacts per session
- `tests/evaluation/results/cdn-scores-raw.json` — raw judge scores
- `tests/evaluation/results/cdn-scores.json` — aggregated scores
