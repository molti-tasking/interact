-- Run this in the Supabase SQL editor to create the opinion_interactions table.

CREATE TABLE opinion_interactions (
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

CREATE INDEX idx_opinion_interactions_portfolio ON opinion_interactions(portfolio_id);
