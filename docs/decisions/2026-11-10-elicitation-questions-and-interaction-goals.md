# Elicitation Questions and Four Checked Interaction Goals

**Date:** 2026-11-10
**Context:** The paper was revised. It now calls the system's questions
"elicitation questions" (before: "design probes") and states four
interaction goals. The app had to match: in what it says, and in what it
guarantees. This log records what changed and why. The study additions that
came with the revision are at the end.

| Goal | Before | Now |
|---|---|---|
| G1 Ask, then show alternatives | Held | Unchanged: answers are only offered on a question's card |
| G2 Alternatives, not a recommendation | A "keep as is" answer on committee questions (and it could be cut off when the model offered more than four answers); none guaranteed on prompted ones. Answers shown in the model's order | Exactly one unchanged answer on every question; a random display order, drawn once and stored (1) |
| G3 Consequences before commitment | An answer clicked before its preview existed was applied when the preview arrived, unseen; without a preview, and for typed answers, a second model call wrote the form directly | An answer is applied only after its preview was on screen (2) |
| G4 No change without a decision | True by convention | Enforced where the form is written (3) |

## Decisions

### 0. The term

Everything a user or participant can read says "elicitation question(s)",
or "question(s)" where space is tight ("New questions", "Generate
questions", "3 answered"). Next to elicitation questions, form items are
"fields".

Unchanged on purpose, because the paper's analysis scripts read them:
tables and columns (`design_probes`, `preview_status`, …), log event names
(`probe_shown`, `probe_answered`, `option_previewed`, …), export columns
(`probes_shown`, `probes_answered`, …), the `no-probes` condition key, and
the names of operations and fixtures. Internal identifiers (components,
hooks, engine modules) keep their names too; renaming them would touch
every file for no reader's benefit.

`tests/unit/terminology.test.ts` parses the source and fails on the word in
any prose a user could see (JSX text, strings and templates with a space in
them: labels, toasts, error messages, and prompts, since a model may repeat
their wording).

One questionnaire item of the workshop instrument read "…each of its design
questions"; it now reads "…each of its questions".

### 1. One unchanged answer, a stored random order (G2)

`forms/probe-options.ts` decides both, so they hold whatever a model
returns and for every source of questions (committee, prompted, follow-ups,
curation, findings from responses, pretest issues, standards):

- `ensureUnchangedOption`: no answer that leaves the form as it is → one is
  added ("Keep the form as it is", with an empty preview); several → the
  marked one stays and the others are dropped. On the prompted path the
  previews arrive later; when one shows that a model-written answer changes
  nothing, it is dropped then (`mergeOptionPreviews`). The unchanged answer
  is never sent to the model for a preview.
- `prepareProbeOptions` shuffles the answers once, when the question is
  stored, and writes `modelPosition` on each (null for the added one). The
  array order in `design_probes.options` is the display order; the card, the
  voice interface and the study log all read it. A question stored before
  this has no `modelPosition` and is shown as stored.
- The unchanged answer is shuffled in with the others. The free-text answer
  is not an option: the card offers it below the answers, always last.
- No answer is marked, pre-selected or focused. The card's tiles share one
  set of classes (tested), and nothing takes focus when a card opens.

Every insert of a question goes through `storedOptions` in
`hooks/query/design-probes.ts`. `NEXT_PUBLIC_OPTION_ORDER_SEED` makes the
order reproducible per question text; it is set by the test configuration
and must never be set for a study.

`probe_shown` and `probe_answered` log `position` as displayed (as before)
and now also `modelPosition`, `orderRandomized`, `unchangedAnswer` and
`typed`.

**Standards** ("Apply standard: …?") have two answers, apply and skip; skip
is the unchanged one. They are a yes/no about one named standard, not a
design question with alternatives; the free-text link is shown but a typed
answer there is previewed like any other.

### 2. Preview before commitment (G3)

`answerGate` (engine) says what choosing an answer may do: **apply** only
when its preview was on screen at that moment; otherwise **show** the
preview first, **wait** for one that is being worked out and then show it,
or refuse when none is coming.

- A click on an answer whose preview isn't ready waits (the tile says so
  and the other answers are disabled), then shows the preview on the tile
  and on the form with "This is what it changes. Choose it again to apply."
  It is not applied. Before, it was applied as soon as the preview arrived.
- A failed preview: the tile says "No preview yet — retry the previews
  below". The fallback that sent the answer to the model and committed
  whatever came back is gone.
- A typed answer is previewed first (`usePreviewOwnAnswer`: one preview
  call), shown as an additional last tile, and applied from there through
  the same scoped path as any answer. The same for a spoken answer of one's
  own.
- Changing an answered question no longer re-resolves it through the model.
  "Ask again" returns the question to the open ones, with the earlier answer
  kept as history; the form changes when a new answer is chosen from its
  preview.
