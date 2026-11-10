# A Self-Paced Study Mode for the Prolific Comparison

**Date:** 2026-11-10
**Context:** The main study is a between-subjects comparison run on Prolific:
Malleable Forms against the same app without probes and without the intent
portfolio, on two fixed briefs. Prolific recruits and pays; everything else
happens in the app. The workshop mode (2026-10-21) is moved along by a
facilitator and has one free task, so it could not run this. How to run the
study is in [docs/study/prolific-runbook.md](../study/prolific-runbook.md).

## What already existed

From the pilot fixes (2026-11-04): the panel link with `PROLIFIC_PID`,
anonymous accounts, panel ids kept apart from study data, conditions assigned
on the server, and the completion redirect. This change adds the rest.

## Decisions

### 1. A session is either a workshop or a briefs session

`settings.mode = "briefs"` (migration 014). A participant walks through

    consent → intro → [situation → build → quiz] per brief → questionnaire → done

on their own. The step is stored on the server (`study_progress`), and
`advance_my_study_step(from)` moves one step forward only when `from` is the
step the server has, so a double click or a second tab can't skip one. The
session's `phase` only says whether the study is open (`lobby` not open,
`create` open, `done` closed); pausing stops new starts and lets people who
started finish.

Each brief has its own form (`study_tasks`), created at join. A task's clock
starts on the server when the participant enters it and stops when they
leave; the form is snapshotted at that moment (`task:<n>:<brief>`), and that
snapshot is what gets coded.

### 2. Assignment: condition × order, refilled

A joiner gets the cell (condition × order of the briefs) with the fewest
seats that finished or are still active. A seat not seen for 15 minutes
stops counting, so places that Prolific refills after a return or timeout go
to the cell that lost someone. Declined consent closes the seat without a
completion code.

### 3. The comparison condition: `baseline`

One description, one generated form, then free-text change requests applied
as patches by the same model (`chatEditFormAction`, `ChatEditPane`). No
probes, no intent pane, no intent sync, no conflict checks. The prompt tells
the model to do what was asked and not to ask back or suggest more: the
comparison is about who raises the open decisions.

Clicking a question to edit it, "Add field" and reordering stay in **both**
arms. Removing them from the baseline would handicap it in a way that has
nothing to do with elicitation. If the baseline should be chat-only, that is
a capability flag away, but then the arms differ in two things.

The earlier `no-probes` ablation (intent pane, no deck) is still there as a
third condition; it is not selected by default.

### 4. Briefs are images, requirement lists stay on the server

A brief is a situation told as a story, rendered to a PNG on the server
(`/api/study/brief/<key>`), so it has to be put into the participant's own
words. Stories and requirement lists live in `briefs.server.ts`; a test
checks that no client code imports it, and the production bundle was checked
for the text. The cost: a screen reader can't read the brief.

Both stories and both requirement lists are **drafts** (`version:
"draft-1"`). They were not written by domain experts, and coverage of these
lists is the primary measure.

### 5. Measures

| Measure | Where it comes from |
|---|---|
| Requirement coverage, split into "in the first prompt" and "arrived later" | Two raters code `coding-requirements.csv` against `coding-forms.md` |
| Unnecessary fields | Raters code `coding-fields.csv` (`requirement_id` = none) |
| Time | `study_tasks.started_at/finished_at`, `finished_by` |
| SUS and six experience items | Final questionnaire, the same wording in both arms |
| What their own form collects | Quiz after each task: six of their own questions and four foils, form hidden |

The raters' files carry a form code (a hash of the task id, stable across
exports) and no participant or condition; `coding-key.csv` unblinds and is
for the analyst. `pnpm study:agreement a.csv b.csv` gives Cohen's kappa per
coded column and lists disagreements.

A quiz foil counts as correct on "no". A foil can coincide with a question
the participant did add under another wording, so check foils against the
final form before reporting the score.

### 6. Three bugs found by running it

- **Panel join hung on "Starting the study…" in development.** The join was
  a mutation started from an effect; React's development double-mount
  detaches such a mutation from its result. It is now an idempotent query.
- **"Refining…" never ended in development,** for the same reason, in the
  intent pane (and the chat box stayed disabled). Both panes now track
  generation themselves.
- **A narrow window wiped the current step.** The desktop check replaced the
  step with a notice, so quiz answers were lost when the window was widened
  again. It is an overlay now, and the limit is 760 px instead of 1000 px:
  a laptop zoomed to 150 % reports about 900 px.

## Verified

- Migration 014 on a fresh local Postgres: 8 integration tests (balanced
  cells, step order, idempotent advance, timing, snapshots, refilled seats,
  decline, closing).
- In a browser with the live model: researcher creates and opens a session;
  one participant per condition from the study link to the completion link;
  the time limit (60 s test: recorded as `timeout` after 60 s); every export
  file downloaded and read.
- Probe previews worked with the configured model
  (`anthropic/claude-sonnet-5-5`) in these runs.

## Not done here

- **Wave 2 (handoff).** Deriving a variant from a wave-1 portfolio versus
  from the bare form needs wave-1 forms to choose from and a variant brief.
  The task table can carry it (a task with a source form).
- **Recorded fixtures and a Playwright spec** for the new flow. The browser
  runs above were scripts against the live model, not part of the suite.
- **Deployment:** public hosting in the EU, the gateway's spend cap, and the
  model setting are outside the repo.
