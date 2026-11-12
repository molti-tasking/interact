-- The intent out of step with the form, made visible.
--
-- After a direct field edit (or an applied answer), a background model call
-- rewords the purpose so that the intent keeps describing the form. In the
-- workshop pilot, 25 of these calls failed on the gateway's budget and the
-- intents were left stale without anyone seeing it.
--
-- `portfolios.intent_sync` records that the intent is behind the form, or
-- NULL when it is in step:
--
--   { "state":    "pending" | "failed",
--     "since":    ISO time of the oldest change not yet reflected,
--     "edits":    [{ "text", "at", "decision" }],   -- what is not reflected
--     "attempts": number,
--     "reason":   "budget" | "rate-limit" | "timeout" | "conflict" | "other",
--     "message":  the plain-language error of the last failed attempt }
--
-- The editor shows the intent as out of sync when the last attempt failed,
-- or when the update is still pending after a timeout. The flag is cleared
-- only after a sync succeeded.
--
-- It is written by the client outside `commit_portfolio_change` on purpose:
-- it is not a change to the form or the intent, so it neither bumps
-- `revision` (the trigger reacts to schema/intent only) nor enters the
-- history. Owners can update it under the existing row policy.

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS intent_sync JSONB;

COMMENT ON COLUMN public.portfolios.intent_sync IS
  'The intent is behind the form: {state, since, edits, attempts, reason, message}; NULL when in step (migration 016)';
