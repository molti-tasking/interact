# LLM Seam Documentation

All LLM-calling server actions use `generateText()` from the `ai` package with manual JSON parsing.
Each returns `{ success: boolean; <payload>?; error?: string }`.

## Server Action Contracts

| # | Action | File | Inputs | Output |
|---|--------|------|--------|--------|
| 1 | `generateDimensionsAction` | `dimension-actions.ts` | `(prompt: string, maxDimensions?: number)` | `{ success, dimensions?: DimensionObject[], reasoning?: string }` |
| 2 | `refineDimensionAction` | `dimension-actions.ts` | `(dimension: DimensionObject, basePrompt: string, userFeedback: string)` | `{ success, dimension?: Partial<DimensionObject> }` |
| 3 | `dimensionsToSchemaAction` | `dimension-actions.ts` | `(dimensions: DimensionObject[], basePrompt: string, acceptedStandards?: DetectedStandard[])` | `{ success, result?: { basePrompt, artifactFormSchema, configuratorFormValues } }` |
| 4 | `generateOpinionInteractionsAction` | `opinion-actions.ts` | `(basePrompt: string, maxOpinions?: number, dimensions?: DimensionObject[], acceptedStandards?: DetectedStandard[])` | `{ success, interactions?: OpinionInteraction[] }` |
| 5 | `resolveOpinionInteractionAction` | `opinion-actions.ts` | `({ basePrompt, currentSchema, interactionText, selectedOptionLabel, maxFollowUps? })` | `{ success, result?: { basePrompt, artifactFormSchema, followUpInteractions } }` |
| 6 | `processColumnPromptAction` | `column-actions.ts` | `(field: Field, prompt: string, responseData: Record<string, unknown>[])` | `{ success, results?: Record<string, unknown> }` |
| 7 | `deriveFieldsFromPromptAction` | `column-actions.ts` | `(field: Field, prompt: string, existingFieldNames: string[])` | `{ success, newFields?: Field[], label?: string }` |

## Non-LLM Actions

| Action | File | Notes |
|--------|------|-------|
| `detectDomainStandardsAction` | `standards-actions.ts` | Keyword matching only — no LLM, no mocking needed |

## Fixture Strategy

- **Recording:** Add `recordFixture(name, input, output)` call after each `generateText` in dev mode (env-gated via `RECORD_FIXTURES=true`)
- **Replay:** `if (process.env.USE_FIXTURES) return loadFixture(...)` guard at top of each action
- **Matching:** By action name + call sequence index + request body matching for repeated calls (e.g., multiple opinion resolutions)
- **Format:** One JSON file per action call per scenario in `tests/fixtures/<scenario>/`
