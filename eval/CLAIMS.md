# Phase 0 — Claim audit

Audit of the 21 statements in Section 3 of the harness specification against the code on branch `eics-eval` at `10f46bd`, 2026-11-12. No code was changed for this audit.

**Verdicts**
- **TRUE:** the code does what the statement says.
- **PARTIAL:** the code does part of it, or does it differently. The difference is stated.
- **FALSE:** the code does not do it.

Paths are relative to the repository root. Abbreviations:

| Short | Path |
|---|---|
| `DPA` | `apps/docs/src/app/actions/design-probe-actions.ts` |
| `DP` | `apps/docs/src/hooks/query/design-probes.ts` |
| `Deck` | `apps/docs/src/components/workspace/DesignProbeDeck.tsx` |
| `forms/` | `packages/interact/src/forms/` |
| `mig/` | `apps/docs/supabase/migrations/` |

In code, "probe" means "elicitation question".

## Summary

| # | Statement (short) | Verdict |
|---|---|---|
| 1 | Four intent sections with timestamps; nine field types; sections | TRUE (see note on what the model can produce) |
| 2 | Log entry contents | TRUE |
| 3 | JSONB in one row; one atomic commit function (I1) | PARTIAL |
| 4 | I2: proposal and application, skipped-operation report | PARTIAL |
| 5 | I3: compare-and-swap and three-way merge | PARTIAL |
| 6 | I4 locked fields; I5 preview scope | PARTIAL (I4 TRUE where flagged; I5 has gaps) |
| 7 | Derive: classification, projection, links; no propagation | PARTIAL (no propagation: TRUE) |
| 8 | Rollback is a new forward version | TRUE |
| 9 | 2–4 answers, a no-change answer, free text, nothing pre-selected, curation | PARTIAL |
| 10 | Draft-based (committee) selection | PARTIAL |
| 11 | Previews: source, hover, click commits, undo | PARTIAL |
| 12 | Per-section change detection | PARTIAL |
| 13 | Bounded intent edits; an intent edit reports changes and offers undo | PARTIAL |
| 14 | Findings from responses | PARTIAL |
| 15 | Conflict check | PARTIAL |
| 16 | Background calls bypass the queue; waiting; plain errors | PARTIAL |
| 17 | Responses are JSON keyed by field | TRUE (keyed by field *name*) |
| 18 | Unit tests; record/replay scenario tests | TRUE |
| 19 | Every model call traced with latency, tokens, cost | PARTIAL |
| 20 | Direct field reordering | TRUE |
| 21 | Questions are system-generated; field edits propagate to the intent | PARTIAL |

Further sections after the per-claim details:
- the two items the paper marks NOT YET IMPLEMENTED, one of which is half implemented;
- pilot facts checked against the raw exports, including one discrepancy that affects the pilot profile.

---

## 1. Four intent sections with per-section timestamps; nine field types; field sections — TRUE

**Evidence**
- **Intent sections:** `IntentSection { content, updatedAt }` and the sections purpose, audience, exclusions and constraints are at `forms/types.ts:218-228`. The JSONB conversion with a per-section `updatedAt` is at `mig/003_structured_intent.sql:6-12`.
- **Nine field types:** text, number, select, date, boolean, file, scale, reference and group are at `forms/types.ts:87-111`, with their zod schemas at `forms/types.ts:71-85`.
- **Sections:** `FieldGroup` (`forms/types.ts:200-212`) is a titled section holding `fieldIds`. A field is in at most one section (`forms/sections.ts`).

**Note: this matters for E1 gold specs and for any sentence about what the model can produce.**
- The model writes fields in a 7-kind vocabulary: `"string" | "number" | "boolean" | "date" | "email" | "select" | "scale"` (`forms/form-model.ts:72-80`). Patches add `"reference"` (`forms/schema-patch.ts:20-28`).
- **The model cannot create a `file` or a nested `group` field.** `coarseKind` maps both to `"string"` (`forms/schema-patch.ts:80-89`).
- The creator can choose `file` in the field editor (`apps/docs/src/components/workspace/FieldEditForm.tsx:39-47`). `group` and `reference` are display-only there (`:50-53`).
- No code path creates a nested group field at all.

## 2. Log entries record actor, action, layer, schema diff, optional rationale, previous intent and schema — TRUE

**Evidence**
- The table is defined at `mig/001_initial_schema.sql:17-30`.
- `prev_intent` became JSONB at `mig/003_structured_intent.sql:15-25`.
- The commit function inserts action, layer, diff, `prev_intent`, `prev_schema`, rationale and actor at `mig/007_portfolio_revision.sql:93-111`.
- The client builds `{action, layer, actor, rationale, diff}` at `apps/docs/src/lib/engine/commit.ts:134-148`.
- Two later columns:
  - `actor_user_id DEFAULT auth.uid()` (`mig/011_study_mode.sql:39-40`)
  - `revision`, stamped by trigger (`mig/015_study_handoff_run_settings.sql:40-41, 73-92`)

