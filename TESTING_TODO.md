# Seam-Based Testing: Mock at the LLM Boundary

> Strategy: Intercept server actions at the LLM call boundary, replay recorded fixtures,
> and run deterministic Playwright E2E tests against the full UI.

---

## Phase 0: Infrastructure Setup

- [ ] **0.1** Install Playwright (`pnpm add -D @playwright/test` in `apps/docs`)
- [ ] **0.2** Create `playwright.config.ts` in `apps/docs` (baseURL: `http://localhost:3000`, webServer config for `next dev`)
- [ ] **0.3** Install Vitest + Testing Library (`pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom` in `apps/docs`)
- [ ] **0.4** Create `vitest.config.ts` (environment: jsdom, path aliases matching `tsconfig.json`)
- [ ] **0.5** Add npm scripts: `"test": "vitest"`, `"test:e2e": "playwright test"`, `"test:e2e:ui": "playwright test --ui"`
- [ ] **0.6** Create directory structure:
  ```
  apps/docs/
  ├── tests/
  │   ├── e2e/                    # Playwright specs
  │   ├── unit/                   # Vitest specs
  │   └── fixtures/               # Recorded LLM responses
  │       ├── construction-rental/
  │       ├── fitness-coaching/
  │       └── orthopedic-records/
  ```

---

## Phase 1: Identify & Document LLM Seams

All 5 LLM-calling server actions use `generateText()` from `ai` + manual JSON parsing.
Each returns `{ success: boolean; <payload>?; error?: string }`.

- [ ] **1.1** Document the **input → output contract** for each server action:

  | # | Action | File | Inputs | Output shape |
  |---|--------|------|--------|-------------|
  | 1 | `generateDimensionsAction` | `dimension-actions.ts` | `(prompt, maxDimensions?)` | `{ success, dimensions?: DimensionObject[], reasoning? }` |
  | 2 | `refineDimensionAction` | `dimension-actions.ts` | `(dimension, basePrompt, userFeedback)` | `{ success, dimension?: Partial<DimensionObject> }` |
  | 3 | `dimensionsToSchemaAction` | `dimension-actions.ts` | `(dimensions, basePrompt, acceptedStandards?)` | `{ success, result?: { basePrompt, artifactFormSchema, configuratorFormValues } }` |
  | 4 | `generateOpinionInteractionsAction` | `opinion-actions.ts` | `(basePrompt, maxOpinions?, dimensions?, acceptedStandards?)` | `{ success, interactions?: OpinionInteraction[] }` |
  | 5 | `resolveOpinionInteractionAction` | `opinion-actions.ts` | `({ basePrompt, currentSchema, interactionText, selectedOptionLabel, maxFollowUps? })` | `{ success, result?: { basePrompt, artifactFormSchema, followUpInteractions } }` |
  | 6 | `processColumnPromptAction` | `column-actions.ts` | `(field, prompt, responseData)` | `{ success, results?: Record<string, unknown> }` |
  | 7 | `deriveFieldsFromPromptAction` | `column-actions.ts` | `(field, prompt, existingFieldNames)` | `{ success, newFields?: Field[], label? }` |

- [ ] **1.2** Verify that `standards-actions.ts` (`detectDomainStandardsAction`) has **no LLM dependency** — it uses keyword matching only and needs no mocking

---

## Phase 2: Build the Fixture Recording Harness

Goal: Run the app once with a real LLM, capture every server action call/response as JSON fixtures.

- [ ] **2.1** Create a **recording interceptor** module (`tests/fixtures/recorder.ts`):
  - Wraps each server action
  - Logs `{ actionName, input, output, timestamp }` to a JSONL file
  - Activated via env var: `RECORD_FIXTURES=true`
- [ ] **2.2** Create a thin wrapper/proxy around `generateText` (single interception point):
  - Option A: Patch at the `generateText` import level (module mock)
  - Option B: Add an env-gated recording layer inside each server action (more explicit, less magic)
  - **Recommended: Option B** — add a `recordFixture(name, input, output)` call after each `generateText` in dev mode. Fewer moving parts, no module patching.
