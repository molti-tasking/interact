# INTERACT — Malleable Forms

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A research prototype for designing forms by conversation instead of
specification. You describe what you need in a sentence; the system drafts a
minimal form and asks about the decisions the description leaves open. Each
answer shows what it will change before you choose it, and the responses you
collect feed back into the design.

A two-minute walkthrough of three scenarios:
[docs/demo/malleable-forms-demo.mp4](docs/demo/malleable-forms-demo.mp4).

## Elicitation questions

The system's questions about a form are **elicitation questions** (earlier
versions of the code, the database tables and the study logs call them
"design probes" or "probes"; those identifiers are unchanged). Four goals
hold for every one of them, and each is a checked property, not a prompt:

| Goal | What it means here | Enforced in |
|---|---|---|
| G1 Ask, then show alternatives | A suggestion reaches the creator only as an answer to a question that names the consideration | the deck is the only place answers are offered |
| G2 Alternatives, not a recommendation | Several answers; exactly one keeps the form as it is; a free-text answer, last; the order is drawn at random once and stored; none is marked, selected or focused | `forms/probe-options.ts` |
| G3 Consequences before commitment | An answer is applied only after its preview was on screen, and only what was previewed. A typed answer is previewed first, too | `answerGate` in `forms/probe-options.ts`, `forms/guards.ts` |
| G4 No change without a decision | The form changes only through a creator's answer or edit, recorded with who and why, and undoable. Background work can never write the form | `forms/decision-guard.ts`, `apps/docs/src/lib/engine/commit.ts` |

## How it works

| Step | What happens | Where |
|---|---|---|
| Describe | One sentence becomes a minimal form; fields stream in as they are written | `apps/docs/src/lib/schema-generation.ts` |
| Decide | Several independent drafts of the whole form are compared. Where they disagree, an elicitation question asks you | `packages/interact/src/forms/probe-disagreement.ts` |
| Preview | Every answer carries its change, limited to the fields its preview showed | `forms/guards.ts`, `forms/schema-patch.ts` |
| Keep your words | The purpose changes by one bounded edit per decision, never a rewrite | `forms/purpose-edit.ts` |
| Pretest | Simulated respondents fill in the draft and report where they get stuck | `forms/pretest.ts` |
| Collect | Respondents can ask what a question means, or fill the form from a few lines of text (opt-in per form) | `apps/docs/src/app/actions/respondent-assist-actions.ts` |
| Refine | Findings from the answers — unused options, themes in free text — become elicitation questions | `forms/findings.ts` |

The model proposes; a deterministic kernel decides what lands. Locked fields
are never changed by an automated edit, a patch computed on an old state is
re-applied to the current one, and every change is logged with its reason.

## Repository

```
apps/docs/            The Next.js app (workspace, public forms, responses, study mode)
packages/interact/    The engine: packages/interact/src/forms — pure TypeScript,
                      no database, framework or model client
docs/decisions/       Why things are the way they are, by date
docs/study/           How to run the Prolific study
docs/demo/            The walkthrough video (recorded by `pnpm --filter docs demo:record`)
paper-figures/        The paper's screenshots and the recording (generated, not tracked)
```

The engine is imported as source (`interact/forms/<module>`); the app sets
`transpilePackages: ["interact"]`.

## Running it

```sh
pnpm install
cd apps/docs && npx supabase start        # local database (ports 54321/54322)
cp .env.template .env.local               # LLM gateway + Supabase keys
pnpm dev                                  # http://localhost:3000
```

The app talks to an OpenAI-compatible gateway (LiteLLM). See
[apps/docs/.env.template](apps/docs/.env.template) for the settings, including
`PROBE_STRATEGY` (how elicitation questions are chosen). A study session
only opens when `LLM_MODEL_NAME`, `PROBE_STRATEGY` and `PROBE_COMMITTEE_SIZE`
are set explicitly; it records them and puts them in every export.

### Prompt caching

Every call about a form puts the same text first (role, form rules, the
description, the schema) in the system message, and the task in the user
message. To reuse that prefix across calls, add a cache breakpoint on the
system message at the gateway (LiteLLM: `cache_control_injection_points` with
`location: message, role: system`). The app sends no caching headers itself.

## Tests and evaluation

```sh
pnpm test                 # unit tests of the app and the engine (database tests skip without this project's stack)
pnpm test:e2e             # Playwright, replays recorded LLM fixtures
pnpm --filter docs screenshots   # the paper's figures → paper-figures/ (seeded, no model)
pnpm --filter docs demo:record   # the walkthrough video → paper-figures/video/
pnpm --filter docs eval:replay   # replay recorded cases against the live model
pnpm --filter docs study:agreement a.csv b.csv   # agreement between two raters' coding sheets
```

The browser suites empty the database they run on. They refuse one that is
not this project's, and can be pointed at a stack on other ports (see the
tests guide below).

[apps/docs/tests/README.md](apps/docs/tests/README.md) describes the suites;
[apps/docs/tests/evaluation/README.md](apps/docs/tests/evaluation/README.md)
the evaluation harnesses.

## License

MIT — see [LICENSE](LICENSE).