**Notes**
- **The diff covers the schema only** (`SchemaDiff`, `forms/types.ts:515-519`). An intent change has no structured diff; only `prev_intent` is stored.
- **Layer names:** the layer enum is `intent | dimensions | configuration` (`forms/types.ts:404-409`). Question answers are logged under the legacy name `dimensions` (`DP:643`).
- **An entry is written only when the change carries a provenance spec** (`commit.ts:138-148`, `007:93`). See claim 3.
- **Wave-2 handoff:** it copies another portfolio's entries, keeping their `prev_*`, and adds a `portfolio_derived` entry with `prev_intent`/`prev_schema` set to `NULL` (`mig/015_study_handoff_run_settings.sql:188-215`).

## 3. Intent and schema are JSONB columns of the same row; the commit is a DB function doing CAS, write and log append atomically (I1) — PARTIAL

**TRUE parts**
- `intent` and `schema` are JSONB columns of `portfolios` (`mig/001_initial_schema.sql:2-14`, `mig/003_structured_intent.sql:6-12`).
- `commit_portfolio_change` (`mig/007_portfolio_revision.sql:51-115`) does the following in one plpgsql call, which is one transaction:
  - `SELECT … FOR UPDATE` (`:68-71`)
  - a revision check that returns no row on mismatch (`:78-81`)
  - `UPDATE` with `revision + 1` (`:83-91`)
  - an insert into `provenance_log` with `prev_intent`/`prev_schema` taken from the locked row (`v_prev`), not from the client (`:93-111`)
- The client side is `commitPortfolioChange` (`apps/docs/src/lib/engine/commit.ts:99-177`).

**Where the code differs from "every change goes through one commit operation … exactly one log entry"**
1. **Zero or one log entry, not exactly one.**
   - `p_provenance` may be `NULL`, and then nothing is logged (`007:93`).
   - The client sends `NULL` when the change has no provenance, or when `always: false` and the diff is empty (`commit.ts:138-148`).
   - Example: an intent commit with no changed section passes `provenance: null` (`apps/docs/src/hooks/query/pipeline.ts:128-136`).
2. **The single commit path is a convention, not something the database enforces.**
   - Row-level security lets an owner `UPDATE` their portfolio row directly, including `schema` and `intent` (`mig/011_study_mode.sql:832-835`). The guard trigger protects only status, owner, space, base and projection (`011:324-347`).
   - Owners may also `INSERT` into `provenance_log` directly (`011:851-853`).
   - A trigger bumps `revision` on any direct update "for legacy code paths" (`007:31-49`).
   - In the app, `useUpdatePortfolio` excludes schema and intent only through its TypeScript type (`apps/docs/src/hooks/query/portfolios.ts:266-301`).
3. **Writes that do not use the commit function:**
   - **Portfolio creation** inserts intent and schema directly (`portfolios.ts:202-216`).
   - **Derive** inserts the derived schema at creation. It then commits an empty-diff `portfolio_derived` entry whose `prev_schema` already equals the new schema (`portfolios.ts:224-235`).
   - **Wave-2 handoff** (SQL) overwrites schema and intent with a plain `UPDATE` and inserts log rows itself (`mig/015_study_handoff_run_settings.sql:169-215`).
   - **Joining a study** creates portfolios in SQL (`mig/011_study_mode.sql:457`, `mig/014_study_briefs.sql:306, 323`).
4. **Related state is outside the transaction.** When an answer is applied, the question's status (`design_probes`) is updated in a separate request after the commit (`DP:651-656`).

## 4. I2: the LLM never writes the schema; patch in a fixed vocabulary; pure apply validating keys, skipping operations on missing fields, reporting skips — PARTIAL

**TRUE parts**
- `applySchemaPatch` is pure (`forms/schema-patch.ts:302-412`).
- It skips updates and removals of keys that do not exist and reports them in `skipped.updated` / `skipped.removed` (`:62-73, 331-342, 363-373`). Operations on locked fields are reported in `skipped.locked` (`:320-329`).
- The vocabulary is `SchemaPatch` (`:54-60`). The model-facing schema is `schemaPatchSchema` (`forms/form-model.ts:186`), converted by `toSchemaPatch` (`:178`).
- Question answers, intent refinement and chat edits all go through it.

**Differences**
1. **Not every model output is a patch.**
   - **First generation:** the model returns a complete field list (`apps/docs/src/lib/schema-generation.ts:83-127`, the streaming route). It is folded in by `mergeRegeneratedSchema` (`forms/schema-patch.ts:428-482`; `apps/docs/src/hooks/query/schema-generation.ts:114-125`).
   - **Derive:** the model returns included keys and new fields; code assembles the schema (`apps/docs/src/app/actions/derive-actions.ts:176-199`).
   - **Conflict fixes:** they use a second vocabulary, `ConflictChanges`, keyed by field **id**, with renames and section removal (`forms/conflict-changes.ts:156-243`, applied by `forms/guards.ts:269-327`).
   - **Voice edits:** a whole-schema three-way merge (`apps/docs/src/hooks/voice/useUtteranceProcessor.ts:293-308`).
   - **Column actions:** model-made `Field` objects are added directly (`apps/docs/src/app/(app)/responses/[portfolioId]/_components/column-prompt-dialog.tsx:151-181`).
