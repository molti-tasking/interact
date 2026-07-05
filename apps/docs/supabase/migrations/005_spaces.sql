-- Spaces: a grouping context above portfolios.
-- A user picks a space at the start of a session (or the system creates one
-- automatically), and every portfolio belongs to exactly one space.

CREATE TABLE spaces (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  -- 'user' when explicitly created, 'system' when auto-created on first use
  origin        TEXT NOT NULL DEFAULT 'user'
    CHECK (origin IN ('user', 'system')),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE portfolios
  ADD COLUMN space_id UUID REFERENCES spaces(id) ON DELETE SET NULL;

CREATE INDEX idx_portfolios_space ON portfolios(space_id);

-- Backfill: adopt existing portfolios into an auto-created default space so
-- every pre-existing portfolio remains reachable through the spaces UI.
DO $$
DECLARE
  default_space UUID;
BEGIN
  IF EXISTS (SELECT 1 FROM portfolios WHERE space_id IS NULL) THEN
    INSERT INTO spaces (name, description, origin)
    VALUES ('My Space', 'Automatically created for existing portfolios', 'system')
    RETURNING id INTO default_space;

    UPDATE portfolios SET space_id = default_space WHERE space_id IS NULL;
  END IF;
END $$;
