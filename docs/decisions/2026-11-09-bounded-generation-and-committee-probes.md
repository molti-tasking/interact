# Bounded Generative Edits, Committee Probes, and AI Beyond the Design Step

**Date:** 2026-11-09
**Context:** A review of the implementation against the paper's claims found
three gaps (probe selection was a prompt, "dimensions" were dead code, the
purpose text was rewritten on every answer) and a list of engineering
problems. This log records what changed and why.

| Finding | Change |
|---|---|
| Probes came from "generate 3–5 refinement questions" — nothing decided what was worth asking | Probes chosen by disagreement between independent drafts (1) |
| 27–44 of 104 pilot answers were clicked before their preview was ready | Committee probes carry their previews; no preview call (1) |
| Every answer had the model rewrite the whole purpose paragraph | One bounded edit, applied deterministically (2) |
| `updateFields` needed a full definition; a prompt rule warned that leaving out options erases them | Partial updates; unmentioned properties can't change (3) |
| Five different field vocabularies across the actions | One (`llmFieldSchema`), one builder (`fieldFromPatchField`) (4) |
| Creator and respondent text spliced into quoted prompt strings | Fenced in tags (5) |
| The shared part of the prompts differed per operation | One system message per form state (5) |
| `syncIntentFromFieldEditAction` logged participants' text | Removed (6) |
| Probe ids from `Date.now()` could collide across parallel calls | `crypto.randomUUID()` (6) |
| The `dimensions` argument of probe generation was never passed | Removed (6) |

## Decisions

### 1. Probes are chosen where independent drafts disagree

`generateDesignProbesAction` now drafts the complete form several times,
independently (`PROBE_COMMITTEE_SIZE`, default 4, each call at temperature 1
with a different emphasis so the drafts also differ on models that ignore
the temperature). `findDisagreements` (`engine/probe-disagreement.ts`) aligns
the drafts with the current form and turns every difference into an atomic
change — add a field, remove one, flip required, change a select's options —
with its vote count and binary vote entropy. An even split is a decision the
description leaves open; a unanimous change is not uncertain. This is
query-by-committee from active learning, applied to schema design.

A model is still involved in the wording, and only there: it groups the
changes into questions whose options are *sets of change refs*. Everything it
returns is validated against the changes (`composeProbes`): unknown refs are
dropped, a change belongs to one probe, every probe gets a "keep as is"
option. Each option's patch is built from the drafts' own field definitions,
so its preview — with scope — exists when the probe is inserted
(`preview_status = 'ready'`, `source = 'committee'`).

- **Cost:** committee size + 1 calls, against 1 + one preview call per probe
  before. A live run on a four-field form took 16 s for five probes with all
  previews ready.
- **Fallback:** fewer than two questions from the committee (drafts agree
  with the form, or calls failed) → the previous prompted generation.
  Collaborator input and accepted standards always use the prompted path:
  they bring their own questions.
- **Switch:** `PROBE_STRATEGY=prompted` restores the previous behaviour.
  **This matters for the study:** the pilot ran with prompted probes. Decide
  before the main study which strategy the `full` condition uses, and set it
  explicitly on the deployment.
- **Known limit:** drafts name the same new field differently. Alignment is
  token overlap on key and label (`SAME_FIELD = 0.6`), so near-synonyms can
  end up as two changes with one vote each. In the live run the wording step
  offered such a pair as alternative options of one question, which is
  acceptable, but their votes are undercounted.

"Dimensions" are no longer part of generation. The paper should describe the
committee's changes as the unit between intent and fields, or drop the term.

### 2. The purpose changes by one bounded edit

Resolving a probe, syncing after a field edit and fixing a conflict used to
return a rewritten purpose (or the whole intent). They now return a
`purposeEdit` — append one sentence, replace one sentence named verbatim, or
nothing — and `applyPurposeEdit` applies it. A replace whose target isn't in
the text appends instead; nothing is removed that the model didn't quote
exactly. Sentences the edit doesn't name stay as the creator wrote them, so
intent–schema co-persistence no longer drifts with each answer.

### 3. Updates are partial, and the model-facing shape is flat

Internally an update is a key plus the properties that change
(`PatchFieldUpdate`); `mergeUpdate` leaves the rest alone. Stored previews
with full definitions remain valid.

The first model-facing version made every property nullable. The provider
rejected it: "The compiled grammar is too large". Each `null` alternative
multiplies the output grammar. The schema is now flat with keep values (`""`,
`"keep"`, `[]`, one nullable `scale`), and `toSchemaPatch` converts it. Don't
add nullable or optional properties to the patch schemas without a live call.

