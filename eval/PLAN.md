# Evaluation plan (EICS 2027)

**Status (2026-11-12):** written after exploring the code and before implementing anything. Phases 1–4 have not started.

- The claim audit is in `CLAIMS.md`.
- Decisions the authors must take before material is frozen are collected in Section 9. Items there are marked **[D#]** throughout.

## 1. Code map

Paths are relative to the repository root. `forms/` = `packages/interact/src/forms/` (the pure engine), `app/` = `apps/docs/src/`, `mig/` = `apps/docs/supabase/migrations/`.

| Concern | Where |
|---|---|
| Commit path | `mig/007_portfolio_revision.sql:51-115` (`commit_portfolio_change`); client loop `app/lib/engine/commit.ts:99-177`; decision guard `forms/decision-guard.ts`; revision on responses/log `mig/015_study_handoff_run_settings.sql:38-92` |
| Patch apply | `forms/schema-patch.ts:302-412` (`applySchemaPatch`); model vocabulary `forms/form-model.ts:72-108, 178-230` |
| Locks, scope, conflict-fix limits | `forms/guards.ts:64-148` (`protectLockedFields`), `:177-262` (`scopePatch`, `applyProbeOption`), `:269-327` (`applyConflictFix`) |
| Three-way merge | `forms/merge.ts:70-174` |
| Preview pre-computation | queue `app/hooks/query/design-probes.ts:399-481` (5 at once, priority order, wait ≤ 30 s); hook `:512-589`; server `app/app/actions/design-probe-actions.ts:~800-860` |
| Answer application / undo | `app/hooks/query/design-probes.ts:611-805`; gate `forms/probe-options.ts:187-212` |
| Question generation and selection | `design-probe-actions.ts:181-281` (strategy switch, committee), `forms/probe-disagreement.ts` (alignment, atomic changes, `composeProbes`) |
| Curation | `design-probe-actions.ts:~900-1050`, `forms/probe-curation.ts`, `design-probes.ts:224-370` |
| Conflict detection and fixes | `app/app/actions/conflict-actions.ts`, `app/hooks/query/conflicts.ts`, `forms/conflict-changes.ts` |
| Intent edit pipeline | `app/hooks/query/pipeline.ts`, `forms/structured-intent.ts:276-342`, `app/hooks/query/schema-generation.ts` |
| Intent sync after field edits | `app/hooks/query/intent-backpropagation.ts`, `design-probe-actions.ts:1107-1192`, `forms/purpose-edit.ts` |
| Derive | `app/app/actions/derive-actions.ts`, `app/app/(app)/portfolios/[id]/derive/page.tsx:100-130`, `app/hooks/query/portfolios.ts:194-242` |
| Rollback | `app/lib/engine/commit.ts:184-229`, `design-probes.ts:746-805` |
| Response storage | `submit_response` (`mig/011_study_mode.sql:268-310`), `app/hooks/query/public-form.ts:62`; versions `forms/response-versions.ts` |
| Initial generation prompt (for R) | `app/lib/schema-generation.ts:83-127`; `app/app/actions/schema-actions.ts:35-70` |
| Model, gateway, temperature | `app/lib/model.ts` (`LLM_HOST`, `LLM_API_KEY`, `LLM_MODEL_NAME`, `LLM_FAST_MODEL_NAME`), `app/lib/llm-temperature.ts` (temperature is dropped for Claude 5) |
| Route handler vs server actions | `app/app/api/llm/[op]/route.ts:32-42`; `app/lib/llm-client.ts` |
| Tracing | `app/instrumentation.ts`, `app/lib/telemetry.ts` (no input/output in production) |
| Study export | `app/hooks/query/study.ts:813-900` (`useStudyExport`); CSVs in `app/lib/study/export.ts`; analysis in the paper repo, `study/analyze_workshop.py`, `study/analyze_langfuse.py` |
| Record/replay | `app/lib/testing/fixture-{guard,loader,recorder}.ts`, `apps/docs/tests/fixtures/*`; replay evaluation `apps/docs/tests/evaluation/replay/*` (cases from study exports, spill metrics in `forms/replay-metrics.ts`) |

## 2. Inputs and what they can support

The raw exports are in `study/data/`. Until this commit that directory was **not git-ignored**. `.gitignore` now ignores `/study/data/` and `/eval/data/`.

The harness reads the exports from `EVAL_DATA_DIR`, which defaults to `eval/data/`; set it to `study/data` to use the current location.

**Study export** (`study-H7VTHW-2026-11-12.json`)
- **Contents:** 11 participants, 11 portfolios, 22 snapshots, 282 questions, 308 log entries, 109 responses, 3,737 events, 11 questionnaires. `run` is null: the pilot predates recorded run settings.
- **Unversioned responses:** all 109 responses have `schema_version = NULL`.
- **No preview scopes:** none of the 627 answer previews has a recorded `scope`.
- **No derived portfolios.**
- **Events that do not exist in the pilot:** `probe_shown`, `probe_preview_awaited`, preview-ready times, conflict-card shown, hover start.
- **Events that exist:** `option_previewed` (431, with a duration `ms`), `probe_answered` (167), `probe_expanded`, `field_saved`, `field_removed`, `fields_added`, `intent_applied`, `conflict_fixed`, `conflict_dismissed`, `probes_requested`.

**Langfuse export** (`…-lf-events-export-….csv`)
- **Contents:** 2,168 observations, 1,096 generations.
- **Pilot calls:** 771 generations carry a participant user id. All are on `anthropic/claude-sonnet-5`, 14:17–15:01 UTC, $7.59 in total.
- **Development traffic must be filtered out:** the rest are calls from 21–27 Oct.
- **No inputs or outputs:** every participant call has empty `input` and `output`. Prompts and outputs are therefore not recoverable from Langfuse; only operation, start and end times, tokens, cost and errors are.
- **Cost and median latency per operation in the pilot:**

| Operation | Mean cost | Median latency |
|---|---|---|
| preview | $0.016 | 7.3 s |
| on-demand resolve | $0.014 | 8.6 s |
| conflict detection | $0.010 | 18.1 s |
| intent sync | $0.003 | 3.0 s |
| refine | $0.017 | 10.0 s |

**What this means for the experiments**
- **E3:** the stub can return recorded *latencies* by operation. Recorded *outputs* exist only where the DB stored them: question texts and answer previews in `design_probes`, applied diffs in `provenance`. Conflict-detection outputs are not stored anywhere. E3's workload therefore uses counts from the DB (questions, answers, fixes) and does not depend on output content. This is recorded as a deviation.
- **E2 replay of the 5 pilot overruns:** the scope at preview time is not recorded, so it must be reconstructed (Section 6).

## 3. Environments, cost and privacy

- **Local stacks only.** Two isolated local Supabase stacks: *current* from this tree and *pilot* from the pilot worktree (Section 4C). Each gets its own ports and `E2E_*`-style variables. Ports 54321/54322 may belong to another project and are never used.
- **Settings file and refusals.** The harness loads `eval/.env.eval` (git-ignored) and **never** `apps/docs/.env.local`, which points at a hosted Supabase. It refuses to start when:
  - the Supabase URL is not loopback;
  - the gateway key has no budget, checked against LiteLLM `/key/info`;
  - Langfuse points at the production project. Eval runs use a separate Langfuse project, or tracing off with cost captured by the harness.
- **Cost.**
  - **How it is recorded:** every model call goes through a harness wrapper that records model id, settings, prompt hash, tokens, latency and gateway cost (the LiteLLM response cost when available, otherwise tokens × a frozen price table). The key's spend is also read before and after each experiment.
  - **Estimate at pilot prices:** E1 ≈ 3 scenarios × 8 requests × 5 runs × 3 pipelines, about 600 calls, ≈ **$15**.
  - **Budget (decided 2026-11-12):** the dedicated key is capped at $40. Two rules apply:
    - **After the dry run,** the harness projects the cost of the final runs from the dry run's recorded costs. If the projection exceeds **$30**, it stops and asks the authors before going on.
    - **Before each run** (one pipeline × one scenario × one repetition), it reads the key's remaining budget. If the projected cost of that run doesn't fit, it stops cleanly *between* runs, never mid-run. Every aborted or skipped run is logged with its reason in the run log and in `eval-summary.json`. This avoids the pilot's mid-session budget outage.
  - E2, E3 and all Phase 1 tests use stubs and cost $0.
- **Privacy.**
  - Participants are pseudonymized as P1–P11 in join order (as in `analyze_workshop.py`).
  - Committed fixtures hold no participant text. Field keys and labels from the pilot are replaced by stable tokens (`k1`, `k2`, …) per portfolio.
  - Cost-per-key messages (`ExceededBudget: User=…`) are reduced to their class.

## 4. Phase 1: system changes (each with tests, in separate commits)

### A. I6: versioned responses

**Already present:** the nullable `responses.schema_version`, stamped by a trigger, plus `provenance_log.revision` (migration 015). Pre-015 rows stay NULL and are reported as "unversioned". **No new column is needed.**

**Remaining work**
1. **Count:** a pure `affectedResponses(schema, patch, responses)` in `forms/response-versions.ts`. It counts responses with a non-empty answer under the key of each field that the patch removes, retypes or relabels.
   - Responses are keyed by field *name* (CLAIMS 17).
   - It covers `SchemaPatch` and `ConflictChanges`.
2. **Preview data:** the count goes into the data the preview renders.
   - **It is computed at display time**, from a per-field answer-count query. A count stored when the preview was made would go stale as responses arrive.
   - The displayed count is logged with `option_previewed`, so the E2 oracle can compare it to the true count.
3. **UI:** the answer tile and the canvas overlay show "affects N collected responses".
4. **Tests:** unit tests for the counter and the wording, and one Playwright test (a destructive answer on a form with seeded responses).

### B. Visible out-of-sync intent

1. **Migration 016:** `portfolios.intent_sync` JSONB (`{state: "pending" | "failed", reason, since}` or NULL).
   - It is written through a small RPC that does **not** bump `revision` (the trigger only reacts to `schema`/`intent`). It is not logged as a form change.
2. **Behaviour (`intent-backpropagation.ts`):**
   - Mark `pending` when a sync starts.
   - Mark `failed` with the reason class (budget, rate limit, timeout, other) on failure, and when still pending after `INTENT_SYNC_STALE_MS`, which is configurable, default 30 s.
   - Retry with exponential backoff (3 attempts, base 2 s, jitter).
   - Clear the flag only after a successful sync commit.
   - Today a sync is skipped when the purpose changed meanwhile. That case should re-queue the sync rather than drop it **[D9]**.
3. **UI:** a banner in the intent editor with the reason and a "Retry now" button.
4. **Tests:** injected gateway failures (budget, 429, timeout) through a stubbed `callLlm`, with fake timers for the backoff and the stale timeout.

### C. The pilot profile: a worktree of the pilot commit

**Choice:** run the pilot commit in a git worktree (`eval/.worktrees/pilot`, git-ignored) behind the same harness interface. Configuration flags are the fallback only, used if the worktree cannot run.

**Evidence for `a64d230`:**
- It was main's head from 2026-10-25 22:54 until 2026-11-08, and no commit on any branch is dated 26–27 Oct.
- All ten operation names in the pilot's Langfuse calls exist at `a64d230`.
- It has `MAX_CONCURRENT_PREVIEWS = 3` (`design-probes.ts:538`).
- It has no `Field.locked` and no preview scope.
- Its migrations run to 011, consistent with `closed_reason` (migration 012) being NULL for every pilot question.
- **Confirmed by Coolify's deployment history (2026-11-12) [D1].** The app is hosted on Coolify, which builds the repository's `Dockerfile` on a push webhook and applies migrations on container start.
  - The history shows `a64d230` deployed successfully on 25 Oct.
  - The next deployment, `5bb7995` on 8 Nov, failed, so the running container stayed on `a64d230`.
  - The one after that, `f757bed` on 11 Nov, succeeded.
  - **So the pilot session on 27 Oct ran `a64d230`.**
  - The export taken on 12 Nov already has the columns from migrations 012–015, all NULL for pilot rows. That is consistent: those migrations were applied when `f757bed` started.
  - Environment settings at the time (model, keys) are not in git. The pilot's model is known from Langfuse.

**Fidelity**
- **Same code:** client scheduling, engine and SQL are those of the pilot.
- **Different:**
  - The model is a stub in E2 and E3.
  - The DB is a local stack with migrations 001–011.
  - Next.js and browser timing are not reproduced; they are simulated in E3 (Section 7).
- **Before 9 Nov the engine lived in `apps/docs/src/lib/engine`,** so the pilot adapter imports from there.

**Spec mismatch to resolve** **[D2]**
- **The spec's pilot profile lists "full regeneration on intent edits".** At `a64d230`, the `full` strategy on a form with fields already ran a model *patch* merged by `mergePatchOntoLatest`. The export agrees: 9 `schema_refined` entries and no regeneration of an existing form.
- **The worktree reproduces what actually ran.** If the paper's sentence is kept, it needs rewording.

**Small refactors the harness needs (behaviour unchanged, each with a test)**
- Export the change functions of `useApplyProbePreview` and the derive page's projection assembly as pure functions. The headless harness then runs the exact code instead of a copy.
- Move the preview queue (`runPreviewTask`, `waitForProbePreview`) into a module that can be driven with fake timers.

## 5. E1: stability under change

**Material** (`eval/e1/scenarios/<scenario>/`)
- **Files:** `intent.md`, `base-schema.json` (generated once with the app's generation path, then frozen), `responses.json` (30 per scenario, seeded generator, keyed by field key like stored responses), `script.yaml` (about 8 requests; at least one derive followed by at least two base changes).
- **Gold specs:** one per request, `scope` plus `assertions`, with `reviewed: false`.
- **Freezing:** `eval/FROZEN.md` records the commit hash and a SHA-256 of the material and oracles. Every output records the material hash. `--final` refuses unless every spec is `reviewed: true` and the material matches the recorded hash.
- **Scenario texts:** the youth-soccer registration and the orthopedic record come from the current paper (`content/05-scenarios.tex`).
- **The sales scenario (decided 2026-11-12) comes from an earlier version of the paper.**
  - **Intent:** "I need a job application form for a sales representative".
  - **Draft change requests,** to be reviewed as gold specs by the authors (`reviewed: false`):
    1. Ask which industries the applicant has sold into, as a required choice.
    2. Require 2–5 years of B2B sales experience.
    3. Add a written screening question about a closed deal.
    4. Ask which sales territory the applicant can cover.
    5. Make an existing optional field (e.g. the cover letter) not collected. The field is picked from the frozen base schema once it exists, so this scenario's `script.yaml` is finalized only after `base-schema.json` is frozen.
    6. Derive a phone-screen form with only contact details, industry background and experience.
    7. After the derive, change the industry options to SaaS, fintech, healthcare, other.
    8. After the derive, add a LinkedIn profile URL.
  - Request 7 changes a field that request 1 creates, so its gold scope names that field by descriptor. The descriptor is resolved to a key at run time with the same alignment as the measures. This is recorded in the spec.
- **Field kinds (decided 2026-11-12, option a).**
  - All three pipelines use the model's seven field kinds, and the system is not extended for the evaluation.
  - Gold assertions for upload requests (e.g. the soccer proof of residency) check that a field capturing the item exists, of any kind.
  - The paper's "nine field types" gets a clause: the model proposes seven, and the creator sets file fields (CLAIMS 1).

**Pipelines.** All three use `LLM_MODEL_NAME = LLM_FAST_MODEL_NAME = anthropic/claude-sonnet-5` (decided 2026-11-12).
- The pilot made every call on that model, so "one model" stays literally true. Sonnet 5.5 appears in the Langfuse export only in development calls and is not used.
- The ids are recorded in every output.
- Temperatures are dropped for Claude 5, so the provider default applies and is recorded.

- **P: the real path.**
  - **How a request runs:** the request is a typed answer to a question. It gets a preview through the same function as `preview-probe-options`, with a scope. It is then applied through the extracted answer change function, `applyProbeOption`, and `commitPortfolioChange` against the local DB. The post-answer purpose sync runs as in the app.
  - **It needs a question to answer.** The proposal is a fixed carrier question ("Anything else to change on this form?"), versus the chat-edit request path **[D5]**.
  - **Derive** uses `deriveAction` and the extracted projection assembly.
- **W: whole-schema rewrite.**
  - **Input:** the model gets the current schema JSON, the same 7-kind field vocabulary, and the request, with the instruction to keep everything else unchanged and to keep existing keys.
  - **Commit:** the returned schema replaces the old one through `commit_portfolio_change`.
  - **Derive:** the same call, given the base schema and the scenario.
- **R: regeneration.**
  - **How a request runs:** the request is appended as a sentence to the intent's purpose, and the schema is regenerated with the initial-generation prompt.
  - **The regenerated schema replaces the old one** rather than going through `mergeRegeneratedSchema`, which is a Malleable Forms mechanism **[D6]**.
  - **Derive:** base intent plus the scenario sentence, then generation.

Each script runs 5 times per pipeline. Requests are applied in sequence within a run. All prompts are committed under `eval/e1/prompts/`, and their hashes are recorded.

**Measures** (definitions frozen with the material)
- **Alignment:** key-only and aligned (key, then label-token Jaccard ≥ 0.6 within a type family, maximum-weight matching).
- **Collateral changes.**
- **Bound responses:** with an explicit compatibility table in `eval/e1/compat.json`.
- **Fulfilment.**
- **Agreement:** canonical-schema equality over the 10 run pairs.
- **Link integrity:**
  - P: `derivedFrom` or same id.
  - W and R: key equality, which is generous to the baselines and is stated as such.
- **Cost and latency:** from the call wrapper.
- **Confidence intervals:** percentile bootstrap, 10,000 resamples, seed 1, resampling request-runs stratified by scenario. Per-scenario and per-request breakdowns.

**Model fixtures.** Every response is recorded to `eval/e1/fixtures/` (synthetic material, so it can be committed). `--offline` recomputes every E1 number from the fixtures.

## 6. E2: invariants under concurrency and failure

**Setup**
- **Tooling:** `fast-check` (new devDependency) under vitest. One command, `pnpm eval:e2`, with `--profile pilot|current|both`, `--sequences 1000` and `--seed`.
- **Sequences:** up to 50 operations, from the operation list in the spec.
- **Concurrency:** modelled as explicit interleavings. Each operation is split into steps (read, model wait, commit attempt), and the generator chooses the order.
  - A wrapper around the Supabase client can run another commit between `commitPortfolioChange`'s read and its RPC. This exercises the CAS without touching system code.
- **DB:** every sequence runs on a fresh portfolio in the profile's local stack, through the real `commit_portfolio_change`.

**Model stub**
- **Normal patches:** the pool is the patches recorded in E1 (committable).
- **Adversarial patches:** out-of-scope operations, operations on locked fields, key renames (an add under a new key with a remove of the old key, and conflict-fix renames), operations on deleted fields.
- **Gateway failures:** budget, 429, timeout, injected per call.

**Oracles,** checked after every step, as in the spec. Per-path definitions are needed for some:
- **I1:** one entry per commit; the entry's previous state equals the state read just before the commit; no state change without an entry. Portfolio *creation* and derive insert outside the commit function (CLAIMS 3). Whether creation counts as a change under I1 must be decided before freezing **[D7]**.
- **I2:** "apply" is the path's documented function:
  - answers: `applyProbeOption`
  - refine: `mergePatchOntoLatest` followed by the lock guard
  - conflict fixes: `applyConflictFix`
- **I6:** every response carries a revision, and the count logged with the preview equals the true count (needs Phase 1A).
- **Drift:** needs Phase 1B.

**Profile output.** I4, I5 and I6 report `--` for the pilot (the features do not exist there). For Drift in the pilot, the proposal is to report 0 %, because a failed sync was observably not shown, rather than `--` **[D8]**.

**Counterexamples.** They are shrunk by fast-check and stored as `eval/e2/counterexamples/<profile>-<invariant>-<seed>.json`.

**Violations in the current engine**
- Each is recorded in `eval/e2/VIOLATIONS.md`, with seed and shrunk counterexample, **before** any fix.
- Any fix goes in a separate commit with a regression test made from the counterexample.
- Expected candidates from the audit (they are hypotheses until the property tests confirm them):
  - unscoped finding answers (I5);
  - intent syncs dropped when the purpose changed meanwhile (I3);
  - automated key changes unbinding responses.

**Replay of the 5 pilot overruns**
1. **Identify them** with the paper's definition (`analyze_workshop.py:185-204`), ported to TypeScript. A test asserts the port reproduces "5 of 112" on the export.
2. **Reconstruct the schema at preview time** as the state at the question's creation. The log chain gives each intermediate state: each entry's `prev_schema`, then the final `portfolios.schema`.
3. **Compute the scope** as `patchScope(that state, patch)`.
4. **Apply** `applyProbeOption` to the schema just before the recorded resolution, and count a case as prevented when the touched keys ⊆ the previewed keys.
5. **Record the approximation in step 2 as a deviation.** Only pseudonymized skeletons (tokenized keys, no labels) are committed as fixtures.

## 7. E3: responsiveness on the pilot workload

**Plan: the spec's fallback, a discrete-event simulation (DES).** Driving the real scheduling in accelerated time is not feasible here:
- **Server-action queueing is in the browser.** Server actions are serialized by the Next.js client router per browser tab, which cannot be run headless in accelerated time without a browser.
- **The pilot logs lack the times the replay needs:** preview-ready and conflict-card times.

**How the real code still constrains the simulation.** The preview queues from both profiles (made drivable in Phase 1C) run under vitest fake timers on synthetic traces. The simulation's queue must match them exactly.

**Policies simulated**

| Policy | Pilot | Current |
|---|---|---|
| Background calls | one FIFO server-action lane per participant | through the route, in parallel |
| Previews | FIFO by creation, 3 at once | 5 at once, by priority, open question first |
| Click on a not-ready answer | on-demand resolve call in the lane | waits ≤ 30 s for the in-flight preview, then needs a second click |
| Conflict detection | unbounded | 30 s timeout, paused while applying |
| Question generation | server action | server action (unchanged) |

Both profiles keep the pilot's prompted questions.

**Inputs**
- **Per-participant timelines:** from the study export (question created, `option_previewed` with its duration, answer clicks, intent and field edits). How `option_previewed` timestamps relate to hover start is checked at `a64d230` before use.
- **Latencies:** from the 771 pilot calls, mapped to events by participant, operation and order where unambiguous. Otherwise sampled from the operation's distribution, with 10 seeded repetitions.

**Validation**
- **Targets:** 27–44 of 104 answers waited; 47 on-demand computations; foreground latency median 7.9 s and p90 17.0 s; ~94 s of waiting per participant.
- **Tolerance:** fixed before running, proposed at ±10 % for the medians and totals and inside the range for 27–44 **[D10]**.
- **What cannot be validated:** the conflict-card latency, because the pilot logged no card times. It is reported as simulated only.

## 8. Layout and commands

```
eval/
  README.md  PLAN.md  CLAIMS.md  DEVIATIONS.md  FROZEN.md
  vitest.config.ts        aliases @ → apps/docs/src, interact → packages/interact/src
  lib/                    env guard, call wrapper (cost/latency/prompt hash), bootstrap, tex writer
  profiles/{current,pilot}.ts   one harness interface over each engine
  e1/  scenarios/ prompts/ fixtures/ compat.json run.ts measures.ts
  e2/  ops.ts oracles.ts stub.ts counterexamples/ replay-overruns.ts
  e3/  timelines.ts des.ts validate.ts
  out/ eval-summary.json eval-numbers.tex
  data/ (git-ignored)   .worktrees/ (git-ignored)   .env.eval (git-ignored)
```

**Commands** (root `package.json`; proposed, not yet implemented)
- `pnpm eval:e1 [--final] [--offline]`
- `pnpm eval:e2 [--profile …] [--sequences n] [--seed s]`
- `pnpm eval:e3 [--reps 10]`
- `pnpm eval:report`: writes `eval-summary.json` and `eval-numbers.tex`, with exactly the macros in the spec. It is generated and never edited by hand. It fails if any macro is missing or `\tbd`.

Every output carries: git commit, model ids, settings, prompt hashes, material hash, seed, date and cost.

## 9. Decisions

### Open

1. **[D2]** The pilot did not regenerate the form on intent edits; it patched it. Reword the paper's "9 intent edits triggered a full-regeneration pass" and drop that item from the pilot profile? (CLAIMS, last section.)
2. **[D5]** P's free-text path: a fixed carrier question (proposed) or the chat-edit request path? Include the post-answer purpose sync (proposed: yes, it is part of the real path)?
3. **[D6]** R: replace the schema (proposed) or fold it in with `mergeRegeneratedSchema`?
4. **[D7]** Does portfolio creation or derive (an insert outside the commit function) count under I1?
5. **[D8]** Drift in the pilot: 0 % (proposed) or `--`?
6. **[D9]** Phase 1B: re-queue an intent sync that was skipped because the purpose changed meanwhile (proposed), or keep skipping it but mark the intent out of sync?
7. **[D10]** E3 validation tolerance (proposed above).

### Decided (2026-11-12)

- **[D1] Pilot commit:** `a64d230`, confirmed by Coolify's deployment history (Section 4C).
- **[D3] Third scenario:** the sales representative, from an earlier version of the paper. The intent and the draft requests are in Section 5.
- **[D4] Field kinds:** option (a), the model's seven kinds for all pipelines, with no system change (Section 5).
- **Model:** `anthropic/claude-sonnet-5` for both the main and the fast model, in all pipelines (Section 5).
- **Budget:** a $40 cap; stop and ask if the projection after the dry run exceeds $30; check the budget before each run and stop only between runs (Section 3).

## 10. Order of work

1. Phase 1: one commit per item, each with tests.
   - (a) refactors for the harness;
   - (b) I6 count, preview and UI;
   - (c) out-of-sync flag;
   - (d) pilot worktree and adapter.
2. E1 material and oracles, then **freeze and record hashes**, then the runs.
3. E2 oracles and generators, then **freeze**, then runs. Violations are recorded before any fix.
4. E3 simulation, validation against the pilot, then measures.
5. Report generation, `README.md`, `DEVIATIONS.md`.
