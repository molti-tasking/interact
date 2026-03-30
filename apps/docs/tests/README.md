# Tests

```
tests/
  e2e/                    Functional end-to-end tests (Playwright)
  screenshots/            Paper screenshot automation (Playwright)
  evaluation/             LLM-as-judge evaluation framework
  fixtures/               Pre-recorded fixture data for deterministic replay
  unit/                   Unit tests (Vitest)
```

## Prerequisites

- Local Supabase running: `npx supabase start`
- Dependencies installed: `pnpm install`

## E2E Tests

Functional tests that exercise the full application flow using fixture replay.

```sh
pnpm test:e2e           # headless
pnpm test:e2e:ui        # interactive Playwright UI
```

Fixtures live in `fixtures/fitness-coaching/` and are loaded when `USE_FIXTURES=true`.
To record new fixtures against a live LLM: `pnpm fixtures:record`.

## Paper Screenshots

Automated screenshot capture for the UIST'26 paper (Section 5 scenarios).
Produces 9 high-resolution PNGs (3840x2160, 2x scale) with the sidebar cropped out.

```sh
pnpm screenshots            # generate to tests/screenshots/output/
pnpm screenshots:paper      # generate + copy to paper figs/ directory
```

### Structure

| File | Purpose |
|------|---------|
| `screenshots/paper-screenshots.spec.ts` | Playwright spec — orchestrates the 3 scenarios |
| `screenshots/scenarios.ts` | Scenario seed data (schemas, probes, provenance) |
| `screenshots/helpers.ts` | Database seed helpers and screenshot utilities |
| `screenshots/output/` | Generated PNGs (gitignored except `.gitkeep`) |

### Scenarios

| # | Scenario | Paper Section | Principle in Focus | Screenshots |
|---|----------|--------------|-------------------|-------------|
| 1 | Construction Machine Rental | 5.1 | All four | workspace, provenance, derive |
| 2 | Fitness Coaching | 5.2 | Iterative Convergence | workspace+probes, resolved, published form |
| 3 | Orthopedic Patient Records | 5.3 | Scenario-Driven Derivation | base, surgeon super-schema, patient sub-schema |

Scenarios 1 and 3 seed data directly into the database (no LLM needed).
Scenario 2 uses the fitness-coaching fixture for the generate + resolve flow.

## Evaluation

Multi-model LLM-as-judge evaluation for Olsen's criteria and Cognitive Dimensions.
See `evaluation/README.md` for details.

```sh
pnpm eval                # full evaluation run
pnpm eval:olsen          # Olsen criteria only
pnpm eval:cdn-evidence   # CDN evidence collection
```

## Unit Tests

```sh
pnpm test               # run with Vitest
```