2. **"Validates field keys" means only that the key exists.**
   - The camelCase key format is asked for in the prompt (`forms/form-model.ts:66, 97`) but not checked.
   - An `addFields` entry whose key already exists becomes an update (an upsert) instead of being rejected (`forms/schema-patch.ts:296-301, 352-361`).
3. **Not every skip is reported.** Duplicate adds in one patch (`:353`) and section placements for unknown or locked keys (`:396-399`) are dropped silently.

## 5. I3: patch from a pre-call snapshot applied to the state at commit time; CAS on revision; on conflict a three-way merge of base, proposal and latest — PARTIAL

**TRUE parts**
- **CAS:** the revision check is at `mig/007_portfolio_revision.sql:78-81`. On a mismatch the client re-reads and re-runs its change function on the fresh state, up to 4 times, then throws `PortfolioConflictError` (`commit.ts:99-177`).
- **Re-apply on current state:** answers are re-applied to the current state (`DP:633-649`).
- **Three-way merges** exist (`forms/merge.ts:70-130` schema, `:138-147` patch onto latest, `:159-174` intent). They are used by:
  - intent refinement (`apps/docs/src/hooks/query/schema-generation.ts:178-196`, policy "theirs")
  - chat edits (`apps/docs/src/components/workspace/ChatEditPane.tsx:151-152`)
  - voice edits (`useUtteranceProcessor.ts:300-301`)
  - undo of an applied answer (`DP:765-771`)
  - creator intent edits (`pipeline.ts:96-100`, policy "ours")

**Differences: there is no single conflict rule.** What happens on a stale revision depends on the call site:
- **Answers and conflict fixes** re-apply their patch to the latest state, with no base (`DP:633-637`; `apps/docs/src/hooks/query/conflicts.ts:232-243`). This is a two-way replay, not a three-way merge.
- **Intent sync** after a field edit is **dropped** if the purpose changed meanwhile (`apps/docs/src/hooks/query/intent-backpropagation.ts:80-84`).
- **`revertCommit` refuses** if anything changed since (`commit.ts:189-190`).
- **The merge policy differs:** "theirs" for refinement, "ours" for intent edits.
- **After 4 stale attempts the change fails** with an error.

## 6. I4 (locked fields) and I5 (preview scope) — PARTIAL

**I4 holds for every commit flagged `automated: true`.**
- `commitPortfolioChange` runs `protectLockedFields` on the proposed schema when `automated && schema` (`commit.ts:120-124`). The guard is at `forms/guards.ts:64-148`.
- **Restoration:** changed locked fields are restored, removed ones come back, renamed keys are undone, and the section is kept.
- **Position:** a locked field keeps the field it followed (`:100-110`), so its absolute index can shift. Position-only changes are not reported (`:144-145`).
- `applySchemaPatch` also skips locked fields (`forms/schema-patch.ts:320-329`), and so does `applyConflictFix` (`forms/guards.ts:274-311`).
- **Call sites flagged automated:**
  - answers (`DP:641`)
  - generation and refinement (`schema-generation.ts:124, 194`)
  - exclusions (`pipeline.ts:112`)
  - conflict fixes (`conflicts.ts:243`)
  - chat edits (`ChatEditPane.tsx:163`)
  - voice edits (`useUtteranceProcessor.ts:308`)
- **The guard is opt-in per call site.** Column actions add model-made fields under `trigger: "field-edit"` without `automated` (`column-prompt-dialog.tsx:168`). In practice they only add fields with unused keys, so they cannot alter a locked field.

**I5: the scope is recorded and enforced, but not for every source.**
- **Where scope is recorded:** a preview records `scope = {added, updated, removed}` when it is computed:
  - prompted previews and typed answers (`DPA:852-857`)
  - committee previews (`forms/probe-disagreement.ts:411, 422`)
  - pretest previews (`forms/pretest.ts:235-240`)
- **Where it is enforced:** `applyProbeOption` drops operations outside the scope (`forms/guards.ts:177-226, 244-262`). The same function serves the canvas preview, the optimistic update and the commit (`ProbeCard.tsx:180-181`, `DP:712-716`, `DP:633-637`).
- **Gaps:**
  - **Questions from response findings** carry previews without `scope` (`forms/findings.ts:346, 369-510`), so they apply **unscoped** (`forms/guards.ts:249-251`). The same holds for previews stored before scoping existed (`forms/types.ts:448-453`). None of the 627 answer previews in the pilot export has a scope.
  - **Dropped operations are not logged.** `applyProbeOption` returns `dropped`, but the answer path discards it (`DP:634`).

## 7. Derive: sub/super/mixed; base and projection stored; inherited fields link to base fields; propagation — PARTIAL

