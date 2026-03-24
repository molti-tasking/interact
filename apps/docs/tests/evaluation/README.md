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
│    opinions based on persona profile                 │
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

1. **Playwright** — browser automation for persona simulation
2. **LLM API access** — for both persona decisions and CDN judging
   - Persona simulation: needs the app's LLM backend (LiteLLM proxy)
   - CDN judging: separate LLM calls (can use any model)
3. **Running app** — either local (`localhost:3000`) or deployed (`interact-molt.vercel.app`)
4. **Supabase access** — to read artifacts after simulation (provenance logs, opinion history)

## Running

```bash
# Against deployed app
EVAL_BASE_URL=https://interact-molt.vercel.app \
EVAL_JUDGE_MODEL=claude-sonnet-4-5-20250514 \
pnpm tsx tests/evaluation/run-evaluation.ts

# Against local app
pnpm tsx tests/evaluation/run-evaluation.ts
```

## Output

- `tests/evaluation/results/` — JSON artifacts per session
- `tests/evaluation/results/cdn-scores.json` — aggregated scores
- `tests/evaluation/results/cdn-table.tex` — LaTeX table for paper
