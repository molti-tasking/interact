# Voice Interaction Variants + Spaces

**Date:** 2026-07-05
**Context:** Voice-driven form creation (record mode)
**Branch:** `claude/voice-form-creation-integration-twq6jx`

## Problems

1. **Lost dictation race.** Record mode only disabled the mic during
   transcription, not while the pipeline ran. The base intent ref was updated
   only after the pipeline resolved, so a phrase spoken while the previous one
   was processing was built on stale intent — silently dropping the earlier
   phrase.
2. **Voice defeated the incremental pipeline.** Every utterance was appended
   to `purpose`, and any purpose change forces the `full` strategy. Saying
   "don't collect phone numbers" never reached the cheap deterministic
   `filter-only` path.
3. **Append-only intent degraded into a transcript.** Ten utterances —
   corrections and contradictions included — accumulated as raw speech,
   undermining intent-schema co-persistence (Design Principle 2).
4. **No grouping context.** Portfolios were a flat list; voice-first sessions
   had no place to land.

## Design Decisions

### 1. Serialized utterance queue (`useUtteranceProcessor`)

All utterances flow through a single promise chain. A phrase spoken while the
previous one is processing is queued, not raced: each queued item reads the
state produced by its predecessor. External state (portfolio refetches) is
adopted only while the queue is idle. The mic stays usable during processing —
hands-free dictation keeps flowing.

### 2. Utterance routing (`routeUtteranceAction`)

A single cheap LLM call classifies each utterance:

- **Section talk** → merged into the affected sections (`purpose`,
  `audience`, `exclusions`, `constraints`) as *synthesized* coherent prose —
  newest statement wins over contradictions, no raw transcript concatenation.
  The existing `determinePipelineStrategy` then picks the minimal work:
  exclusions-only → deterministic filter (no LLM), constraints-only →
  conflict re-check, purpose/audience → full pipeline.
- **Direct form edits** ("make email required") → the patch-based
  `resolveDesignProbeAction` path: schema patch + purpose rewrite +
  provenance (`voice_edit`), no full regeneration.

### 3. Three interaction variants, side by side

| Variant | Behavior | Why keep it |
|---------|----------|-------------|
| Smart (default) | Route + synthesize + minimal pipeline | The fix for problems 2–3 |
| Append | Raw transcript → purpose → full pipeline | Baseline for comparison studies |
| Review | Transcript waits in an editable confirmation card; applied via smart routing | Recovery from ASR errors before they mutate the form |

The variant switcher lives in record mode and persists in `localStorage`.
Keeping variants comparable supports the paper's evaluation story.

### 4. Spaces

`spaces` table + `portfolios.space_id`. A space is chosen at the beginning of
the record flow — or created automatically:

- **Quick start** (record entry): the system reuses/creates a system-origin
  space, creates a fresh portfolio in it, and drops straight into dictation.
- **New portfolio form**: a space selector defaulting to "Automatic — create
  a space for me" (`useEnsureSpace` get-or-create).
- Migration backfills existing portfolios into an auto-created default space.

`origin` (`user` | `system`) records whether a space was deliberately created
or system-provided — useful for later UX decisions (e.g. renaming prompts).