- **Classification is the model's label, not computed.**
  - It is `derivationType: z.enum(["sub","super","mixed"])` in the model output (`apps/docs/src/app/actions/derive-actions.ts:61-66`).
  - The only deterministic rule: "super" includes every base field (`:176-179`).
  - Nothing checks that the label matches the result. A "sub" may still get new fields (`:188-199`).
- **Stored projection:** `{type, scenarioIntent, includedFieldIds, additionalFields, fieldMappings: {}}` (`apps/docs/src/app/(app)/portfolios/[id]/derive/page.tsx:105-113`; type at `forms/types.ts:566-582`). It is stored with `base_id` (`page.tsx:115-129`). `fieldMappings` is always empty.
- **Links:**
  - Inherited fields are copies with the **same id** as the base field, plus `derivedFrom: <base id>` (`derive-actions.ts:180-186`).
  - Lineage code links by id equality through `includedFieldIds` (`forms/response-rows.ts:83`). Nothing reads `derivedFrom` for derived portfolios.
- **Base changes do not propagate to derived portfolios. TRUE, as the paper assumes.**
  - No code re-syncs a derived schema. The derivation banner only shows the lineage (`apps/docs/src/components/workspace/DerivationBanner.tsx:32-110`).
  - What does flow is base **responses**: they are projected into the derived view when read (`apps/docs/src/hooks/query/responses-lineage.ts:25-59`; `forms/response-rows.ts:48-61`).
- **The derived schema is written at insert, not through the commit function** (claim 3).

## 8. Roll back creates a new forward version — TRUE

- **Undo** calls `revertCommit` (`commit.ts:184-203`; action `change_reverted`). **Restore to a history entry** calls `restoreSnapshot` (`commit.ts:210-229`; action `snapshot_restored`). Undo of an applied answer replays the inverse with a merge (`DP:746-778`).
- All three go through `commit_portfolio_change`, which bumps `revision` and appends a log row (`007:83-111`). No code deletes provenance.
- **Notes:**
  - `revertCommit` refuses when anything changed since the commit.
  - It restores `previous.schema` as stored, so the in-schema `version` counter goes back while `revision` goes forward (`commit.ts:193`). `restoreSnapshot` bumps `version` (`:219`).

## 9. 2–4 predefined answers including a "no change" answer, plus free text; none pre-selected; curation ranks and retires — PARTIAL

**The 2–4 bound is enforced only for committee questions.**
- **Committee:** at most 3 changing answers plus the unchanged one (`forms/probe-disagreement.ts:454, 499-502`). Questions with fewer than 2 answers are dropped (`:503`).
- **Prompted questions:** "2-4 options" appears only in the prompt (`DPA:501`). The output schema has no min or max (`DPA:111-116`), and the result is not filtered (`DPA:534-552`).
- **Follow-up questions:** prompt only (`DPA:805`). A follow-up is kept with any number of options (`DPA:859`).
- **Curation additions:** at least 2 options, no maximum (`DPA:1049`).
- **Result:** with the unchanged answer added, a prompted question can have 5 answers.

**The no-change answer is guaranteed, not just "typical".**
- Every insert goes through `storedOptions` (`DP:77-93`), then `prepareProbeOptions` and `ensureUnchangedOption` (`forms/probe-options.ts:71-103, 145-161`). That gives exactly one "Keep the form as it is" answer.
- The answer order is shuffled once and stored (`forms/probe-options.ts:160`).

**Free text and pre-selection: TRUE.**
- Free text is offered as "Write your own answer…" (`apps/docs/src/components/workspace/ProbeCard.tsx:280-288`).
- Nothing is pre-selected: `selected_option` is `null` on insert, and the tiles share one style (`ProbeCard.tsx:120, 413`).

**Curation: TRUE.**
- A model returns keep and priority per open question (`DPA:917-928`). `planProbeCuration` retires the rejected ones and anything beyond `MAX_OPEN_PROBES = 6` (`forms/probe-curation.ts:15, 42-90`).
- Retired questions get `status = dismissed, closed_reason = curated` (`DP:276-283`).
- Curation runs 4 s after a form change (`DP:313, 321-370`) and after intent edits (`pipeline.ts:185-201`).
- Standard, data and pretest questions are never curated (`DP:139`).

## 10. Draft-based selection (query-by-committee) — PARTIAL

- **(a) Four drafts with different emphases: partly.**
  - The default is 4 (`PROBE_COMMITTEE_SIZE`, clamped to 2–6; `DPA:295`), at temperature 1 (`DPA:343`).
  - **The first draft has no emphasis:** `COMMITTEE_LENSES[0]` is `""` (`DPA:303-310`).
  - At least 2 drafts must succeed (`DPA:401`).
  - The temperature is dropped for Claude 5 models (`apps/docs/src/lib/llm-temperature.ts:18-23`), so on the pilot's model the drafts differ only through the lenses.
