-- Optimistic concurrency for the intent portfolio (Design Principles 2 + 3).
--
-- Several writers (design probe resolution, field edits, intent
-- backpropagation, conflict fixes, the pipeline, voice edits) used to write
-- the whole `schema` / `intent` JSONB back from a client-side snapshot taken
-- before a multi-second LLM call, so concurrent changes silently overwrote
-- each other. Every schema/intent write now goes through
-- `commit_portfolio_change`, which:
--   1. checks the caller's expected `revision` (compare-and-swap),
--   2. writes the new schema/intent and bumps the revision,
--   3. appends the provenance entry in the same transaction, with
--      prev_intent / prev_schema taken from the database rather than from
--      the client's (possibly stale) snapshot.
-- On a revision mismatch the function returns no row; the client re-reads,
-- re-applies its change to the fresh state and retries.

ALTER TABLE portfolios
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

-- Cheap list views (sidebar, portfolio grid, lineage banner) need the field
-- count but not the whole schema JSONB.
ALTER TABLE portfolios
  ADD COLUMN field_count INTEGER
    GENERATED ALWAYS AS (
      jsonb_array_length(COALESCE(schema->'fields', '[]'::jsonb))
    ) STORED;

CREATE INDEX IF NOT EXISTS idx_portfolios_space_updated
  ON portfolios(space_id, updated_at DESC);

-- Any direct schema/intent update (legacy code paths, SQL console) also bumps
-- the revision so in-flight commits based on the old state detect it.
CREATE OR REPLACE FUNCTION bump_portfolio_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.schema IS DISTINCT FROM OLD.schema
     OR NEW.intent IS DISTINCT FROM OLD.intent THEN
    NEW.revision := OLD.revision + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER portfolios_bump_revision
  BEFORE UPDATE ON portfolios
  FOR EACH ROW
  EXECUTE FUNCTION bump_portfolio_revision();

CREATE OR REPLACE FUNCTION commit_portfolio_change(
  p_portfolio_id      UUID,
  p_expected_revision INTEGER,
  p_schema            JSONB DEFAULT NULL,
  p_intent            JSONB DEFAULT NULL,
  p_title             TEXT  DEFAULT NULL,
  p_status            TEXT  DEFAULT NULL,
  -- { action, layer, actor, diff, rationale, creator_role } or NULL to skip logging
  p_provenance        JSONB DEFAULT NULL
)
RETURNS SETOF portfolios
LANGUAGE plpgsql
AS $$
DECLARE
  v_prev portfolios%ROWTYPE;
  v_new  portfolios%ROWTYPE;
BEGIN
  SELECT * INTO v_prev
  FROM portfolios
  WHERE id = p_portfolio_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portfolio % not found', p_portfolio_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Stale caller: return an empty set so the client can retry on fresh state.
  IF v_prev.revision <> p_expected_revision THEN
    RETURN;
  END IF;

  UPDATE portfolios SET
    schema     = COALESCE(p_schema, schema),
    intent     = COALESCE(p_intent, intent),
    title      = COALESCE(p_title, title),
    status     = COALESCE(p_status, status),
    revision   = v_prev.revision + 1,
    updated_at = now()
  WHERE id = p_portfolio_id
  RETURNING * INTO v_new;

  IF p_provenance IS NOT NULL THEN
    INSERT INTO provenance_log (
      portfolio_id, action, layer, diff, prev_intent, prev_schema,
      rationale, actor, creator_role
    ) VALUES (
      p_portfolio_id,
      p_provenance->>'action',
      p_provenance->>'layer',
      COALESCE(
        p_provenance->'diff',
        '{"added": [], "removed": [], "modified": []}'::jsonb
      ),
      v_prev.intent,
      v_prev.schema,
      p_provenance->>'rationale',
      COALESCE(p_provenance->>'actor', 'creator'),
      p_provenance->>'creator_role'
    );
  END IF;

  RETURN NEXT v_new;
END;
$$;

GRANT EXECUTE ON FUNCTION commit_portfolio_change(
  UUID, INTEGER, JSONB, JSONB, TEXT, TEXT, JSONB
) TO anon, authenticated, service_role;
