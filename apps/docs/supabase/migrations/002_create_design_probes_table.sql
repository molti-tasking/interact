-- Design probes: system-generated decision prompts that surface design
-- tradeoffs and ask the creator to resolve them (a form of directed backtalk).

CREATE TABLE design_probes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  explanation TEXT,
  layer TEXT NOT NULL DEFAULT 'both',
  source TEXT NOT NULL DEFAULT 'llm',
  options JSONB NOT NULL DEFAULT '[]',
  selected_option TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  dimension_id TEXT,
  dimension_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_design_probes_portfolio ON design_probes(portfolio_id);