- **(b) Drafts aligned with the current form: TRUE.** A field matches on the same key or on token Jaccard ≥ `SAME_FIELD = 0.6` (`forms/probe-disagreement.ts:111, 190-246`).
- **(c) Atomic changes counted by drafts: TRUE.** The kinds are `add | remove | required | options` (`:46, 262-340`), and locked fields are skipped (`:281`).
  - For required and options changes, only drafts that kept the field vote (`:304, 334`).
  - Changes are ranked by vote entropy and capped at 14 (`DPA:297, 403`).
- **(d) A model groups the changes into questions: TRUE** (`DPA:406-434`).
- **(e) "Each change belongs to exactly one question": no, at most one.**
  - `composeProbes` (`forms/probe-disagreement.ts:456-524`) drops unknown or already-claimed refs (`:478`).
  - It does not check that every change is used, and the prompt says "skip a change that isn't worth a question" (`DPA:417`).
  - Questions beyond `max` are cut, and their changes go unasked (`:521-523`).
  - A keep-as-is answer *is* guaranteed (`:499-502`).
- **(f) Fallback and the dialog: partly.**
  - **When the committee runs:** only when `PROBE_STRATEGY !== "prompted"`, the form has fields, and there is no typed guidance and no accepted standard (`DPA:181-183, 245-250`).
  - **When it falls back to prompted:** when the committee yields fewer than `min(2, maxProbes)` questions (`DPA:257`).
  - **No fallback when the grouping call fails:** the whole action returns an error (`DPA:275-281`).
  - **"Generate questions" dialog:** with an empty prompt it uses the **committee**; only with typed guidance or accepted standards does it use the prompted path (`Deck:521-543, 957-1027`).

## 11. Previews: source, hover, click commits without generation with question and answer as rationale, undo — PARTIAL

- **(a) TRUE.**
  - Committee answers build their patch from the drafts' field definitions (`forms/probe-disagreement.ts:175-184, 377-424`) and are stored as `ready` (`DPA:452`).
  - Prompted answers get a background `preview-probe-options` call (`DP:546`). The unchanged answer is excluded from that call (`DP:553-555`).
- **(b) TRUE.**
  - Hover or focus shows the change on the canvas (`ProbeCard.tsx:460-465, 524-527`; `apps/docs/src/components/workspace/ArtifactPane.tsx:270-280`).
  - The canvas shows New/Changed/Removed badges with what changes (`apps/docs/src/lib/form-renderer/FormRenderer.tsx:184-206, 325-338`).
  - Changes to existing fields are listed first (`ProbeCard.tsx:586-588`).
- **(c) Partly.**
  - **Ready preview:** the click commits the stored patch through `applyProbeOption` with no schema generation (`DP:633-649`).
  - **Rationale:** `"<question>" → "<answer label>"` (`DP:646`).
  - **Difference 1: a model call follows the commit.** A purpose re-sync call (`Deck:298-299` → `intent-backpropagation.ts:66`) runs after every applied answer and may rewrite the purpose.
  - **Difference 2: a not-ready preview is not applied on the click.** The click waits for the preview, shows it, and asks for a second click (`Deck:420-433`).
  - A follow-up question stored with the preview is inserted (`DP:659-680`).
- **(d) TRUE.** "Undo" on the 8 s toast (`Deck:301-324`) replays the inverse change, reopens the question and withdraws its follow-up (`DP:746-805`).

## 12. Per-section change detection by hash — PARTIAL

- **Hashing: TRUE.** `hashSection` (`forms/structured-intent.ts:28-34`) is compared per section in `computeDelta` (`:276-290`). `determinePipelineStrategy` is at `:303-342`.
- **Purpose or audience changed: TRUE.** This gives strategy `full`.
  - On a form with fields, `full` asks the model for a **patch**, merged with `mergePatchOntoLatest` (`pipeline.ts:166-208`).
  - Only an empty form is generated from scratch (`pipeline.ts:212`; `structured-intent.ts:309-311`).
- **Exclusions changed: TRUE, with one exception.** Deterministic removal (`pipeline.ts:102-122`; `filterExcludedFields`, `structured-intent.ts:444-477`). **But removing an exclusion term switches to `full`** (`:330`).
- **Constraints changed: no targeted recheck.** The strategy is `recheck-constraints`, which does nothing itself (`pipeline.ts:149-152`). It relies on the general conflict check, which re-runs on any change to schema or intent (`apps/docs/src/hooks/query/conflicts.ts:41-53, 97`). That check is not targeted at constraints and can be switched off (`?skipConflicts`, `:92`).
- **"Otherwise nothing happens": not quite.** Several non-core sections changing together gives `full` (`structured-intent.ts:340-341`). Only "no change" gives `noop`.

## 13. Bounded intent edits; an intent edit reports what changed and offers undo — PARTIAL

**Bounded edits: TRUE, for the purpose section only.**
- `applyPurposeEdit` (`forms/purpose-edit.ts:63-95`) appends one sentence or replaces one sentence quoted verbatim, deterministically.
- A replace whose target is missing appends instead (`:76-93`). New text is capped at 400 characters (`:41`).
- It is used for:
  - question answers (`DPA:712`)
  - field-edit sync (`DPA:1175`)
  - conflict fixes (`apps/docs/src/app/actions/conflict-actions.ts:532`)
