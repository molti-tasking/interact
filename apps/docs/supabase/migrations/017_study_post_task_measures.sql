-- Post-task measures in briefs sessions, and forcing an arm for local
-- testing (docs/decisions/2026-11-13-study-assistant-baseline.md).
--
-- 1. Post-task measures. A briefs session with
--    `settings.postTaskMeasures = true` (every session created from now on)
--    has three more steps after each task, before the quiz:
--
--      brief:n → task:n → ratings:n → recall:n → why:n → quiz:n
--
--    Sessions without the setting keep the steps of migration 014, so
--    participants of a running session see no change.
--
-- 2. Forcing an arm. On a local machine the authors open a study link with
--    `arm=<condition>` to try each arm. The page then calls
--    `force_my_study_arm`, which changes the caller's own condition while
--    they are still on the consent step — and only while
--    `study_local_mode.forced_arms` is true. Nobody but the database owner
--    can write that row; the local setup script (`pnpm study:local`) does.
--    On a deployment it does not exist, so the call changes nothing.

-- ---------------------------------------------------------------------------
-- 1. Steps
-- ---------------------------------------------------------------------------

-- The steps of a briefs session with `p_tasks` tasks, given its settings.
CREATE OR REPLACE FUNCTION public.study_steps(p_settings JSONB, p_tasks INTEGER)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN coalesce(p_settings->>'postTaskMeasures', 'false') = 'true' THEN
      ARRAY['consent', 'intro']
      || coalesce((
           SELECT array_agg(s.step ORDER BY i.n, s.ord)
           FROM generate_series(1, greatest(p_tasks, 0)) AS i(n)
           CROSS JOIN LATERAL (
             VALUES (1, 'brief:' || i.n), (2, 'task:' || i.n), (3, 'ratings:' || i.n),
                    (4, 'recall:' || i.n), (5, 'why:' || i.n), (6, 'quiz:' || i.n)
           ) AS s(ord, step)
         ), ARRAY[]::TEXT[])
      || ARRAY['questionnaire', 'done']
    ELSE public.study_brief_steps(p_tasks)
  END;
$$;

