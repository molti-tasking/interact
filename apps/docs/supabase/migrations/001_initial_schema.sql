-- Core artifact: the Intent Portfolio (Design Principle 2)
CREATE TABLE portfolios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title         TEXT NOT NULL,
  intent        TEXT NOT NULL,
  schema        JSONB NOT NULL,
  base_id       UUID REFERENCES portfolios(id),
  projection    JSONB,
  status        TEXT DEFAULT 'draft'
    CHECK (status IN ('draft', 'published')),
  creator_role  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- Append-only decision history (Design Principle 3)
CREATE TABLE provenance_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  layer         TEXT NOT NULL
    CHECK (layer IN ('intent', 'dimensions', 'configuration')),
  diff          JSONB NOT NULL,
  prev_intent   TEXT,
  prev_schema   JSONB,
  rationale     TEXT,
  actor         TEXT NOT NULL,
  creator_role  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Collected form responses (for published forms)
CREATE TABLE responses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id  UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  data          JSONB NOT NULL,
  submitted_at  TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_provenance_portfolio ON provenance_log(portfolio_id, created_at);
CREATE INDEX idx_portfolios_base ON portfolios(base_id);
CREATE INDEX idx_responses_portfolio ON responses(portfolio_id);
