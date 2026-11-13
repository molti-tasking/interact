# Trying Wave 1 on Your Own Machine

Go through the Prolific study as a participant, in each arm, without
deploying anything. One command sets up a local database, a study session
with the three arms, and a link per arm. With the mock model (the default)
it costs nothing.

Why the study is built this way:
[2026-11-13-study-assistant-baseline.md](../decisions/2026-11-13-study-assistant-baseline.md).
How to run it for real: [prolific-runbook.md](prolific-runbook.md).

## Prerequisites

- **Docker Desktop**, running.
- **Node 20** or newer, and the repository's dependencies installed:
  `corepack pnpm install` at the repository root. (If `pnpm` is not on your
  PATH, write `corepack pnpm` wherever this page says `pnpm`.)
- **This project's local Supabase stack** (`apps/docs/supabase/config.toml`,
  ports 54321 and 54322). The script starts it if it isn't running. If
  another project's Supabase stack holds those ports, stop that one first
  (`npx supabase stop` in its folder), or point `.env.study-local` at a stack
  of your own on other ports ([apps/docs/tests/README.md](../../apps/docs/tests/README.md),
  "An isolated stack").
- **No other `next dev` in `apps/docs`.** Stop `pnpm dev` first; both would
  use the same build folder.

The script never reads `apps/docs/.env.local` (it points at the hosted
database), and it refuses any Supabase or database address that is not on
this machine.

## The commands

```sh
cp apps/docs/.env.study-local.example apps/docs/.env.study-local
pnpm study:local
```

`pnpm study:local`:

1. checks Docker and the local Supabase (and starts it if needed);
2. applies all migrations;
3. creates a local researcher account and an open study session with the
   arms **full**, **assistant** and **silent baseline**, both situations,
   12 minutes per form;
4. prints a link per arm and the facilitator page;
5. starts the app at <http://localhost:3000> (Ctrl+C stops it).

Running it again reuses the session; `pnpm study:local --fresh` creates a new
one. `--setup-only` does steps 1–4 without starting the app.

The printout looks like this:

```
 Participant links — open each in a private window …
   full (Malleable Forms)   http://localhost:3000/join?code=AB12CD&PROLIFIC_PID=local-full-…&arm=full
   assistant (chat)         http://localhost:3000/join?code=AB12CD&PROLIFIC_PID=local-assistant-…&arm=assistant
   silent baseline          http://localhost:3000/join?code=AB12CD&PROLIFIC_PID=local-baseline-…&arm=baseline
   balanced (as on Prolific) http://localhost:3000/join?code=AB12CD&PROLIFIC_PID=local-any-…

 Facilitator page (progress, exports):
   http://localhost:3000/studies/<session id>
   sign in at http://localhost:3000/login as researcher@study.local / study-local-password
```

- Open a participant link in a **private window**. The facilitator page in a
  normal window: a browser signed in as the researcher can't join as a
  participant.
- `arm=<condition>` puts you in that arm. It only works here: the app
  honours it only with `STUDY_LOCAL=1` outside production (the script sets
  both), and the database only after the script has switched on its local
  mode. On a deployment the parameter is ignored.
- Opening another arm's link in the same private window starts a new
  participant there. Reloading a link continues where you were.
- To try the same arm again from the start, change the `PROLIFIC_PID` in the
  link (any letters and digits), or run the script again for new links.
- The link without `arm` is assigned like a Prolific participant (the
  emptiest arm × order).
- At the end, "Return to Prolific" leads to example.org: that is the end of
  the study.

## What to check

Every arm goes through the same steps:

    consent → intro → [situation (20 s) → form (12 min) → ratings → recall → why → quiz] × 2
            → questionnaire → completion link

| Step | Check |
|---|---|
| Consent | about 46 minutes; nothing about the arm |
| Situation | an image; "Start building the form" after 20 s |
| Form | the countdown; "Show the situation" opens it again; "My form is ready" only with at least one field |
| Ratings | two 1–7 scales, the form hidden |
| Recall | one item per line; Continue needs a line; after 3 minutes a notice, nothing cut off |
| Why | up to three of your fields, by label; each needs an answer |
| Quiz | unchanged: yes / no / not sure per item |
| Questionnaire | SUS, experience items, attention check, NCS-6, background |

