-- Rank design probes by impact and pre-compute what each answer would
-- change, so the deck can show the most important decision first and
-- preview (and apply) an answer without waiting for the LLM.
--
-- priority: 1 = high, 2 = medium, 3 = low.
-- preview_status: 'pending' | 'ready' | 'failed'; NULL for probes created
-- before previews existed (backfilled lazily by the client). The previews
-- themselves live inside each option of the existing `options` jsonb.

ALTER TABLE design_probes
  ADD COLUMN priority SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN preview_status TEXT;