- Other sections are never edited by the model.

**Report and undo after an intent edit: partly.**
- **When the toast appears:** only when the edit went through the refine path, the form already had fields, and the form diff is non-empty (`apps/docs/src/components/workspace/ReflectiveConversationPane.tsx:156-167`; `formCommit` is set only at `pipeline.ts:203-208`).
- **What it reports:** the form change as counts ("N added, M changed, K removed"), not the intent change.
- **What Undo reverts:** the form change only. The `intent_updated` commit stays.
- **When there is no toast:** exclusion filtering, first generation, and constraint edits.

## 14. Response findings — PARTIAL

**What exists**
- **Kinds and thresholds** (`forms/findings.ts:18-42`, detectors `:73-160`; nothing below 20 responses):
  - `mostly-skipped`: optional field, ≥ 70 % empty.
  - `unused-option`: a select with ≥ 3 options, one option never chosen.
  - `dominant-answer`: one answer ≥ 95 %.
  - `unknown-values`: ≥ 3 answers and ≥ 5 % not among the options.
  - `out-of-range`: ≥ 3 numbers and ≥ 5 % outside the range.
  - `text-themes`: a model call, only on request (`:171-340`).
- **How findings become questions:** they are templated, with 2–3 answers (`:358-514`).

**Differences**
- **There is no "values in an unexpected format" check.** The closest are `unknown-values` and `out-of-range`.
- **Findings reach the deck automatically only in study mode** (`apps/docs/src/app/(study)/study/[sessionId]/_components/refine-view.tsx:150-193`). In the app the creator sends them ("Ask in Design", `findings-panel.tsx:238, 299`).
- **Their previews carry no scope** (claim 6).

## 15. Conflict check — PARTIAL

- **(a) TRUE.** Deterministic checks for duplicate keys and orphaned section references (`conflict-actions.ts:185-249`), plus a semantic check on the fast model (`:296-309`).
- **(b) Only model conflicts are capped at 4** (`:321`). Deterministic conflicts are added without a cap (`:335`).
- **(c) Fixes may change or remove only the named fields, but they may add new fields** (`forms/guards.ts:264-311`). This applies to both preview and commit (`ConflictCard.tsx:108-109`, `conflicts.ts:234-238`).
- **(d) Short references (`f1…fn`) are used only in the detection prompt** (`conflict-actions.ts:257-262, 317-325`). The fix-preview and resolve prompts cite full `[id]`s (`:380-398`).
- **(e) The 30 s timeout covers detection only** (`DETECT_TIMEOUT_MS`, `:131, 306-307`, with one retry under the same timer).
  - On timeout, only the deterministic results are returned, marked `partial` (`:311-313, 337-340`). The client retries after 60 s (`conflicts.ts:58, 115-122`).
  - Fix previews have no explicit timeout; the route allows 120 s (`apps/docs/src/app/api/llm/[op]/route.ts:30`).

## 16. Background calls bypass the serialized action queue; a click waits for an in-flight preview; plain-language gateway errors — PARTIAL

- **Route handler, not all calls.**
  - Through the route handler (`route.ts:32-42`): previews, voice resolve, curation, intent sync, conflict detection, fix previews, simulated respondents, answer themes, chat edits.
  - **Still server actions:**
    - question generation, both the dialog and the automatic run (`DP:183`)
    - intent refinement (`schema-generation.ts:165`)
    - "add a field" (`AddFieldInline.tsx:46`)
    - the voice router
    - dashboard, column and derive actions
- **Preview queue:** at most 5 at once (`DP:408`). The order is priority, then newest (`DP:420-422`). The open question goes first (`DP:456-462`). Fix previews are unbounded (`conflicts.ts:156`).
- **Waiting: TRUE, within one browser tab.** `waitForProbePreview` waits up to 30 s (`DP:469-481`), but only for a preview started in the same tab. Otherwise a toast says it cannot be previewed yet (`Deck:437-440`).
- **Plain errors: three cases only.** `llmErrorMessage` (`apps/docs/src/lib/model.ts:162-183`) rewrites budget, rate-limit and timeout errors. Every other gateway error is shown as its raw message. A 401 becomes "signed out" (`apps/docs/src/lib/llm-client.ts:29-35`).

## 17. Responses are stored as JSON keyed by field — TRUE (keyed by field *name*)

**Evidence**
- The renderer keys answers by `field.name` (`FormRenderer.tsx:589, 745`).
- Answers are submitted through `rpc("submit_response")` (`apps/docs/src/hooks/query/public-form.ts:62`). The function stores the JSON object as given (`mig/011_study_mode.sql:268-310`).

**Notes for "continuable":**
- **Responses are keyed by name, while diffs, derivation links and the lock guard use field ids.** An automated key change (an upsert by a new key, a conflict-fix rename) unbinds earlier answers.
- **Recoding rewrites stored answers in place** (`apps/docs/src/hooks/query/recode.ts:40-70`).

## 18. Pure schema operations have unit tests; end-to-end scenario tests record and replay model responses — TRUE

