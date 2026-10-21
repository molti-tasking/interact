# Workshop Study Mode

**Date:** 2026-10-21
**Context:** UIST 2026 rejected the paper for lacking a user study. We run a
workshop instead: ~10 expert participants in one room.

## Protocol

1. **Create** (≈15 min): each participant designs a form about their hobby.
2. **Answer** (≈30 min): each participant answers *every* other form.
3. **Review & refine** (≈15 min): each participant reads the answers to
   their own form — is the structure of the responses useful? — and refines it.
4. **Reflect**: one final questionnaire (SUS, CDN items, open reflection).

## Design Decisions

### 1. Anonymous sign-in + join code, not accounts

Participants enter a 6-character code and a display name; the browser signs
in anonymously (Supabase). No passwords, no PII, and the seat survives
reloads. A facilitator "reassign seat" covers lost browsers.

GoTrue treats anonymous sign-ins as sign-ups, so `DISABLE_SIGNUP=true`
blocks joining (verified: `422 signup_disabled`). We allow sign-ups: a stray
email account gets no access (neither admin nor participant). A
before-user-created hook admitting only anonymous users would close that
gap too (verified locally) but was left out to keep the deployment simple.

### 2. Ownership through RLS, not a second app

`portfolios.owner_id` + narrow participant policies (migration 011): own form
only, no insert/delete, and a trigger that blocks status/owner/lineage
changes (`commit_portfolio_change` accepts a status, so hiding the Publish
button alone would not do). The admin app is unchanged; participants reuse
the same workspace and responses components, narrowed by a
`CapabilitiesProvider`.

### 3. Peers answer through the respondent RPCs, forms are never published

`get_published_form` / `submit_response` also accept *study peers* while the
session is answering (plus a 2-minute grace window). Forms never appear on
the public `/forms/<id>` route; each peer answers each form once.

### 4. Facilitator-driven phases

One `advance_study_phase` RPC moves the whole room and, when leaving
*create* or *review*, snapshots every form with its probes in the same
transaction. Participants poll their state every 2 s (server clock included,
so countdowns agree). The countdown is a soft deadline.

### 5. Data capture

- `study_snapshots`: form state at phase boundaries (before/after refinement).
- `study_events`: what `provenance_log` doesn't capture — probe expansions,
  option previews with dwell time, skips, peer-form timing, findings shown and
  sent to Design, tour steps, heartbeats (time-on-task).
- `provenance_log.actor_user_id`: server-side attribution of every change.
- Langfuse `userId` = Supabase user id, so LLM cost/latency per participant.

### 6. Review phase connects responses back to design

Findings ("nobody picks X", "everyone skips Y") normally need 20 responses;
a workshop form gets ~9, so the threshold is a session setting (default 3).
"Ask in Design" turns a finding into a design probe — the response→schema
backpropagation the paper argues for, now observable in a study.

### 7. Voice off by default

Ten people dictating in one room produces cross-talk. Voice is a session
toggle for setups with headsets.

## Paper Design Principle Mapping

| Principle | What the study can now observe |
|---|---|
| Iterative convergence | Snapshots end of create vs. end of review; revisions per participant |
| Intent-schema co-persistence | Intent edits and schema changes in provenance, per participant |
| Decision traceability | Probe answers, previews looked at, findings sent to Design |
| Scenario-driven derivation | Real answers from peers driving refinements |
