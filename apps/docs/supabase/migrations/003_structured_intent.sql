-- Migration: Replace monolithic intent TEXT with structured intent JSONB
-- Supports the "intent portfolio" concept: purpose, audience, exclusions, constraints
-- Each section has content + updatedAt for per-section change detection.

-- 1. Convert portfolios.intent from TEXT to JSONB
ALTER TABLE portfolios
  ALTER COLUMN intent TYPE JSONB USING jsonb_build_object(
    'purpose',     jsonb_build_object('content', COALESCE(intent, ''), 'updatedAt', now()::text),
    'audience',    jsonb_build_object('content', '', 'updatedAt', now()::text),
    'exclusions',  jsonb_build_object('content', '', 'updatedAt', now()::text),
    'constraints', jsonb_build_object('content', '', 'updatedAt', now()::text)
  );

-- 2. Convert provenance_log.prev_intent from TEXT to JSONB
ALTER TABLE provenance_log
  ALTER COLUMN prev_intent TYPE JSONB USING
    CASE WHEN prev_intent IS NOT NULL
      THEN jsonb_build_object(
        'purpose',     jsonb_build_object('content', prev_intent, 'updatedAt', now()::text),
        'audience',    jsonb_build_object('content', '', 'updatedAt', now()::text),
        'exclusions',  jsonb_build_object('content', '', 'updatedAt', now()::text),
        'constraints', jsonb_build_object('content', '', 'updatedAt', now()::text)
      )
      ELSE NULL
    END;