**Evidence**
- **Unit tests:**
  - `apps/docs/tests/unit/{schema-patch,merge,guards,structured-intent,sections,purpose-edit,probe-disagreement,probe-preview,decision-commit}.test.ts`
  - `packages/interact/tests/*.test.ts`
- **Record/replay:** `fixtureGuard` (`apps/docs/src/lib/testing/fixture-guard.ts:14-52`) with `USE_FIXTURES` / `RECORD_FIXTURES`.
  - Calls are matched by selected answer label, prompt hint, then recording order (`fixture-loader.ts:105-129`).
  - Scenarios are in `apps/docs/tests/fixtures/*`. The Playwright specs are `apps/docs/tests/e2e/{designer-workspace,study-briefs,study-workshop}.spec.ts`.

**Notes**
- **Fixtures hold server-action results, not raw model responses.** Failed calls are not recorded.
- **There are no property-based tests.** `fast-check` is not a dependency.

## 19. Every model call is traced with latency, tokens and cost — PARTIAL

**TRUE parts:** every `generateText`/`streamText` call passes `experimental_telemetry` (e.g. `apps/docs/src/app/api/llm-stream/generate-schema/route.ts:91`), exported to Langfuse via OpenTelemetry (`apps/docs/src/instrumentation.ts:9-23`).

**Differences**
- **Whisper transcription is not traced** (`apps/docs/src/lib/voice/transcribe-server.ts:21`).
- **The app never computes or records cost.** Spans carry token usage, and cost comes from Langfuse's price table.
- **Production traces record no inputs or outputs by default** (`apps/docs/src/lib/telemetry.ts:15-21`). In the pilot's Langfuse export, all 771 participant calls have empty `input` and `output`.

## 20. Fields can be reordered directly — TRUE

**Evidence**
- Drag uses a handle, and the arrow keys work on that handle (`FormRenderer.tsx:262-285, 377-394`).
- The move is committed as `field_moved` with `trigger: "field-edit"` (`ArtifactPane.tsx:172-208`; `forms/sections.ts:183, 211`).

**Notes**
- It is unavailable while an answer preview is shown (`ArtifactPane.tsx:530`).
- It is hidden on touch screens (`FormRenderer.tsx:393`).

## 21. Questions shown are system-generated; a direct field edit propagates back into the intent — PARTIAL

**(a) TRUE in the sense that no question is hand-authored by researchers. Several are produced by rules, not by a model:**
- standards ("Apply standard: …?", `DP:902-920`)
- response findings (`forms/findings.ts:358-514`)
- pretest issues (`forms/pretest.ts:274-344`)

Wave-2 handoff copies the previous author's *answered* questions as history (`mig/015_study_handoff_run_settings.sql:173-186`).

**(b) Partly.** A field save, removal or addition schedules a sync, debounced by 2 s (`intent-backpropagation.ts:13, 118-133`; `PortfolioWorkspace.tsx:125, 155, 189`).
- **What it updates:** one bounded `purposeEdit` from the fast model (`DPA:1107-1192`), applied to the **purpose only**. It is logged as `intent_synced_from_edit` by `system`.
- **It is skipped** if the purpose changed meanwhile (`intent-backpropagation.ts:80-84`).
- **Failures are silent:** a `console.error` only, with no retry, no stored flag and no indicator (`:73-76, 107-109`). This is the eventual-consistency gap the paper marks as pending.
- **It is off** when `capabilities.intentPortfolio` is false.

---

## Items the paper marks NOT YET IMPLEMENTED

### I6 (versioned responses): half implemented

**Already present (the first half)**
- `responses.schema_version` is stamped with `portfolios.revision` by a `BEFORE INSERT` trigger on every insert path (`mig/015_study_handoff_run_settings.sql:38-69`), and `provenance_log.revision` likewise (`:40-41, 73-92`). Older rows are `NULL`.
- `FormResponse.schemaVersion` is at `forms/types.ts:420-424`.
- The findings panel already lists fields whose wording, type or options changed after answers were collected (`forms/response-versions.ts`).

**Missing:** the affected-response count in the preview of a destructive patch, and its display. The paper's wording "not yet implemented" therefore overstates the gap.

**All 109 pilot responses are unversioned** (`schema_version` is NULL), because migration 015 came after the pilot.

### Out-of-sync intent: not implemented

There is no flag, column or indicator anywhere (no `intentOutOfSync`, `syncError` or similar). See claim 21(b).

---

## Pilot facts checked against the raw exports

Exports used: `study/data/study-H7VTHW-2026-11-12.json` and `study/data/1793747672492-lf-events-export-….csv`. Only counts are reported here.

