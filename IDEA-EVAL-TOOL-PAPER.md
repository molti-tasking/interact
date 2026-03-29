# Adversarial Multi-Model LLM-as-Judge for UI Systems Research Evaluation

Based on this work, I had this idea:

## Abstract

Evaluating user interface systems research remains a persistent challenge. Olsen's seminal framework (UIST 2007) proposes analytical criteria---such as expressive match, expressive leverage, flexibility, and skill barrier reduction---as alternatives to traditional usability testing, but applying these criteria has remained a manual, subjective process performed by the authors themselves. We present an automated evaluation pipeline that operationalizes Olsen's criteria through adversarial multi-model LLM-as-judge assessment. Our approach addresses two key weaknesses of naive LLM-as-judge evaluation: positivity bias (models tend to score favorably when given a system description) and single-perspective blindness (one model's judgment may reflect training biases rather than genuine assessment). We mitigate these through three mechanisms: (1) multi-role adversarial prompting, where each model evaluates under neutral, skeptical, and comparative personas; (2) multi-model cross-validation, where models from diverse providers score independently; and (3) baseline anchoring, where the identical evaluation procedure is applied to established tools (e.g., Google Forms, Airtable) to produce a comparative reference point. The pipeline also conducts a structured limitation pass, asking each judge to identify specific weaknesses preventing a perfect score. We implement this as an open-source tool with Langfuse observability integration, structured JSON output, and automated LaTeX table generation. In a validation study evaluating a form design system against Google Forms and Airtable, six models across four providers produced consistent score distributions with meaningful differentiation between adversarial roles (skeptical judges scored 0.9 points lower on average), while maintaining a stable 2.2-point gap over baselines across all criteria. We argue that adversarial multi-model evaluation provides a reproducible, scalable complement to analytical arguments in systems research papers, and release the tool for community adoption.

---

## Reference Implementation

The current implementation lives in this project and serves as the technical foundation for the generic tool. Below is the architecture, key decisions, and what needs to change for generalization.

### Current Architecture

```
run-olsen.ts                    Orchestrator
  ├── judge-olsen.ts            LLM judge (multi-model × multi-role)
  │     ├── callLLM()           Raw fetch to OpenAI-compatible API (LiteLLM)
  │     ├── judgeCriterion()     Score one criterion with one model+role
  │     ├── getLimitations()    Limitation pass after scoring
  │     └── judgeBaseline()     Same prompt template, different system description
  ├── olsen-rubric.ts           Criterion definitions + prompt builders
  │     ├── olsenCriteria[]     4 criteria with anchors (hardcoded for this project)
  │     ├── JUDGE_ROLES[]       3 roles: neutral, skeptical, comparative
  │     ├── buildOlsenJudgingPrompt()   Main prompt template
  │     └── buildLimitationPrompt()     "What prevents a 5?" prompt
  ├── olsen-system-description.ts       System under evaluation (Malleable Forms)
  │     ├── SYSTEM_DESCRIPTION          Primary system
  │     ├── GOOGLE_FORMS_DESCRIPTION    Baseline 1
  │     └── AIRTABLE_DESCRIPTION        Baseline 2
  ├── langfuse-eval.ts          Langfuse tracing integration
  │     ├── logEvalGeneration() Log each LLM call with tags
  │     └── flushLangfuse()     Flush before exit
  └── Output files:
        ├── olsen-scores.json           Mean per criterion
        ├── olsen-per-model.json        Criterion × model matrix
        ├── olsen-per-role.json         Criterion × role matrix
        ├── olsen-limitations.json      Deduplicated limitation list
        ├── olsen-baselines.json        Baseline scores
        ├── olsen-scores-raw.json       Full per-model-role scores with reasoning
        ├── olsen-metrics.json          Token counts, latency, call counts
        ├── olsen-table.tex             LaTeX table for paper
        └── run-meta.json               Run config + Langfuse run ID
```

### Key Design Decisions (keep for generic tool)

1. **Adversarial multi-role prompting**: Each model scores under 3 roles with different preambles. The neutral role is standard; skeptical assumes missing features and scores conservatively; comparative discounts features that existing tools already provide. This produces a score distribution rather than a single biased number.

2. **Identical prompt template for baselines**: The exact same `buildOlsenJudgingPrompt()` function is used for the primary system and all baselines, with only `systemName` and `systemDescription` parameters swapped. This ensures scores are directly comparable.

3. **Limitation pass**: After scoring, each model is asked "What prevents a score of 5?" for each criterion it scored. This produces a structured weakness list without requiring the model to be critical during scoring (which could introduce anchoring effects).

4. **Crash resilience**: Results are saved incrementally after each model completes, so a crash mid-run doesn't lose all prior results.

5. **Langfuse integration**: Each LLM call creates a Langfuse trace with structured tags (`olsen:scoring`, `criterion:flexibility`, `role:skeptical`, `baseline:google-forms`). The run ID groups all calls for one evaluation. This provides full observability: prompts, responses, token usage, latency, and filtering by any dimension.

6. **LiteLLM as model router**: All models are called through a single OpenAI-compatible endpoint. The `model` field in the request body determines which provider handles the call. This means the tool works with any model accessible through LiteLLM without provider-specific code.

### What Needs to Change for Generalization

| Current (hardcoded)                         | Generic tool                                                                                                                          |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 4 Olsen criteria in `olsenCriteria[]`       | User defines criteria via UI/config. Olsen's criteria become a preset template. Support CDN, heuristic evaluation, custom frameworks. |
| System descriptions as TypeScript constants | User enters via web form or uploads markdown. Stored in Supabase.                                                                     |
| Baseline descriptions hardcoded             | User adds 0-N baselines via the same form.                                                                                            |
| 6 models in `JUDGE_MODELS[]`                | User selects from available models (auto-discovered from LiteLLM `/models` endpoint).                                                 |
| 3 roles hardcoded                           | User can customize role preambles or add new roles. Defaults provided.                                                                |
| CLI runner (`tsx run-olsen.ts`)             | Web UI triggers evaluation. Long-running task executes as background worker.                                                          |
| Results as JSON files                       | Results persisted to Supabase. Real-time progress via Supabase Realtime subscriptions.                                                |
| LaTeX output only                           | LaTeX + CSV + interactive dashboard.                                                                                                  |
| Single Langfuse project                     | User provides their own Langfuse keys (optional).                                                                                     |

### Proposed Data Model (Supabase)

```
evaluation_configs
  id, name, created_at, user_id
  framework: "olsen" | "cdn" | "custom"
  criteria: jsonb[]              -- {id, name, description, evaluationFocus, anchors}
  system_description: text       -- primary system under evaluation
  baselines: jsonb[]             -- [{id, name, description}]
  models: text[]                 -- ["anthropic/claude-sonnet-4-6", ...]
  roles: jsonb[]                 -- [{id, name, preamble}]

evaluation_runs
  id, config_id, started_at, completed_at, status
  langfuse_run_id: text
  metrics: jsonb                 -- {totalCalls, totalLatencyMs, totalTokens, ...}

evaluation_scores
  id, run_id, model, role, criterion_id
  score: int                     -- 1-5
  observations: text[]
  justification: text
  limitations: text[]
  metrics: jsonb                 -- {latencyMs, inputTokens, outputTokens}
  raw_response: text

evaluation_baselines
  id, run_id, baseline_id, model, criterion_id
  score: int
  observations: text[]
  justification: text
```

### Stack Recommendation

- **Frontend**: Next.js (App Router) + shadcn/ui + React Query
- **Backend**: Next.js API routes for CRUD, **BullMQ + Redis** for long-running evaluation jobs
- **Database**: Supabase (PostgreSQL + Realtime for live progress)
- **LLM routing**: LiteLLM proxy (user provides their own endpoint + key)
- **Observability**: Langfuse (optional, user provides keys)
- **Deployment**: Vercel (frontend) + Railway/Fly.io (worker) or self-hosted

### Why Not Serverless for the Worker?

One evaluation run = 6 models × 3 roles × N criteria × 2 passes (scoring + limitations) + baselines. For 4 criteria with 2 baselines: ~168 LLM calls taking ~25 minutes. Vercel Functions timeout at 300s (pro). The worker must run on a persistent process. BullMQ with Redis provides job queuing, retry on failure, and progress tracking. The frontend polls Supabase for real-time updates.

### Evaluation Presets

The tool ships with preset evaluation frameworks:

- **Olsen (2007)**: All 8 criteria from "Evaluating User Interface Systems Research"
- **CDN (Blackwell & Green)**: All 14 cognitive dimensions
- **Nielsen's Heuristics**: 10 usability heuristics
- **Custom**: User defines their own criteria

Each preset includes default anchors and evaluation focus prompts. Users can customize any preset before running.
