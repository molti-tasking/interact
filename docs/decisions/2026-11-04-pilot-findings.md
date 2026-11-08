# Fixes from the Workshop Pilot, and Prolific Sessions

**Date:** 2026-11-04
**Context:** The first workshop (session H7VTHW, 11 lab colleagues,
27 Oct 2026) worked as a pilot. Before the main study on Prolific, these
problems had to be fixed. Numbers are from the study export and the Langfuse
traces of that session.

| Finding | Change |
|---|---|
| 8 of 11 agreed "the tool made changes I did not want"; 5 of 112 probe answers changed fields their preview didn't show | Patch scoping and field locks (1, 2) |
| Hidden dependencies scored 3.27/5; previews named fields but not *what* changed | Field-level change notes (3) |
| 27–44 of 104 answers were clicked before their preview was ready | Prioritized preview queue, waiting for in-flight previews (4) |
| Conflict detection: 333 calls, median 14 s, max 92 s | Shorter output, timeout, no checks mid-change (5) |
| Spending cap ran out mid-session; 50 calls failed with a raw `ExceededBudget` | Plain error message + loud server log (6) |
| "Accepted the default" couldn't be measured | Option-order and dismissal logging (7) |
| 5 of 11 asked to reorder fields | Drag and keyboard reordering (8) |

## Decisions

### 1. Locked fields are an invariant of the commit path

`Field.locked` is set by the creator in the field editor. Every automated
change leaves a locked field as it is: `applySchemaPatch` skips ops on it,
and `commitPortfolioChange` runs `protectLockedFields` on every change marked
`automated: true` (probe answers, intent refinement, generation, conflict
fixes, voice edits, exclusions), whatever produced the schema. The creator's
own edits aren't automated, so they still work on a locked field. The LLM is
told which fields are locked so it doesn't plan around them.

### 2. A preview's scope is what it may touch

When a probe answer's preview is computed, it records the keys it adds,
changes and removes (`ProbeOptionPreview.scope`). Applying the preview later,
even on a newer schema, drops every op outside that scope
(`applyProbeOption`). This covers two cases: an "add" turning into an
overwrite of a field created in the meantime, and a deleted field coming
back. The canvas preview, the optimistic update and the commit all use the
same function, so the creator is shown exactly what gets applied. Conflict
fixes may only change the fields the conflict names (`applyConflictFix`).

### 3. Changes to existing fields are spelled out

Option tiles list changes to existing fields first, with what changes
("~ Age (now required)"), and never fold them into "+N more". On the canvas,
the "Changed" badge says what changes. An intent edit that changes the form
shows a summary toast with Undo.

### 4. Background LLM calls don't block the creator

Next runs a client's server actions **one at a time**. In the pilot, a
click on an answer without a ready preview, or an "add field" request,
waited behind the queued previews, conflict checks and curation, each taking
5–90 s. The background calls and probe resolution now go through a Route
Handler (`/api/llm/<op>`), which runs requests in parallel. The operations
are the same server-action functions, so auth, rate limits and size caps are
unchanged. This is probably the largest single latency fix.

### 4b. Previews: priority first, never twice

Five previews run at once instead of three. The open probe runs first, then
the rest by priority. A click on an answer whose preview is still running
waits for it (up to 30 s) instead of starting a second LLM call for the same
answer. If the probe was answered elsewhere while waiting, nothing happens.

### 5. Conflict detection is bounded

Fields are cited as `f1…fn` instead of ids, which are about 25 tokens each
and were written back in every conflict. The output is capped at 4 conflicts
with 2 fixes each, the call has a 30 s timeout, and checks pause while an
answer or edit is still being applied. A check whose LLM part didn't finish
is marked `partial` and is retried a minute later, instead of being cached
as "no conflicts" for that form state.

### 6. Logging for the main study

- `probe_shown`: options in display order, which one keeps the form as it
  is, and whether previews were ready. Nothing in the deck is pre-selected.
- `probe_answered`: position, `answerSource` (option or custom), whether it
  was a no-change answer, and whether its preview was ready.
- `design_probes.closed_reason` (migration 012): `user`, `curated`,
  `stale_finding`, `declined` or `withdrawn`.
- `first_prompt`: the creator's first description, verbatim.
- `field_moved`, `probe_preview_awaited`, `completion_redirect`.

### 7. Prolific: panel link, private ids, balanced conditions

Panel participants join through
`/join?code=CODE&PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…`. They get a neutral
name ("Participant 7") and no name prompt. Their condition is the one with
the fewest participants so far in the session (`settings.conditions`). At
the end they go back to the session's completion URL.

- **Panel ids are kept out of `study_participants`,** which every
  participant of the session can read. They live in `study_assignments`,
  which only admins can read (verified against a local Postgres: a
  participant sees 0 rows). The export includes this table, so treat the
  export as personal data.
- **The completion URL holds the completion code,** so it isn't in
  `settings` either. It lives in `study_session_secrets` (admin-only), and
  `get_my_study_state` returns it only to panel participants, and only once
  the session is `done`.
- **The same PID from another browser resumes the seat,** but only if the
  first browser has been quiet for 90 s (heartbeats arrive every 30 s) or the
  facilitator allowed it. That way a leaked link can't take over a seat that
  is in use. A returning participant can still get in after the session is
  done, to reach the completion page.
- **Conditions:** `full`, and `no-probes`, an ablation without the probe deck
  (so also without conflict checks). In `no-probes`, intent edits don't
  generate or curate probes, findings from responses aren't turned into
  probes, and the study copy doesn't mention design questions. Whether the main study compares
  against this ablation or a plain-chat baseline is still open. The second
  option needs its own condition.

## Not done here

- **Self-paced sessions.** Phases are still moved on by a facilitator, so a
  Prolific run is a scheduled, synchronous batch. Fully asynchronous
  participation (per-participant phases, and peer answers from earlier
  batches) needs its own design.
- **The gateway budget** (LiteLLM key limit) is configured outside the repo.
  Raise it and set an alert before the study.
