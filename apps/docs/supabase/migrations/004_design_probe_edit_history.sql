-- Add edit history tracking to design probes so resolved probes can be
-- re-edited and we know who changed what and when.

ALTER TABLE design_probes
  ADD COLUMN resolved_at TIMESTAMPTZ,
  ADD COLUMN resolved_by TEXT,
  ADD COLUMN edited_at TIMESTAMPTZ,
  ADD COLUMN edited_by TEXT,
  ADD COLUMN edit_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN previous_selected_option TEXT;
