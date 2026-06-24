# Voice-Driven Incremental Inserts

**Date:** 2026-06-24
**Context:** Malleable Forms + Voice — UIST 2026 follow-on
**Branch:** `meeting/malleable-forms-voice-pweoi-bwixy`

## Audit: Current Data Model

### `portfolios.intent` (JSONB)

The `portfolios.intent` column stores a `StructuredIntent` object with four
keyed `IntentSection` values (`purpose`, `audience`, `exclusions`,
`constraints`). Each section carries its own `updatedAt` timestamp, which
enables per-section change detection in the pipeline strategy
(`determinePipelineStrategy`).

**Verdict for voice:** Intent sections can already accept incremental updates
because the pipeline only re-runs affected sections. A voice-captured refinement
maps directly to an `updatedPurpose` rewrite (same path as `resolveDesignProbeAction`).
No schema change required here.

### `portfolios.schema` (JSONB)

Stores the full `PortfolioSchema` (`fields[]`, `groups[]`, `version`,
`columnActions?`, `acceptedStandards?`). Version is bumped on each write.

**Verdict for voice:** A voice mapping step produces a `schemaPatch`
(`addFields`/`updateFields`/`removeFieldKeys`). Applying that patch increments
`version` and writes the new `PortfolioSchema` — same pattern as
`applyDesignProbe`. No structural change needed.

### `responses` table

Current schema:

| column | type | notes |
|---|---|---|
| `id` | uuid | PK |
| `portfolio_id` | uuid | FK → portfolios |
| `data` | JSONB | flat `Record<string, unknown>` |
| `submitted_at` | timestamptz | set on whole-form submit |

**Problem:** The `responses` table assumes **one atomic submission per row**.
There is no concept of:
- A partial / in-progress form fill attributed to a user
- Multiple incremental inserts by different users converging into one response
- A link from a specific field value back to the voice session or LLM call that produced it

This is a structural gap for voice-driven incremental fills.

### `design_probes` table

Already supports `source` (string), `status`, `resolved_by`, and per-probe
timestamps. Voice can reuse this by emitting clarification probes with
`source: "voice"`. No schema change needed.

### `provenance_log` table

Stores field-level diffs and `rationale`. Adding a `voice_session_id` column
would allow each log entry to carry a trace back to the originating voice
session. This is documented in the additions below.

---

## Required Schema Additions

### New table: `voice_sessions`

Represents one recording session by one user on one portfolio. A portfolio can
have many voice sessions; a single portfolio `response` row aggregates values
from potentially many sessions.

```sql
CREATE TABLE voice_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  user_id      text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now()
);
```

### New table: `voice_session_entries`

One row per field value extracted from a voice transcript. Carries the raw
transcript span, the mapped `fieldKey`, the resolved value, and the LLM
completion ID for traceability.

```sql
CREATE TABLE voice_session_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id          uuid NOT NULL REFERENCES voice_sessions(id) ON DELETE CASCADE,
  transcript          text NOT NULL,       -- verbatim transcript span
  field_key           text NOT NULL,       -- camelCase fieldKey
  value               jsonb,               -- extracted value (any JSON scalar)
  llm_completion_id   text,                -- AI SDK / Langfuse trace ID
  created_at          timestamptz NOT NULL DEFAULT now()
);
```

### Column addition: `provenance_log.voice_session_id`

```sql
ALTER TABLE provenance_log ADD COLUMN voice_session_id uuid
  REFERENCES voice_sessions(id) ON DELETE SET NULL;
```

### Column addition: `responses.voice_session_id`

```sql
ALTER TABLE responses ADD COLUMN voice_session_id uuid
  REFERENCES voice_sessions(id) ON DELETE SET NULL;
```

This allows a response row to be tagged as voice-originated, enabling the
"trace to transcript" affordance in the History view.

---

## API / Server Action Changes

| Action | File | Change |
|---|---|---|
| `transcribeAudioAction` | `voice-actions.ts` | NEW — stream audio to Whisper, return raw transcript. Fixture-guarded. |
| `mapTranscriptToSchemaAction` | `voice-actions.ts` | NEW — transcript → `schemaPatch` + `DesignProbeRaw[]` (voice clarifications). |
| `logProvenance` | `engine/provenance.ts` | Accept optional `voiceSessionId`. |

---

## Multi-Session Merge Strategy

- **Per-field last-writer wins** when sessions write different fields.
- **Conflict detection:** if two sessions write the same `fieldKey` within a
  time window (< 30 s), a `DesignProbeRaw` clarification is emitted with
  `source: "voice"` so the creator resolves it through the existing design-probe
  deck — no silent overwrites.
- Supabase Realtime broadcasts session-level events on the `voice_sessions`
  channel so collaborators see live updates.

---

## Paper Design Principle Mapping

| Principle | How voice additions support it |
|---|---|
| Iterative convergence | Incremental field inserts converge the same way as probe resolutions |
| Intent-schema co-persistence | Voice session entries are stored alongside schema changes in `provenance_log` |
| Decision traceability | `llm_completion_id` + `voice_session_id` link every field value to its origin |
| Scenario-driven derivation | Nurse pilot demonstrates voice-first intake across clinical roles |
