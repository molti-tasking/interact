# INTERACT — Malleable Forms

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A research prototype for designing forms by conversation instead of
specification. You describe what you need in a sentence; the system drafts a
minimal form and asks about the decisions the description leaves open. Each
answer shows what it will change before you choose it, and the responses you
collect feed back into the design.

A three-minute walkthrough: [docs/demo/malleable-forms-demo.mp4](docs/demo/malleable-forms-demo.mp4).

## How it works

| Step | What happens | Where |
|---|---|---|
| Describe | One sentence becomes a minimal form; fields stream in as they are written | `apps/docs/src/lib/schema-generation.ts` |
| Decide | Several independent drafts of the whole form are compared. Where they disagree, a design probe asks you | `packages/interact/src/forms/probe-disagreement.ts` |
| Preview | Every answer carries its change, limited to the fields its preview showed | `forms/guards.ts`, `forms/schema-patch.ts` |
| Keep your words | The purpose changes by one bounded edit per decision, never a rewrite | `forms/purpose-edit.ts` |
| Pretest | Simulated respondents fill in the draft and report where they get stuck | `forms/pretest.ts` |
| Collect | Respondents can ask what a question means, or fill the form from a few lines of text (opt-in per form) | `apps/docs/src/app/actions/respondent-assist-actions.ts` |
| Refine | Findings from the answers — unused options, themes in free text — become design probes | `forms/findings.ts` |

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
docs/demo/            The walkthrough video and the script that records it
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
`PROBE_STRATEGY` (how design probes are chosen) — set it explicitly for a
study.

### Prompt caching

Every call about a form puts the same text first (role, form rules, the
description, the schema) in the system message, and the task in the user
message. To reuse that prefix across calls, add a cache breakpoint on the
system message at the gateway (LiteLLM: `cache_control_injection_points` with
`location: message, role: system`). The app sends no caching headers itself.

## Tests and evaluation

```sh
pnpm test                 # unit tests (two integration files need the local database)
pnpm test:e2e             # Playwright, replays recorded LLM fixtures
pnpm --filter docs eval:replay   # replay recorded cases against the live model
pnpm --filter docs study:agreement a.csv b.csv   # agreement between two raters' coding sheets
```

[apps/docs/tests/README.md](apps/docs/tests/README.md) describes the suites;
[apps/docs/tests/evaluation/README.md](apps/docs/tests/evaluation/README.md)
the evaluation harnesses.

## License

MIT — see [LICENSE](LICENSE).