-- As in 014, with the steps from `study_steps`.
CREATE OR REPLACE FUNCTION public.advance_my_study_step(
  p_session_id  UUID,
  p_from        TEXT,
  p_reason      TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part     public.study_participants%ROWTYPE;
  v_progress public.study_progress%ROWTYPE;
  v_session  public.study_sessions%ROWTYPE;
  v_task     public.study_tasks%ROWTYPE;
  v_steps    TEXT[];
  v_index    INTEGER;
  v_next     TEXT;
  v_pos      INTEGER;
BEGIN
  SELECT * INTO v_part FROM public.study_participants
  WHERE session_id = p_session_id AND user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You are not part of this study' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_progress FROM public.study_progress
  WHERE participant_id = v_part.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This session has no steps' USING ERRCODE = 'P0002';
  END IF;
  IF v_progress.completed_at IS NOT NULL OR v_progress.step <> p_from THEN
    RETURN v_progress.step;
  END IF;

  SELECT * INTO v_session FROM public.study_sessions WHERE id = p_session_id;
  IF v_session.phase = 'done' THEN
    RAISE EXCEPTION 'This study has ended' USING ERRCODE = 'P0002';
  END IF;

  v_steps := public.study_steps(
    v_session.settings,
    (SELECT count(*)::int FROM public.study_tasks WHERE participant_id = v_part.id)
  );
  v_index := array_position(v_steps, v_progress.step);
  IF v_index IS NULL OR v_index >= cardinality(v_steps) THEN
    RETURN v_progress.step;
  END IF;
  v_next := v_steps[v_index + 1];

  -- Leaving a task: stop its clock and keep the form as it is now
  IF v_progress.step LIKE 'task:%' THEN
    v_pos := split_part(v_progress.step, ':', 2)::int;
    UPDATE public.study_tasks
    SET finished_at = now(),
        finished_by = CASE WHEN p_reason = 'timeout' THEN 'timeout' ELSE 'participant' END
    WHERE participant_id = v_part.id AND position = v_pos
    RETURNING * INTO v_task;
    INSERT INTO public.study_snapshots (
      session_id, participant_id, portfolio_id, label,
      title, intent, schema, revision, design_probes
    )
    SELECT p_session_id, v_part.id, p.id, 'task:' || v_pos || ':' || v_task.brief,
           p.title, p.intent, p.schema, p.revision,
           coalesce((
             SELECT jsonb_agg(to_jsonb(dp) ORDER BY dp.created_at)
             FROM public.design_probes dp WHERE dp.portfolio_id = p.id
           ), '[]'::jsonb)
    FROM public.portfolios p WHERE p.id = v_task.portfolio_id;
  END IF;

  -- Entering a brief: its form becomes the participant's current one
  IF v_next LIKE 'brief:%' THEN
    v_pos := split_part(v_next, ':', 2)::int;
    UPDATE public.study_participants sp
    SET portfolio_id = t.portfolio_id
    FROM public.study_tasks t
    WHERE sp.id = v_part.id AND t.participant_id = v_part.id AND t.position = v_pos;
  END IF;

  -- Entering a task: its clock starts (once)
  IF v_next LIKE 'task:%' THEN
    v_pos := split_part(v_next, ':', 2)::int;
    UPDATE public.study_tasks SET started_at = coalesce(started_at, now())
    WHERE participant_id = v_part.id AND position = v_pos;
  END IF;

  UPDATE public.study_progress SET
    step = v_next,
    step_started_at = now(),
    consented_at = CASE WHEN v_progress.step = 'consent' THEN now() ELSE consented_at END,
    completed_at = CASE WHEN v_next = 'done' THEN now() ELSE completed_at END,
    outcome = CASE WHEN v_next = 'done' THEN 'completed' ELSE outcome END
  WHERE participant_id = v_part.id;

  INSERT INTO public.study_events (session_id, participant_id, phase, type, portfolio_id, payload)
  VALUES (p_session_id, v_part.id, v_next, 'step_entered', v_part.portfolio_id,
          jsonb_build_object('from', v_progress.step, 'reason', p_reason));

  RETURN v_next;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.study_steps(JSONB, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.study_steps(JSONB, INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Forcing an arm (local testing only)
-- ---------------------------------------------------------------------------

-- One row at most. No policies: participants and researchers can neither
-- read nor write it; the database owner (the local setup script) can.
CREATE TABLE IF NOT EXISTS public.study_local_mode (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  forced_arms  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.study_local_mode ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.study_local_mode FROM anon, authenticated;

COMMENT ON TABLE public.study_local_mode IS
  'Local testing only: forced_arms = true lets a study link pick its arm (arm=<condition>). Never set on a deployment.';

-- The caller's own condition, while they are on the consent step. Returns
-- the condition now in effect, or NULL when forcing is off (ignored).
CREATE OR REPLACE FUNCTION public.force_my_study_arm(p_session_id UUID, p_arm TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part      UUID;
  v_previous  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.study_local_mode WHERE forced_arms) THEN
    RETURN NULL;
  END IF;
  IF p_arm IS NULL OR p_arm NOT IN ('full', 'no-probes', 'baseline', 'assistant') THEN
    RAISE EXCEPTION 'Unknown arm' USING ERRCODE = '22023';
  END IF;

  SELECT sp.id, a.condition INTO v_part, v_previous
  FROM public.study_participants sp
  JOIN public.study_assignments a ON a.participant_id = sp.id
  JOIN public.study_progress pr ON pr.participant_id = sp.id
  WHERE sp.session_id = p_session_id
    AND sp.user_id = auth.uid()
    AND pr.step = 'consent'
    AND pr.completed_at IS NULL;
  IF v_part IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_previous IS DISTINCT FROM p_arm THEN
    UPDATE public.study_assignments SET condition = p_arm WHERE participant_id = v_part;
    INSERT INTO public.study_events (session_id, participant_id, phase, type, payload)
    VALUES (p_session_id, v_part, 'consent', 'arm_forced',
            jsonb_build_object('arm', p_arm, 'previous', v_previous));
  END IF;
  RETURN p_arm;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.force_my_study_arm(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_my_study_arm(UUID, TEXT) TO authenticated, service_role;
