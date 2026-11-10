# Tests

```
tests/
  unit/                   Vitest: the app (the engine's own tests are in
                          packages/interact/tests and run in the same command)
  e2e/                    End-to-end flows (Playwright, recorded fixtures)
  screenshots/            The paper's figures (Playwright, seeded data)
  demo/                   The scripted demo recording (Playwright, seeded data)
  fixtures/               Recorded model calls, one folder per scenario
  evaluation/             Replay and LLM-as-judge harnesses (live model)
  db.ts                   The test database, and the check that it is ours
```

## Unit and integration tests

```sh
pnpm test                       # Vitest: app + engine
```

What the four interaction goals look like as tests:

| Goal | Tests |
|---|---|
| G2 one unchanged answer, random stored order | `packages/interact/tests/probe-options.test.ts`, `unit/answer-preview-render.test.tsx`, `unit/probe-log.test.ts` |
| G3 preview before commitment | `packages/interact/tests/probe-options.test.ts` (`answerGate`), `unit/answer-preview-render.test.tsx` |
| G4 no change without a decision | `packages/interact/tests/decision-guard.test.ts`, `unit/decision-commit.test.ts` (the commit with a stubbed database, and a census of every place that writes a form) |
| The term | `unit/terminology.test.ts`: no "probe" in anything a user can read |

Files named `*.integration.test.ts` need a Supabase stack with this app's
migrations. They are skipped when none is reachable — or when the one that
answers is another project's.

## An isolated stack

`supabase/config.toml` uses Supabase's default ports (54321/54322). If
another project's stack holds them, don't stop it and don't run against it:
the browser suites `TRUNCATE` tables. `tests/db.ts` refuses a database
without this project's tables, but the safe setup is a stack of your own:

```sh
cp -R supabase /tmp/interact-stack/supabase      # then edit config.toml:
#   project_id = "interact-test", and every port (e.g. 56321, 56322, …)
(cd /tmp/interact-stack && npx supabase start -x studio,imgproxy,edge-runtime,logflare,vector,postgres-meta)
npx supabase status -o env                       # in that folder: URL and keys

export E2E_SUPABASE_URL=http://127.0.0.1:56321
export E2E_SUPABASE_ANON_KEY=…  E2E_SERVICE_ROLE_KEY=…
export E2E_DB_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
export E2E_PORT=3210                             # the app under test
# For `pnpm test` (integration files) also:
export NEXT_PUBLIC_SUPABASE_URL=$E2E_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$E2E_SUPABASE_ANON_KEY
```

## End-to-end

```sh
pnpm test:e2e           # headless, replays fixtures (no model, no keys)
pnpm test:e2e:ui        # interactive
```

| Spec | Flow | Fixtures |
|---|---|---|
| `designer-workspace.spec.ts` | describe → form → elicitation questions with previews → a typed answer → ask an answered question again → history | `fixtures/designer-workspace` |
| `study-briefs.spec.ts` | the Prolific study, both conditions, study link to completion redirect; wave 2 (taking over a finished form) | `fixtures/study-briefs` |
| `study-workshop.spec.ts` | a whole workshop with three participants | none (forms are seeded) |

**Recording fixtures.** `RECORD_FIXTURES=true pnpm test:e2e <spec>` runs the
spec against the live model (settings from `.env.local`) and writes every
model call to `fixtures/_recording-session/<scenario>/`. Move that folder to
`fixtures/<scenario>/`. Replay matches a call by the text it is about (a
description, a question, a change request), so task order and parallel calls
don't matter; background work that happened not to run during the recording
answers "nothing to do". Failed calls are not recorded.

Under replay the app runs as `NODE_ENV=test` and never reads `.env.local`.

## The paper's figures

```sh
pnpm screenshots            # → paper-figures/*.png at the repository root
pnpm screenshots:paper      # the same, then copied into the paper repository
```

`screenshots/paper-figures.spec.ts` seeds the three scenarios
(`screenshots/paper-scenarios.ts`) and writes twenty screenshots at 2x
(2880 × 1800 for full views):

| Files | What |
|---|---|
| `teaser-1…7` | two-pane workspace; a question with an answer previewed; intent with its last change; field side sheet; decision trail; published form; derivation |
| `s1-1…4` | youth soccer registration: one-line intent; intent with change; three answered questions; evolved workspace |
| `s2-1…4` | hiring a sales representative: "Generate questions" with feedback; two answered questions; evolved workspace; side sheet of "Industry Background" |
| `s3-1…5` | orthopedic patient records: base; surgeon's view; physiotherapist's view; the two derivation indicators |

No model is called. Each screenshot is checked before it is written: no
repository link, no account or persona name in the shell, no project or lab
name, and no "probe" (`ANONYMIZE`, `IDENTIFYING` in `screenshots/helpers.ts`).

## The demo recording

```sh
pnpm demo:record            # → paper-figures/video/malleable-forms-demo.mp4
```

`demo/demo-recording.spec.ts` records the three scenarios in one take from
the same seeds (answers are given on camera and applied from their
previews; the one generation call is answered from the seed), and
`demo/post.py` burns the captions in with ffmpeg. It follows the approach of
the paper repository's `video/recorder/`, without the live model.

## Evaluation

Replay of recorded cases against the live model, and LLM-as-judge runs for
Olsen's criteria and the Cognitive Dimensions: see `evaluation/README.md`.

```sh
pnpm eval:replay         # deterministic measures on recorded cases
pnpm eval                # full judge run
```
