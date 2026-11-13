# A Chat-Assistant Arm, Post-Task Measures and a Norm Group

**Date:** 2026-11-13
**Branch:** `study/assistant-baseline` (from `eics-eval`)
**Builds on:** [2026-11-10-prolific-brief-study.md](2026-11-10-prolific-brief-study.md),
[docs/study/prolific-runbook.md](../study/prolific-runbook.md)

## What the study has to show

When people cannot fully specify what they need, an AI helps most by
surfacing the open decisions rather than filling them in, and by keeping
those decisions in the artifact. Wave 1 tests surfacing against a
general-purpose chat assistant (the reviewers' "isn't this just Claude?").
Wave 2 tests use by others (taking over a form with or without its intent
portfolio).

Primary measure: requirement coverage, coded blind, split into cued and
uncued requirements (`kind` in `briefs.server.ts`, unchanged). Secondary:
what people know their form collects, why it asks what it asks, and how
confident they are compared with what they know.

No step before a task may make participants think before the tool. Prior
knowledge is measured in a separate norm group.

## Scope of this change

The authors narrowed the specification on 2026-11-13: **wave 1 only**, and
runnable by the authors themselves on their machine. Built here: the
`assistant` arm, the post-task measures, the wave-1 exports and coding
files, forcing an arm on a local link, and the local setup. Deferred: the
norm group (`list-only`, section 3 below) and the wave-2 additions (seeding
a wave-2 session, its end-to-end test, "inherited" why-fields). Wave 2 keeps
working as it does; sessions created from now on get the post-task steps in
either wave.

## Checked against the code and the earlier decisions

Nothing in the specification contradicts the code or the 2026-11-10
decisions, so this plan is implemented directly. Two tensions are recorded
as open questions instead (end of this document): the post-task measures of
task 1 come before task 2, and the norm group's 3 minutes are not said to be
a hard limit.

## Plan

### 1. The `assistant` condition

A fourth condition id, `assistant`. `full`, `no-probes` and `baseline` keep
their ids, prompts and behaviour. In the interface and the docs `baseline`
is called the **silent baseline**.

| | `full` | `assistant` |
|---|---|---|
| Model | `LLM_MODEL_NAME` (`model` in `lib/model.ts`) | the same object; temperature 0.3 as the full arm's form generation, resolved centrally (`llm-temperature.ts`) |
| Canvas, click-to-edit, "Add field", reorder, undo | yes | yes (the same `PortfolioWorkspace`/`ArtifactPane`) |
| Intent pane, question deck, conflict checks, intent sync | yes | no (`intentPortfolio`, `designProbes` off) |
| Left pane | intent + deck | `AssistantPane`: a chat |

- **Capabilities.** A new flag `assistantChat`. `study-context.tsx` sets it
  for `condition === "assistant"` with `designProbes` and
  `intentPortfolio` off (which also switches off conflict checks and intent
  sync — both hang off those flags already).
- **Start.** No "Describe the form" card. The task opens on the empty canvas
  with the chat; the first message is the description and is logged as
  `first_prompt` (what the coding export uses as "first description").
- **A turn.** `assistantTurnAction` (server action, also reachable as
  `/api/llm/assistant-turn` so it runs in parallel with nothing queued in
  front of it). Input: the current schema and the whole conversation.
  Output (structured): `reply` (plain text) and `schemaPatch` or `null`, in
  the vocabulary of the chat edits (`schemaPatchSchema`, `toSchemaPatch`).
  The model decides alone whether to generate, ask, suggest, or several.
- **Applying.** As an artifact update: right away, through
  `commitPortfolioChange` with `automated: true` (the lock guard, I4),
  `mergePatchOntoLatest` from the schema the turn started from (I3),
  trigger `request`, actor = participant, rationale = their message, action
  `assistant_edit`. An Undo toast as for every other change.
- **System prompt** in `apps/docs/src/lib/study/prompts/assistant.ts`:
  short, neutral, general-purpose assistant helping someone build a web
  form; the current schema on every turn. It says nothing about asking,
  not asking, suggesting or elicitation, and is written from scratch.
  Tests: (a) no words of asking, clarifying, suggesting, recommending,
  assuming, eliciting in the prompt or in the output schema's
  descriptions; (b) no sequence of 8 words shared with the full arm's
  prompt sources. Draft wording: at the end of this document.
- **Logging per turn** (`assistant_turn` event): turn index, the reply and
  its length, question sentences (below), the patch's operation count
  (`null` without a patch), fields added/changed/removed, latency; the
  participant's message as `assistant_message`. Failures as
  `assistant_failed`.
- **Question sentences** (`lib/study/question-sentences.ts`): split the
  reply at sentence ends (`.`, `!`, `?`, `…`, followed by a space or the
  end) and at line breaks; a segment counts when it ends in `?` after
  trailing quotes, brackets and Markdown marks are removed. `??` counts
  once; a `?` inside a URL does not end a sentence. Tested on examples.
- **Patch operations:** fields added + fields updated + fields removed +
  section placements.

### 2. Measures after each task (every arm, wave 1 and 2)

New steps between `task:n` and `quiz:n`, in this order:

    task:n → ratings:n → recall:n → why:n → quiz:n

- Only sessions with `settings.postTaskMeasures = true` have them; every
  new briefs session gets it, sessions created before keep their steps
  (`study_steps(settings, tasks)` in migration 017 decides, a TypeScript
  mirror shows them). Time per step: from the server's `step_entered`
  events, plus the client's time on screen in each answer.
- **Ratings** (`ratings:n`): two 1–7 items, "How well do you know what
  your form asks?" and "How confident are you that your form collects
  everything this situation needs?".
- **Free recall** (`recall:n`): "List everything your form asks, one per
  line." At least one non-empty line; after 3 minutes a gentle notice,
  nothing is cut off.
- **Why** (`why:n`): three fields of the final form, label only, "Why does
  your form ask this?", free text (required). Choice
  (`lib/study/why-fields.ts`, deterministic per participant and task):
  wave 1 two system fields and one participant field (`origin: "creator"`),
  filled from the other kind when one runs short. The function already
  takes the ids of inherited fields and puts them first (wave 2), but the
  participant's page does not pass them yet (deferred with wave 2). The
  origin (`system`, `participant`, `inherited`) is stored with the answer,
  never shown. Fewer than three fields: as many as there are; none: skipped.
- **Quiz:** unchanged.

### 3. The norm group: `settings.mode = "list-only"` (deferred)

Not built in this change. The design, for when it is:

    consent → intro → [brief:n → list:n] × 2 → questionnaire → done

- Same brief images, order counterbalanced by the same join function (no
  conditions: the cells are the orders). Tasks have no form; no model
  access (`is_study_participant()` excludes these sessions).
- `list:n`: the situation stays visible above "List everything a form for
  this situation needs to collect", one per line, at least one line, a
  3-minute notice as in recall (see open questions).
- Questionnaire: the briefs questionnaire's background questions and the
  NCS-6, nothing about a tool (instrument `list-only-final`).
- Consent: its own text, without any AI. Opening needs no run settings.

### 4. Forcing an arm (local testing only)

`arm=<condition>` on the study link (or `arm=portfolio|form` in a wave-2
session) picks the arm. Two independent gates:

1. **App:** `forcedArmAllowed(env)` is true only when
   `NODE_ENV !== "production"` and `STUDY_LOCAL === "1"`; the join page
   asks `/api/study/local-arm` and sends `p_arm` only when it says yes.
   Unit-tested for production.
2. **Database:** right after joining, the page calls
   `force_my_study_arm(session, arm)`. It changes the participant's own
   condition, only while they are still on the consent step, and only while
   the row in `study_local_mode` says so. Only the database owner can write
   that row; the local setup script does. A participant who calls the
   function by hand on a deployment changes nothing. (A separate function
   rather than a parameter of the join, so the join function stays as
   migration 015 left it.)

### 5. Exports

Rater files (form codes, no conditions, no participants):

| File | One row per | Columns |
|---|---|---|
| `coding-recall.csv` | recall line | `form`, `line_no`, `text`, `matches_field`, `requirement_id` |
| `coding-why.csv` | why item | `form`, `item_no`, `field_label`, `answer`, `score` |
| `coding-norm.csv` (deferred with the norm group) | norm-group line | `list`, `brief`, `line_no`, `line`, `requirement_id` |

`item_no` is added so `study:agreement` can match rows.

Analyst files: `coding-key.csv` and `participants.csv` gain (appended, so
existing columns keep their positions) the two ratings, recall line count,
seconds per post-task step, why-field origins, and for `assistant` the
turns, question sentences and patches per task. `assistant-turns.csv`: one
row per turn. `participants.csv` gains seconds per step.

`study:agreement` handles the three new sheets; `score` gets weighted kappa
(linear weights; quadratic printed alongside). `docs/study/coding-guide.md`:
rubric, matching rules, two worked examples per sheet.

### 6. Local testing

- `.env.study-local.example`: local Supabase URL and keys (from
  `supabase status`), model settings, `STUDY_MOCK_LLM=1`.
- `pnpm study:local`: checks Docker and this project's local stack,
  applies the migrations, seeds a briefs session with `full`, `assistant`
  and `baseline` and a local admin (the `list-only` and wave-2 sessions are
  deferred), prints a link per arm and the facilitator
  page, then starts the app with `.env.study-local` and `NODE_ENV=test`
  (so Next never reads `.env.local`). Refuses any Supabase URL that is not
  a loopback address.
- `STUDY_MOCK_LLM=1`: replays a fixture scenario (`study-local`) whose
  recordings are reused in turn, so a session never runs out; `0` calls the
  model.
- `docs/study/local-testing.md`: step by step.

### 7. Tests

Unit: the prompt check, the heuristic, why-field selection, export
columns, the forced-arm gate in production, the step lists. Balancing with
three arms lives in SQL, so its test is an integration test (deviation from
"unit"). Playwright, fixture mode: `full`, `assistant` and the silent
`baseline`, each from the study link to the completion URL. The existing
wave-2 test stays as it is.

### 8. Onboarding (added on the authors' request)

Kept to what participants need, and matched across arms
(`lib/study/arm-copy.ts`, `lib/study/tours.ts`, both tested):

- At the first description, one line in every arm: "Rough is fine: the
  tool drafts a form from it right away, and you improve it afterwards"
  (the assistant: the same in its empty chat). Without it, people who
  don't know a draft follows tend to write a long specification first —
  not the situation the study is about — and it costs task time. No
  placeholder: the line is the only guidance on length.
- When the form is there (assistant: at once), one popover on the arm's
  own pane with one sentence, the same ending in every arm — full: "Answer
  the tool's questions, change your description, or edit the form
  directly." It has no buttons and can't be dismissed with Esc; a click
  into the highlighted pane ends it, and that click goes nowhere else (in
  the questions deck it could otherwise apply an answer). The time to that
  click is logged (`tour_closed.ms`, `reason: "clicked"`): a check that the
  participant is there when the form appears. "How it works" shows it
  again. The clock keeps running.
- An earlier version explained the tool on the intro page and ran a 3–4
  step tour; the authors found it too much.

The tour's logging uses driver.js's `onPopoverRender` and
`onDestroyStarted`: before, a step left within the ~0.4 s highlight
animation, or a quick ✕, went unlogged (this also affected the workshop's
tours).

## Deviations from the specification

1. **Scope** (the authors' decision): wave 1 only. The norm group and the
   wave-2 additions are not built.
2. **Balancing with three arms** is tested as an integration test
   (`study-assistant.integration.test.ts`), not a unit test: the
   assignment is a SQL function, and a TypeScript copy would test the copy.
3. **The assistant's e2e answers are hand-written**, in the format of a
   recording and marked `handWritten`. Recording them needs the live model,
   whose key is only in `.env.local`, which this change must not use. To
   record: `RECORD_FIXTURES=true playwright test study-briefs`.
4. **Extra columns in the rater sheets:** `situation` (as the existing
   sheets have it), and `line_no`/`item_no` so the agreement script can
   match rows. `why-key.csv` is new: the origin of each why item, to join
   with the scores (the key's `why_origins` only lists them per form).
5. **Forcing an arm** is a function called right after the join, not a
   parameter of the join, so the 015 join function stays untouched. Locally
   only, a second arm's link in the same browser starts a new anonymous
   participant (otherwise each arm would need its own browser).
6. **The 46 minutes are an estimate.** Local runs are scripted (about a
   minute each); they check the flow, not how long people take.
7. **The assistant's conversation** is kept in the browser (localStorage,
   per form) and sent whole on every turn; every message and reply is also
   in the log.

## Verified (2026-11-13)

On an isolated local stack (its own ports; the authors' stacks untouched):

- Migration 017 applied with `supabase migration up`; `study_steps()`
  gives the new steps for new sessions and the 014 steps otherwise.
- Unit tests: 78 files, 807 tests, engine included. Integration tests: 5
  files, 39 tests, among them three-arm balancing (12 joins → 2 per arm ×
  order, the first three in three different arms), the post-task steps and
  both gates of forcing an arm.
- Playwright, fixture replay: `full`, `assistant` and the silent `baseline`
  from the study link to the completion redirect, with ratings, recall and
  why after both forms, and the exports; the wave-2 test unchanged. 4
  passed in 3.6 minutes. Scripted runs take 45–50 s per participant, 41 of
  them the two 20-second reading pauses — machine time, not people's.
- `pnpm study:local` against that stack: set up, seeded, started; an
  `arm=assistant` link was switched from its balanced `full` to `assistant`
  (`arm_forced`); the mock assistant asked, then built a form; a reload kept
  the conversation; a `full` link in the same browser started a second
  participant with the generated form and the question deck.

Not verified: the assistant arm with the live model (no recording exists
yet), and how long people take.

## The system prompt (assistant arm, `assistant-1`)

    You are a helpful assistant. You are helping someone build a web form
    in a form builder.

    The form is shown next to this chat. The person can also change it
    there themselves: edit a field, add one, or move fields around.

    To change the form, return the change in "schemaPatch". It is applied
    to the form as soon as you reply, and the person can undo it. Set
    "schemaPatch" to null when the form stays as it is. Name existing
    fields by their "key" exactly as listed below.

    Write "reply" in plain text, without Markdown.

    The form as it is now:
    <current_form>
    …the current schema as JSON…
    </current_form>

## Open questions for the authors

1. The final wording of the assistant's system prompt (above, as
   committed). Bump `ASSISTANT_PROMPT_VERSION` when it changes.
2. The post-task measures of task 1 (recall, "why") come before task 2 and
   may work as a forcing function for task 2 in both arms. Analyse task
   position, or treat task 1 as primary?
3. The norm group's 3 minutes (when it is built): a notice, like recall,
   or a hard limit that gives every list the same time?