- Conflict fixes follow the same rule: no preview, no fix.

`probe_answered` is now logged when an answer is applied, not for a click
that only brought up its preview. The look that ends in a click is logged
(`option_previewed`); before, it was lost because the tile was gone before
the pointer left it.

**Cost of this choice:** one more click when someone is faster than the
preview, and a typed answer takes a preview call before it can be applied.

### 3. The commit refuses a change without a decision (G4)

Every write of a form goes through `commitPortfolioChange`. Its change
object now has to say what triggered it (`trigger`, required by the type):
`answer`, `intent-edit`, `field-edit`, `request` (a typed or spoken change
request), `undo`, `derive` — or `background`. Before writing,
`checkCommit` (`forms/decision-guard.ts`) refuses a change to the form that
has no creator action as its trigger, or no provenance entry naming a person
and a rationale. Nothing is written then.

"The form" is fields, sections, accepted standards and page layout.
`version`, the response dashboard, saved column actions and the respondent
help switch are not: the first is a counter, the others configure the
response view.

What the review of all call sites changed:

- **First generation** was logged with the actor `system`. It is the
  consequence of the creator writing the intent and is now logged with them.
- **Derived forms** had no history entry at all. Deriving now writes one
  (`portfolio_derived`, the creator, the scenario they described).
- **Suggested dashboard** (written unasked when the response view opens) and
  **intent sync** are declared `background`. They pass because they don't
  touch the form; if either ever did, the commit would refuse it.
- Curation, conflict detection, findings, themes and pretests were already
  limited to creating or retiring cards. A test now says so.

`tests/unit/decision-commit.test.ts` holds a census of every call site with
its trigger and the creator action behind it. A new call site fails the
test until it is added — someone has to say what the creator did.

### 4. Study additions (briefs mode)

- **NCS-6** (Lins de Holanda Coelho, Hanel & Wolf 2020) in the questionnaire
  of every condition, wording and reversed items (3, 4) from the paper's
  appendix, on its 1–5 scale; `ncs6_score` in `participants.csv`.
- **Per answered question** (`question-answers.csv`): displayed position,
  model position, unchanged answer, typed, preview viewed first and for how
  long, number of answers previewed.
- **Form diversity** (`form-diversity.csv`, `…-pairs.csv`): mean pairwise
  overlap of the finished forms' field sets per situation and condition,
  with fields matched as committee drafts are aligned (`sameQuestion`).
- **Run settings.** A briefs session records the model, the question
  strategy and the committee size when it is opened, from the server's
  environment (`/api/study/sessions/[id]/open`). All three must be set
  explicitly; migration 015 refuses to open a session without them, and a
  session that ran refuses to reopen under other settings. They are in
  every export. Participants don't receive them.
- **Wave 2 (handoff).** A session can start every task from a finished
  wave-1 form: as a portfolio (form, intent, answered questions, history,
  attributed to "Previous author") or as the bare form. Starting point ×
  order is balanced, each source form is used equally often per starting
  point, and each task records its source (`study_tasks.source_portfolio_id`,
  `start_kind` — both columns are new in 015). Two variant situations
  (`camp-2`, `foster-2`) with requirement lists marked add / remove / keep;
  they are drafts.
- **Assignment** now balances each factor on its own among equally empty
  cells (before: listed order), so conditions alternate from the second
  participant on.
- **Lost log events.** The logger waited for a session-token refresh before
  each batch, and the last events before the completion redirect could be
  dropped (found by the new end-to-end test: `questionnaire_submitted` was
  missing). It now writes directly and flushes before the redirect.

### 5. Responses know which form they answered

`responses.schema_version` (the portfolio revision, stamped by a trigger on
every insert) and `provenance_log.revision` (the revision a change
produced). The findings view lists fields whose wording, type or options
changed after answers to them had been collected, with how many answers were
given before (`forms/response-versions.ts`). Older rows have no version; for
them the comparison falls back to time.

### 6. Tests, figures, recording

- The engine has its own tests (`packages/interact/tests`, run by
  `pnpm test`).
- The browser suites take their database from the environment and refuse
  one that is not this project's (`tests/db.ts`); before, they truncated
  whatever listened on port 54322.
- Fixture replay matches a call by the text it is about, so counterbalanced
  tasks and parallel calls replay correctly; failed calls are not recorded.
- `pnpm screenshots` writes the paper's twenty figures from seeded data;
  `pnpm demo:record` records the three scenarios. Both are anonymous by
  construction and by check.

## Not done here

- **Database and code identifiers** still say "probe" (see 0).
- **Wave-2 variant situations and their requirement lists are drafts**, like
  the wave-1 ones.
- **Older decision records** keep the old term: they describe what was
  decided then.
- **The designer-workspace and study fixtures were recorded with one model
  on one day.** They test the flow, not the model.
- **Standards** have no alternatives beyond apply and skip (see 1).