- [ ] **2.3** Run each of the 3 paper scenarios end-to-end with `RECORD_FIXTURES=true`:
  - Construction Machine Rental (multi-role, derivation)
  - Fitness Coaching (iterative refinement, 4 opinion rounds)
  - Orthopedic Patient Records (base + derived views)
- [ ] **2.4** Save recordings as structured fixture files:
  ```
  tests/fixtures/fitness-coaching/
  ├── 01-generate-dimensions.json       # { input: {...}, output: {...} }
  ├── 02-dimensions-to-schema.json
  ├── 03-generate-opinions.json
  ├── 04-resolve-opinion-nutrition.json
  ├── 05-resolve-opinion-frequency.json
  └── scenario.meta.json                # { description, steps[], portfolioTitle }
  ```
- [ ] **2.5** Review and curate fixtures: trim non-deterministic fields (timestamps, UUIDs), ensure responses are realistic and internally consistent

---

## Phase 3: Build the Fixture Replay Layer

Goal: During Playwright tests, intercept server action calls and return recorded fixtures.

- [ ] **3.1** Decide interception strategy:
  - **Option A: Playwright `page.route()` on Next.js server action POST requests**
    - Server actions go through `/_next/...` routes with action IDs
    - Intercept at the HTTP level, match by action ID or request body shape
  - **Option B: Environment-gated mock inside server actions**
    - `if (process.env.USE_FIXTURES) return loadFixture(actionName, input)`
    - Simpler, no Playwright route matching, works at the Node.js level
  - **Recommended: Option B** — server actions are the natural seam; avoids fragile route matching against Next.js internals
- [ ] **3.2** Implement `tests/fixtures/loader.ts`:
  ```typescript
  // Loads fixture by scenario + step, returns the recorded server action output
  function loadFixture(scenario: string, actionName: string, stepIndex: number): ActionOutput
  ```
- [ ] **3.3** Add fixture-loading guard to each server action:
  ```typescript
  export async function generateDimensionsAction(prompt: string, maxDimensions = 5) {
    if (process.env.USE_FIXTURES) {
      return loadFixture(process.env.FIXTURE_SCENARIO!, "generateDimensions", ...);
    }
    // ... existing LLM code ...
  }
  ```
- [ ] **3.4** Handle **stateful fixture sequencing** — some actions are called multiple times per scenario (e.g., `resolveOpinionInteractionAction` called once per opinion). The loader must track call order and return the Nth fixture for repeated actions.
- [ ] **3.5** Consider a **fixture matching strategy** for `resolveOpinionInteractionAction`:
  - Match by `selectedOptionLabel` from the request (most robust)
  - Fallback to sequential index if label doesn't match (for resilience)

---

## Phase 4: Write Playwright E2E Tests (Recorded Scenarios)

- [ ] **4.1** Create test helper: `tests/e2e/helpers.ts`
  - `createPortfolio(page, title, intent)` — navigates to `/portfolios/new`, fills form, submits
  - `waitForDimensions(page)` — waits for dimension cards to appear
  - `acceptAllDimensions(page)` — clicks accept on each dimension card
  - `waitForSchema(page)` — waits for form preview to render fields
  - `resolveOpinion(page, optionLabel)` — clicks an opinion option by label
  - `waitForOpinions(page)` — waits for opinion cards to appear

- [ ] **4.2** **Scenario 1: Fitness Coaching (simplest, single-role)**
  ```
  1. Create portfolio: "Fitness Coaching Client Intake"
  2. Wait for dimensions → verify dimension cards rendered
  3. Accept dimensions → wait for schema generation
  4. Verify form preview shows fields (count > 0)
  5. Wait for opinion cards
  6. Resolve opinion 1 → verify schema updated (field count changed or field labels changed)
  7. Resolve opinion 2 → verify schema updated
  8. Publish form
  9. Navigate to /forms/[id] → verify form renders for respondent
  10. Fill and submit form → verify response saved
  11. Navigate to /responses/[portfolioId] → verify response appears in table
  ```

- [ ] **4.3** **Scenario 2: Construction Machine Rental (multi-role + derivation)**
  ```
  1. Create base portfolio as Owner role
  2. Generate dimensions + schema
  3. Switch to Manager role → add certification dimensions
  4. Switch to Insurance role → add checklist fields
  5. Derive sub-schema for Dispatcher
  6. Verify derived portfolio links back to base
  7. Verify provenance log shows entries from all roles
  ```

