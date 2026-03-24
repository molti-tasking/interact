# Structured Intent + Smart Pipeline

**Date:** 2026-03-24
**Context:** UIST 2026 paper — Lazy Data Space Elicitation
**Branch:** `feature/conflict-resolution-opinions`

## Problem

The `handleGenerate` function in `ConversationPane.tsx` fired 3-4 sequential LLM calls (dimensions, schema, opinions, conflicts) on every button click, even when nothing changed. The intent was a monolithic `TEXT` column — no way to detect what changed or skip irrelevant processing. Clicking "Refine Form" without changes was pointless.

## Design Decisions

### 1. Keep dimensions, cache aggressively

Dimensions are the paper's "lazy elicitation" mechanism — the structured discovery step between raw intent and concrete fields. Removing them would undercut the paper's core claim about iterative schema discovery. Instead, we cache them by `hash(purpose + audience)` and skip the LLM call when these haven't changed.

### 2. Structured intent as JSONB, single editor with markdown parsing

The `portfolios.intent` column was changed from `TEXT` to `JSONB` with typed sections: `purpose`, `audience`, `exclusions`, `constraints`. Each section is an `IntentSection { content, updatedAt }`.

The UI presents a **single markdown editor**. Sections are parsed from `## Heading` conventions and serialized back. If the user writes plain text without headings, everything goes into `purpose`. This keeps friction low while the structured data model underneath enables per-section change detection and pipeline strategy.

**Refinements were removed** from the structured intent. Opinion decisions are already tracked in the `opinion_interactions` table — duplicating them in the intent would create two sources of truth. When LLM prompts need context about resolved opinions, they can be derived from the opinions table at query time.

This supports:
- **Intent-schema co-persistence** (Design Principle 2): structured JSONB artifact, not opaque text
- **Low friction**: single editor, no form-to-create-a-form problem
- **Future direction**: the markdown editor could evolve into an interactive canvas with section blocks

### 3. Pipeline strategy pattern

A `determinePipelineStrategy()` function computes the minimal work needed based on which sections changed:
- Purpose/audience changed → full pipeline (dimensions + schema + opinions)
- Only exclusions changed → deterministic field filtering (no LLM)
- Only constraints changed → re-check conflicts only
- Only refinements changed → regenerate opinions only
- Nothing changed → noop (zero LLM calls)

### 4. Opinion resolution writes refinement deltas (not full rewrites)

Previously, resolving an opinion made the LLM rewrite the entire intent string. Now it returns a `refinementDelta` — a short sentence summarizing the decision. This gets appended to the read-only `refinements` section. Benefits:
- No cascading full pipeline re-runs (refinements-only change → opinions-only strategy)
- User sees accumulated decisions as a traceable list
- Decision traceability (Design Principle 3) is visible in the UI

### 5. Sync/reactivity is in scope for the paper

The section-based structure creates natural dependency boundaries:
```
purpose → dimensions → schema → [opinions, conflicts]
exclusions → schema (filter, no LLM)
constraints → conflicts
refinements → opinions
```
This can be framed as: "structured intent sections enable incremental convergence" (Design Principle 1).

## Paper Design Principle Mapping

| Principle | How this refactoring supports it |
|-----------|----------------------------------|
| Iterative convergence | Pipeline strategy means each edit only converges the affected portion |
| Intent-schema co-persistence | Structured intent is a first-class JSONB artifact alongside schema |
| Decision traceability | Refinements section + per-section provenance logging |
| Scenario-driven derivation | Untouched, but benefits from cleaner intent structure for future projection work |

## What was filtered out as irrelevant

- **Build-system / Adapton reactive dependency graphs** — over-engineered for a research prototype
- **Parallelization as a research contribution** — it's just an implementation detail
- **Eliminating dimensions** — they ARE the "structured conversational process" the paper claims
