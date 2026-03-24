# Seam-Based Testing for Paper Evaluation

> Goal: Automated E2E tests for the three UIST paper case studies.
> These demonstrate that the Malleable Forms toolkit works end-to-end
> and make the scenarios reproducible for demos, the video figure, and reviewers.

---

## Infrastructure ✅

All test tooling is in place:

- **Playwright** for E2E tests (`pnpm test:e2e`)
- **Fixture system** (`src/lib/testing/`) — record/replay LLM responses at the server action boundary
- **9 server actions** instrumented with env-gated fixture guards
- **DB lifecycle** — local Supabase, truncate between tests
- **data-testid** attributes on all key UI components
- **`.env.test`** — fixture replay mode, dummy LLM keys, local Supabase

### Key files

| What | Where |
|------|-------|
| Playwright config | `apps/docs/playwright.config.ts` |
| Fixture guard | `src/lib/testing/fixture-guard.ts` |
| Fixture loader | `src/lib/testing/fixture-loader.ts` |
| Fixture recorder | `src/lib/testing/fixture-recorder.ts` |
| E2E helpers | `tests/e2e/helpers.ts` |
| Global setup/teardown | `tests/e2e/global-setup.ts`, `global-teardown.ts` |
| Fixture data | `tests/fixtures/{scenario}/` |

---

## Scenario Tests (one per paper case study)

### Scenario 1: Fitness Coaching — partial ✅

> Paper: "a training plan schema emerges iteratively as assessment results reveal new requirements"

Fixtures: `tests/fixtures/fitness-coaching/` (5 files, hand-crafted)
Test: `tests/e2e/fitness-coaching.spec.ts`

- [x] Create portfolio, enter intent, click Generate Form
- [x] Verify dimensions → schema → form preview with fields
- [x] Resolve 2 refinement opinions, verify schema evolves
- [ ] Publish form → navigate to `/forms/[id]` → verify respondent view renders
- [ ] Fill and submit form → verify response appears in `/responses/[portfolioId]`

### Scenario 2: Construction Machine Rental — not started

> Paper: "multiple roles collaboratively build and extend a contract schema across skill levels"

- [ ] Record fixture set with real LLM (or hand-craft)
- [ ] E2E test: create base portfolio as Owner → generate schema
- [ ] Switch role to Manager → refine with additional dimensions
- [ ] Switch role to Insurance → add compliance fields
- [ ] Derive sub-schema for Dispatcher
- [ ] Verify provenance log shows entries from all roles

### Scenario 3: Orthopedic Patient Records — not started

> Paper: "a single base schema yields radically different views for surgeons, physiotherapists, and patients"

- [ ] Record fixture set with real LLM (or hand-craft)
- [ ] E2E test: create base patient schema
- [ ] Derive surgeon view (sub-schema)
- [ ] Derive physiotherapy view (sub-schema)
- [ ] Derive patient self-report view (sub-schema)
- [ ] Verify each derived view has appropriate field subset

---

## Remaining Helpers Needed

- [ ] `fillAndSubmitForm(page, data)` — fill form fields by name, click submit
- [ ] `publishPortfolio(page, portfolioId)` — set status to published

---

## Recording Fixtures from Real LLM

To capture fixtures from a live session instead of hand-crafting:

```bash
# Start app in recording mode
pnpm fixtures:record

# Walk through the scenario in browser
# Fixtures appear in tests/fixtures/_recording-session/

# Move to scenario folder
mv tests/fixtures/_recording-session/* tests/fixtures/construction-rental/
```

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interception point | Inside server actions (env-gated) | Server actions are the natural seam |
| Fixture format | One JSON per action call per scenario | Easy to inspect and version |
| DB seeding | None — Playwright drives UI, DB writes happen naturally | Tests exercise the real write path |
| LLM provider | OpenAI-compatible via LiteLLM (`@/lib/model.ts`) | `.env.test` sets dummy values; fixtures bypass LLM |