| Paper statement | Export | Note |
|---|---|---|
| Session H7VTHW, 11 participants, 2026-10-27 | 11 participants. Phases ran 14:17–15:06 UTC. | Matches. |
| 771 model calls, all `anthropic/claude-sonnet-5` | 771 generations attributed to participants, 14:17–15:01 UTC, all on that model | Matches. **The Langfuse file holds 1,096 generations in total**, including development traffic from 21–27 Oct (150 of them on `claude-sonnet-5-5`). The harness must filter by participant user id. |
| 50 calls failed on a budget cap within ~100 s; 25 were intent syncs | 50 `ExceededBudget` errors in 102.5 s: 25 intent sync, 13 conflict detection, 5 add field, 5 curation, 2 fix preview | Matches. |
| "9 intent edits triggered a full-regeneration pass" (wording in the harness spec only; the paper now says "a model call that proposed a patch against the whole schema, unrestricted in which fields it could change") | 9 `schema_refined` log entries and 9 `schema-refine` calls | **The new wording matches the code.** At the pilot commit, the `full` strategy on a form with fields ran `useRefineSchema`: a model *patch* merged by `mergePatchOntoLatest`, with no limit on which fields it could touch (`git show a64d230:apps/docs/src/hooks/query/pipeline.ts`, lines 154–170). The other 11 `schema_generated` entries are first generations. Counts are below. |
| 5 of 112 matched answers changed fields beyond their preview; 27–44 of 104 answers waited | Not recomputed in this phase | They are computed by `study/analyze_workshop.py:185-204` and `study/analyze_langfuse.py` in the paper repository. **None of the 627 pilot answer previews has a recorded scope.** E2 and E3 reuse these definitions (see PLAN.md). |
| Locks, scope, committee, bounded purpose edits came after the pilot | `Field.locked` is absent at `a64d230`; `MAX_CONCURRENT_PREVIEWS = 3` at `a64d230:apps/docs/src/hooks/query/design-probes.ts:538` | Consistent. |

### The 9 pilot intent refinements, counted

Source: the `diff` of each `schema_refined` entry in the study export. The diff is computed against the database state at commit time, so it counts what landed. The model's raw proposals were not recorded. Pseudonyms are P1–P11 in join order. Times are UTC on 2026-10-27.

| Entry | Participant | Time | Fields before | Added | Changed | Removed |
|---|---|---|---|---|---|---|
| 1 | P4 | 14:20:01 | 5 | 6 | 0 | 0 |
| 2 | P4 | 14:22:13 | 10 | 0 | 1 | 1 |
| 3 | P9 | 14:22:22 | 2 | 10 | 0 | 0 |
| 4 | P3 | 14:23:23 | 4 | 1 | 0 | 1 |
| 5 | P9 | 14:23:39 | 12 | 4 | 0 | 0 |
| 6 | P3 | 14:24:39 | 5 | 0 | 0 | 0 |
| 7 | P9 | 14:25:27 | 16 | 0 | 2 | 0 |
| 8 | P9 | 14:53:46 | 13 | 2 | 0 | 0 |
| 9 | P11 | 14:55:47 | 12 | 2 | 0 | 0 |

**Summary**
- **Added:** median 2, range 0–10, 25 in total.
- **Changed:** median 0, range 0–2, 3 in total.
- **Removed:** median 0, range 0–1, 2 in total.
- **All fields touched per entry:** median 2, range 0–10.
- Four participants account for the 9 entries (P3, P4, P9, P11).

**Notes on single entries**
- **Entry 6 changed no field and no section.** Only the schema's `version` counter moved. A patch restating a field's current values counts as an update in `applySchemaPatch`, which is a likely cause but is not confirmed.
- **Entry 2:** the changed field got a new label, help text and requiredness.
- **Entry 7:** two fields changed `type` (their kind or its details, e.g. options).

**This path still exists in the current system.** An intent edit to the purpose or audience of a form with fields still runs `useRefineSchema` with `mergePatchOntoLatest` (`apps/docs/src/hooks/query/schema-generation.ts:145-196`). The current code restricts it only by locked fields (`automated: true`, `:194`) and has no preview scope. "Unrestricted in which fields it could change" therefore still describes the current refinement, apart from locks.

---

## Changes since this audit (Phase 1, 2026-11-12)

The verdicts above describe the code at `10f46bd`. Phase 1 changed what some of them refer to.

- **I6 (versioned responses).** Previews now state how many collected responses a change affects:
  - answer tiles, conflict-fix tiles, and the canvas;
  - counted for fields it removes, retypes, rewords or rekeys (DEVIATIONS 1–2).
- **Out-of-sync intent (claim 21b, eventual consistency).**
  - **Visible:** a failed or slow intent update is stored on the portfolio (`intent_sync`, migration 016) and shown in the intent editor. It is retried with backoff.
  - **Re-queued, not dropped:** an update overtaken by a newer purpose is queued again.
- **Claims 12 and 13 (intent edits).** With a deck, editing the purpose or audience of a form with fields no longer changes the form directly.
  - **What happens instead:** the model's patch is offered as the question "Apply these changes from your edit?", with a scoped preview and a keep-as-is answer.
  - **Old path:** the Undo toast only remains where there is no deck (the `no-probes` condition).
  - **Paper wording:** "an intent edit reports what it changed and offers undo" then needs rewording for the `full` condition.
