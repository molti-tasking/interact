-- Several deployments of the app, one per model, can share this database
-- (docs/study/prolific-runbook.md, "Several models"). A briefs session
-- records the model it was opened with (`settings.run.model`); a
-- participant's model calls must then come from a deployment that runs that
-- model, or one model's forms would end up in another model's session.
--
-- The app asks, before every model call of a participant, whether their
-- running session was opened with the model this deployment uses. Only
-- true or false comes back: participants don't learn which model runs.

CREATE OR REPLACE FUNCTION public.my_study_runs_on(p_model TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.study_participants sp
    JOIN public.study_sessions s ON s.id = sp.session_id
    LEFT JOIN public.study_progress pr ON pr.participant_id = sp.id
    WHERE sp.user_id = auth.uid()
      AND s.phase <> 'done'
      AND pr.completed_at IS NULL
      AND coalesce(s.settings->'run'->>'model', '') <> ''
      AND s.settings->'run'->>'model' <> btrim(coalesce(p_model, ''))
  );
$$;

REVOKE EXECUTE ON FUNCTION public.my_study_runs_on(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_study_runs_on(TEXT) TO authenticated, service_role;
