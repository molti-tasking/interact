# Deviations from the evaluation specification

Each entry says:
- what differs from `eval-harness-prompt.md`;
- why;
- when it was decided;
- whether results had been seen at that point.

Nothing has been run against a model yet; no results have been seen.

## Phase 1 (system changes)

### 1. I6 counts key changes as destructive too (2026-11-12, before any results)

**Spec.** A patch "that removes a field, changes its type, or rewrites its label" must state how many collected responses it affects.

**Implemented.** The same three, plus a change of the field's **key**.
- Stored answers are keyed by the field's key (CLAIMS 17).
- A key change therefore detaches them as surely as a removal.
- "Type" includes one choice ↔ several choices, because the stored answer changes shape (a value ↔ a list).

**Where.** `destructiveChanges`, `affectedResponses` in `packages/interact/src/forms/response-versions.ts`.

**Effect.** The count can only be larger than under the spec's definition. The E2 I6 oracle uses this definition, frozen with the oracles.

### 2. I6 count is computed when the preview is shown (2026-11-12, before any results)

**Spec.** "The preview data must include the number of collected responses with an answer for that field."

**Implemented.**
- The number is part of the data the preview renders (answer tile, conflict-fix tile, canvas overlay).
- It is computed from the form's collected responses at display time. It is **not** stored inside the question's saved preview, because a stored count goes stale as responses arrive.
- The count shown is logged with `option_previewed` (study sessions), so E2 can compare it with the true count.

**What counts as "collected responses".** The form's own responses. Responses to a base form that a derived view projects in are not counted.

### 3. "Out of sync after a timeout" is decided when the notice is shown (2026-11-12, before any results)

**Spec.** "Also set the flag when the sync is still pending after a configurable timeout."

**Implemented.**
- The flag is stored as soon as an update is pending (`state: "pending"`, `since`).
- It counts as out of sync once it is older than `NEXT_PUBLIC_INTENT_SYNC_STALE_MS` (default 30 s), evaluated by `intentSyncStatus`. No second write happens at the timeout.
- A pending flag therefore turns into "out of sync" even if the page that started the update is closed.

### 4. The study handoff stays outside the commit function (D7, 2026-11-12, before any results)

The wave-2 handoff (`study_start_from_source`, migration 015) writes a task form's schema and intent with a plain `UPDATE`. It does so inside the join that creates the form, moments after inserting it.

Under D7 that is part of creating the form, which I1 does not cover. The join function is left unchanged. Readers of the I1 results should know this study-only path exists.

### 5. E1 calls Anthropic directly, not through the gateway (2026-11-12, before any results)

**Spec.** "All use the same model and settings as the app."

**Implemented.** Same model, a different route.
- **Pilot and deployed app:** call `anthropic/claude-sonnet-5` through the LiteLLM gateway (OpenAI-compatible chat completions).
- **E1:** calls `claude-sonnet-5` on Anthropic's Messages API (`LLM_PROVIDER=anthropic`, `@ai-sdk/anthropic`), because the gateway keys are capped below the evaluation's budget.

**Settings kept equal where the route allows:**
- **Temperature:** omitted (Claude 5 rejects others; same rule as before).
- **Structured output:** native `output_config.format`, as the gateway produced it (the provider's "json tool" fallback is switched off).
- **Thinking:** the API's default (adaptive).

**One explicit setting.** An output cap of 16,000 tokens where a call sets none. Through the gateway the cap was the gateway's own default, which is not recorded.

**Budget control.** The Anthropic API has no per-key cap. The harness enforces the $40 cap and the $30 stop-and-ask rule from its own ledger, at the frozen prices in `eval/prices.json`.

## Phase 2 (E1)

### 6. Failed requests stay in the measures (defined in the frozen summarizer, before any results)

The spec doesn't say how a request that fails counts. The frozen summarizer (`e1/summarize.ts`, draft 2) counts it as what it left behind:
- **A failed change:** the form unchanged.
- **A failed derive:** no derived form.
  - Its fulfilment is that of an empty form.
  - The fields it had to keep count as collateral.
  - It drops out of link integrity, which has no derived form to check (R: n = 17 instead of 20).

In the final runs this affects 3 requests, all orthopedic-6 under R. The app's generation action timed out (45 s plus one retry).

### 7. Latency is the time the creator waits (defined in the frozen summarizer, before any results)

The spec asks for "seconds per request". `\eOneLatency*` is the time from submitting the request to the form having changed.
- **For P** that excludes the purpose update the app runs in the background after an answer.
- The summary also reports the total including it (`totalS`: P 5.7 s against 4.2 s).