### 4. One vocabulary for fields

`llmFieldSchema` is the field definition for generation, patches, derived
views, "add a field" and column actions. "Add a field" now also sees the
form's intent and schema, and a column action's scale field gets its real
scale instead of a fixed 1–5.

### 5. Prompt structure

`formSystemPrompt` builds the system message: role, form model rules, the
fenced description, the schema, space tables. It is identical for every
operation on one form state, and the task follows in the user message. With a
cache breakpoint on the system message at the gateway, the calls for one form
state can share it. Parallel calls that start together still each miss the
cache; the gain is across the sequence of calls on one form.

Correction to the review: the preview and resolve prompts already began with
the description and schema. Only generation put task text first.

### 6. Smaller fixes

Listed in the table. `Field.constraints` and `FieldGroup.conditional` remain
in the types without anything generating them; the form model rules exclude
conditional logic on purpose.

### 7. The engine is a package

The pure modules moved from `apps/docs/src/lib/engine` to
`packages/interact/src/forms` (patching, guards, merges, probe selection and
curation, findings, pretest, response statistics, prompts, core types). They
have no database, framework or model-client imports. The app imports them as
`interact/forms/<module>`; `apps/docs/src/lib/types.ts` re-exports the core
types and adds the row types. Only `commit.ts` (Supabase) stays in the app.

The package is consumed as TypeScript source (`transpilePackages:
["interact"]`), so there is no build step between an engine change and the
app. `pnpm --filter interact build` still emits declarations for it.

### 8. AI beyond the design step

All four are separate from the design flow that was piloted, and off for
study participants (`Capabilities.pretest`, `.answerThemes`,
`.respondentAssist` are false in study mode).

- **Pretest with simulated respondents** (`forms/pretest.ts`,
  `pretest-actions.ts`). Twelve made-up respondents fill in the draft and
  report where they got stuck. Counts are per distinct respondent, computed
  from what came back. Issues can be sent to the deck (`source = 'pretest'`),
  with ready previews where the fix is deterministic. Nothing is written to
  `responses`. A model sometimes plays fewer people than asked (seen live: 1
  of 6); one top-up call asks for the missing ones, and the dialog says how
  many answered.
- **Themes in text answers** (`forms/findings.ts`, `findings-actions.ts`).
  On demand from the findings panel. The model only assigns answer indexes
  to theme labels; counts are computed here. A text question with themes
  becomes a "turn this into a choice?" probe. Name and contact questions are
  never sent (`identifiesRespondent`). Converting a text field to a choice
  leaves the existing free-text answers as unlisted values — nothing recodes
  them yet.
- **Help for respondents** (`respondent-assist-actions.ts`), opt-in per form
  (`schema.assist`): "What does this mean?" per question (no answers are
  sent) and "Fill in from a text" (values are filled in and marked for
  checking; nothing is submitted). Respondents aren't designers, so these
  actions have their own gate: the server loads the form through
  `get_published_form` with the caller's session and checks the flag in the
  stored schema; rate limits are per caller and per form.
- **Streaming first draft** (`api/llm-stream/generate-schema`). Fields
  appear as the model writes them (NDJSON); the client commits only the
  final post-processed schema. A live call showed the first field after
  about 2.6 s. A client that disconnects does not abort the model call.

### 9. Replay evaluation

`pnpm eval:replay` replays recorded cases (JSONL) through the real actions
and reports deterministic measures: skipped ops, changes an update didn't
mention, spill when a preview is replayed on a later form, purpose
preservation, committee size and entropy, latency and tokens. A converter
turns a study export into cases (participant identifiers dropped; exports
stay out of git). See `apps/docs/tests/evaluation/README.md`. The pilot's "5
of 112" can't be recomputed exactly — pilot previews have no recorded scope.

A smoke run showed 0 % cached input on every call: the gateway does not cache
prompts yet (decision 5 only makes it possible).

## Not done here

- **Field alignment by meaning** (embeddings or a model call) for the
  committee, see the known limit in 1.
- **Adaptive follow-up questions for respondents.** They need a decision on
  where follow-up answers are stored.
- **Fixtures for the new calls.** Pretest, themes and respondent help have no
  recorded fixtures, so they fail under `USE_FIXTURES`. The e2e and
  screenshot suites were not run for this change: they need the local
  Supabase on ports 54321/54322.
- **Prompt caching at the gateway.** Outside the repo: add a cache breakpoint
  on the system message in the LiteLLM configuration.