Per arm, during the form:

| Arm | What you should see |
|---|---|
| **full** | "Describe the form", then the form with the intent pane and the elicitation questions next to it. Hovering an answer previews it on the form; choosing it changes the form. |
| **assistant** | No description card: a chat next to an empty form. Your first message is the description. The assistant answers in text and may change the form itself ("Form updated: …", with Undo in a toast). No intent pane, no questions deck. |
| **silent baseline** | "Describe the form", then the form and a chat box that only does what you ask ("2 added"). |

In every arm you can click a field to edit it, add one under the form, drag
fields to reorder them, and undo.

**With the mock model** the answers don't follow what you type: the same
recorded form and questions come back (the football club's form, then the
cat rescue's, in turn). The mock assistant asks two questions first, builds a
small general sign-up form on your second message, adds a field on the
third, and then starts over. Use the real model to judge what the assistant
actually does.

On the facilitator page, the session's tables show each test seat (arm,
step, time and fields per form).

## Exports and coding files

On the facilitator page, Export card:

| For | Files |
|---|---|
| Raters (form codes only) | `coding-forms.md`, `coding-requirements.csv`, `coding-fields.csv`, `coding-recall.csv`, `coding-why.csv` |
| Analyst | `coding-key.csv` (code → arm; ratings, recall lines, step times, why origins, assistant turns/questions/patches), `participants.csv` (+ seconds per step, measures per task), `assistant-turns.csv`, `why-key.csv`, `question-answers.csv`, form diversity |
| Archive | the JSON (contains the panel ids) |

How to code them: [coding-guide.md](coding-guide.md). To try the agreement
script, fill a sheet twice with some differences and run

```sh
pnpm --filter docs study:agreement rater-a/coding-why.csv rater-b/coding-why.csv
```

## Starting over

- **A new session, same database:** `pnpm study:local --fresh`.
- **Remove only the local test sessions:** in `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`

  ```sql
  DELETE FROM portfolios WHERE id IN (
    SELECT t.portfolio_id FROM study_tasks t
    JOIN study_sessions s ON s.id = t.session_id WHERE s.name = 'Local test · wave 1');
  DELETE FROM study_sessions WHERE name = 'Local test · wave 1';
  ```

- **Wipe the whole local database** (everything in this stack, not only the
  study): `cd apps/docs && npx supabase db reset`, then `pnpm study:local`.

## Switching to the real model

In `apps/docs/.env.study-local`:

```sh
STUDY_MOCK_LLM=0
LLM_MODEL_NAME=anthropic/claude-sonnet-5-5     # what the study will run with
PROBE_STRATEGY=committee
PROBE_COMMITTEE_SIZE=4
# the gateway …
LLM_HOST=https://…
LLM_API_KEY=…
# … or Anthropic's API directly
# LLM_PROVIDER=anthropic
# ANTHROPIC_API_KEY=…
```

Then run `pnpm study:local` again. Because the model settings changed, it
creates a new session (a session records what it ran with). Every call now
costs money: the full arm makes many calls per form (questions, previews,
conflict checks), the assistant one per message. Switch back with
`STUDY_MOCK_LLM=1`.

## When something goes wrong

| Message | What to do |
|---|---|
| "Docker isn't running" | start Docker Desktop |
| "Nothing answers at …" / "Supabase didn't start" | another stack holds the ports; stop it, or use your own stack and put its URLs in `.env.study-local` |
| "That database doesn't have this app's tables" | the address points at another project's database; nothing was changed |
| "This browser is signed in with a facilitator account" | use a private window for participant links |
| The arm is not the one in the link | the app wasn't started by `pnpm study:local` (it sets `STUDY_LOCAL=1`), or the database was reset after the script ran: run the script again |
| "Fixture …" errors in the terminal | the mock has no recording for that action; tell us which one |