- [ ] **4.4** **Scenario 3: Orthopedic Patient Records (derivation focus)**
  ```
  1. Create base patient schema
  2. Derive surgeon view (sub-schema)
  3. Derive physiotherapy view (sub-schema)
  4. Derive patient self-report view (sub-schema)
  5. Verify each derived view has correct field subset
  6. Verify base portfolio shows derivation tree
  ```

- [ ] **4.5** **Scenario 4: Column Actions (response table)**
  ```
  1. Use an existing portfolio with responses (seed via Supabase fixture)
  2. Navigate to /responses/[portfolioId]
  3. Apply column prompt (processColumnPromptAction)
  4. Verify enriched column values appear
  5. Derive new fields from column (deriveFieldsFromPromptAction)
  6. Verify new columns appear in table
  ```

---

## Phase 5: Unit Tests (Pure Functions, No LLM)

- [ ] **5.1** `lib/engine/schema-ops.ts` — test `addField`, `removeField`, `diffSchemas`, `mergeSchemas`, `schemaToZod`
- [ ] **5.2** `lib/form-renderer/validation.ts` — test constraint evaluation for each constraint type
- [ ] **5.3** `lib/engine/provenance.ts` — test provenance entry creation, diff computation
- [ ] **5.4** `lib/types.ts` — test Zod schema parsing for edge cases (nested groups, all field types)
- [ ] **5.5** `standards-actions.ts` — test keyword detection with known intents (no LLM, safe to unit test directly)

---

## Phase 6: Test Data & Database Seeding

- [ ] **6.1** Create a Supabase **test project** or use local Supabase (`supabase start`) for test isolation
- [ ] **6.2** Write seed scripts for each scenario:
  - Pre-populated portfolios (for derivation/response tests that skip creation flow)
  - Pre-populated responses (for column action tests)
- [ ] **6.3** Add `beforeEach` / `afterEach` hooks to reset DB state between tests:
  - Option: Truncate tables between tests
  - Option: Use Supabase transactions with rollback
- [ ] **6.4** Create `.env.test` with test Supabase credentials + `USE_FIXTURES=true`

---

## Phase 7: CI Integration

- [ ] **7.1** Add GitHub Actions workflow: `.github/workflows/test.yml`
  ```yaml
  jobs:
    unit:
      - pnpm test
    e2e:
      - supabase start (local)
      - USE_FIXTURES=true pnpm test:e2e
  ```
- [ ] **7.2** Cache Playwright browsers in CI
- [ ] **7.3** Upload Playwright HTML report as artifact on failure
- [ ] **7.4** Add a **nightly live-LLM smoke job** (no fixtures, asserts structure only):
  - Runs against real Anthropic API with budget cap
  - Only asserts: "dimensions appeared", "schema has >0 fields", "form renders"
  - Allowed to be flaky — alerts but doesn't block

---

## Phase 8: Fixture Maintenance & Refresh

- [ ] **8.1** Document the fixture recording process in a `tests/fixtures/README.md`
- [ ] **8.2** Add a script: `pnpm fixtures:record` — runs the app with `RECORD_FIXTURES=true`, walks through each scenario, saves outputs
- [ ] **8.3** Add a script: `pnpm fixtures:validate` — loads each fixture file, validates against the Zod schemas / TypeScript types
- [ ] **8.4** Set a calendar reminder or CI job to **re-record fixtures quarterly** (or when server action contracts change)
- [ ] **8.5** Add a pre-commit or CI check: if any server action file changed, warn that fixtures may need updating

---

## Decision Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Interception point | Inside server actions (env-gated) | Avoids fragile Next.js internal route matching; server actions are the natural seam |
| Fixture format | One JSON file per action call per scenario | Easy to inspect, version, and diff in PRs |
| Fixture matching | By action name + call sequence index + request body matching | Handles repeated calls (multiple opinion resolutions) |
| Test DB | Local Supabase (`supabase start`) | Free, isolated, matches prod schema via migrations |
| E2E framework | Playwright | Best Next.js support, built-in route interception if needed later |
| Unit framework | Vitest | Fast, native ESM, compatible with Next.js + TypeScript |
