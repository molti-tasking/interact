-- Why a design probe left the deck without an answer.
--
-- Both a creator's "dismiss" and the curator retiring a question set
-- status = 'dismissed', so the workshop pilot couldn't tell rejected
-- suggestions from questions the system withdrew — which matters for the
-- "do people just accept defaults" analysis.
--
-- closed_reason (NULL while open or answered):
--   'user'          the creator dismissed it
--   'curated'       the curator retired it after the form changed
--   'stale_finding' a finding from the responses no longer applies
--   'declined'      a standard suggestion the creator turned down
--   'withdrawn'     a follow-up whose answer was undone

ALTER TABLE design_probes
  ADD COLUMN closed_reason TEXT
    CHECK (closed_reason IN ('user', 'curated', 'stale_finding', 'declined', 'withdrawn'));
