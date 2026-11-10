-- Self-paced studies with fixed briefs (the Prolific comparison study).
--
-- A workshop session (011) is moved through its phases by a facilitator. A
-- "briefs" session (`settings.mode = 'briefs'`) has no facilitator: every
-- panel participant walks through the same steps alone,
--
--   consent → intro → [brief → task → quiz] × N → questionnaire → done
--
-- and builds one form per brief. The session's `phase` only says whether the
-- study is open: 'lobby' = not open (yet), 'create' = open, 'done' = closed.
--
-- Session settings (JSONB, no schema change):
--   mode:        'workshop' (default) | 'briefs'
--   briefs:      ["camp", "foster"]   — brief keys, see src/lib/study/briefs.ts
--   taskSeconds: 720                  — time limit per task
--   conditions:  ["full", "baseline"] — as in 013
--
-- Assignment is between subjects: condition × order of the briefs. A joiner
-- gets the cell with the fewest participants who finished or are still
-- active, so seats that were abandoned (returned or timed out on the panel)
-- are refilled instead of leaving a cell short.

ALTER TABLE public.study_assignments
  ADD COLUMN IF NOT EXISTS task_order INTEGER;

CREATE TABLE public.study_progress (
  participant_id   UUID PRIMARY KEY
    REFERENCES public.study_participants(id) ON DELETE CASCADE,
  session_id       UUID NOT NULL
    REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  step             TEXT NOT NULL DEFAULT 'consent',
  step_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  consented_at     TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  -- 'completed' | 'declined' (no consent)
  outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('completed', 'declined'))
);

CREATE INDEX idx_study_progress_session ON public.study_progress(session_id);

CREATE TABLE public.study_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  UUID NOT NULL
    REFERENCES public.study_participants(id) ON DELETE CASCADE,
  session_id      UUID NOT NULL
    REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  -- 1-based position in this participant's order
  position        INTEGER NOT NULL,
  brief           TEXT NOT NULL,
  portfolio_id    UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  started_at      TIMESTAMPTZ,
  finished_at     TIMESTAMPTZ,
  -- 'participant' | 'timeout'
  finished_by     TEXT,
  UNIQUE (participant_id, position)
);

CREATE INDEX idx_study_tasks_session ON public.study_tasks(session_id);

-- Admins only; participants get their own rows through get_my_study_state
ALTER TABLE public.study_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_admin_all ON public.study_progress
  FOR ALL TO authenticated
  USING ((SELECT public.is_app_admin()))
  WITH CHECK ((SELECT public.is_app_admin()));

ALTER TABLE public.study_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_admin_all ON public.study_tasks
  FOR ALL TO authenticated
  USING ((SELECT public.is_app_admin()))
  WITH CHECK ((SELECT public.is_app_admin()));

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The steps of a briefs session with `p_tasks` tasks, in order.
CREATE OR REPLACE FUNCTION public.study_brief_steps(p_tasks INTEGER)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT ARRAY['consent', 'intro']
      || coalesce((
           SELECT array_agg(s.step ORDER BY i.n, s.ord)
           FROM generate_series(1, greatest(p_tasks, 0)) AS i(n)
           CROSS JOIN LATERAL (
             VALUES (1, 'brief:' || i.n), (2, 'task:' || i.n), (3, 'quiz:' || i.n)
           ) AS s(ord, step)
         ), ARRAY[]::TEXT[])
      || ARRAY['questionnaire', 'done'];
$$;

-- LLM access (011): a participant of a session that is still running — and,
-- in a briefs session, who hasn't finished or declined.
CREATE OR REPLACE FUNCTION public.is_study_participant()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.study_participants sp
    JOIN public.study_sessions s ON s.id = sp.session_id
    LEFT JOIN public.study_progress pr ON pr.participant_id = sp.id
    WHERE sp.user_id = auth.uid()
      AND s.phase <> 'done'
      AND pr.completed_at IS NULL
  );
$$;

-- ---------------------------------------------------------------------------
-- Join from a panel link (replaces 013): + briefs sessions
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.join_study_session_external(
  p_code                 TEXT,
  p_source               TEXT,
  p_external_id          TEXT,
  p_external_study_id    TEXT,
  p_external_session_id  TEXT,
  p_intent               JSONB,
  p_schema               JSONB
)
RETURNS TABLE (session_id UUID, participant_id UUID, portfolio_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid        UUID := auth.uid();
  v_session    public.study_sessions%ROWTYPE;
  v_assign     public.study_assignments%ROWTYPE;
  v_part       public.study_participants%ROWTYPE;
  v_source     TEXT := lower(btrim(coalesce(p_source, '')));
  v_ext        TEXT := btrim(coalesce(p_external_id, ''));
  v_briefs_mode BOOLEAN;
  v_briefs     TEXT[];
  v_conditions TEXT[];
  v_condition  TEXT;
  v_order      INTEGER;
  v_n          INTEGER;
  v_i          INTEGER;
  v_portfolio  UUID;
  v_first      UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in first' USING ERRCODE = '28000';
  END IF;
  IF v_source !~ '^[a-z][a-z0-9_-]{1,19}$' OR v_ext !~ '^[A-Za-z0-9_-]{1,64}$' THEN
    RAISE EXCEPTION 'This study link is incomplete' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.study_sessions
  WHERE upper(join_code) = upper(btrim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No session with this code' USING ERRCODE = 'P0002';
  END IF;

  v_briefs_mode := v_session.settings->>'mode' = 'briefs';

  -- Serialize joins per session (participant numbers, cell balance)
  PERFORM pg_advisory_xact_lock(hashtext('study_join:' || v_session.id::text));

  -- Same panel participant again (reload, another browser): their seat
  SELECT * INTO v_assign
  FROM public.study_assignments a
  WHERE a.session_id = v_session.id
    AND a.external_source = v_source
    AND a.external_id = v_ext;
  IF FOUND THEN
    SELECT * INTO v_part FROM public.study_participants
    WHERE id = v_assign.participant_id FOR UPDATE;
    IF v_part.user_id <> v_uid THEN
      -- Another browser: only when the old one has gone quiet (heartbeats
      -- every 30 s touch last_seen_at) or the facilitator allowed it, so a
      -- leaked link can't take over a seat that is in use
      IF v_part.last_seen_at > now() - interval '90 seconds'
         AND (v_part.rejoin_until IS NULL OR v_part.rejoin_until < now()) THEN
        RAISE EXCEPTION 'This study is open in another browser. Close it there, wait a minute, and open the link again.'
          USING ERRCODE = '23505';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.study_participants sp
        WHERE sp.session_id = v_session.id AND sp.user_id = v_uid
      ) THEN
        RAISE EXCEPTION 'This browser already takes part in this session'
          USING ERRCODE = '23505';
      END IF;
      -- Their answers to this session's forms move with the seat
      UPDATE public.responses r SET respondent_id = v_uid
        WHERE r.respondent_id = v_part.user_id
          AND r.portfolio_id IN (
            SELECT sp.portfolio_id FROM public.study_participants sp
            WHERE sp.session_id = v_session.id
          );
      -- Every form of theirs: the current one and the other tasks'
      UPDATE public.portfolios SET owner_id = v_uid
        WHERE id = v_part.portfolio_id
           OR id IN (SELECT t.portfolio_id FROM public.study_tasks t
                     WHERE t.participant_id = v_part.id);
      UPDATE public.study_participants
        SET user_id = v_uid, rejoin_until = NULL, last_seen_at = now()
        WHERE id = v_part.id;
      INSERT INTO public.study_events (session_id, participant_id, phase, type)
      VALUES (v_session.id, v_part.id, v_session.phase, 'seat_reassigned');
    END IF;
    -- Also after the end: a returning participant still reaches the
    -- completion page
    RETURN QUERY SELECT v_session.id, v_part.id, v_part.portfolio_id;
    RETURN;
  END IF;

  IF v_session.phase = 'done' THEN
    RAISE EXCEPTION 'This study has ended' USING ERRCODE = 'P0002';
  END IF;
  IF v_briefs_mode AND v_session.phase = 'lobby' THEN
    RAISE EXCEPTION 'This study is not open at the moment. Please try again later.'
      USING ERRCODE = 'P0002';
  END IF;

  -- This browser already has a seat in the session (e.g. joined by code)
  SELECT * INTO v_part
  FROM public.study_participants sp
  WHERE sp.session_id = v_session.id AND sp.user_id = v_uid;
  IF FOUND THEN
    RAISE EXCEPTION 'This browser already takes part in this session'
      USING ERRCODE = '23505';
  END IF;

  SELECT coalesce(array_agg(c.value ORDER BY c.ord), ARRAY[]::TEXT[]) INTO v_conditions
  FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_session.settings->'conditions') = 'array'
              THEN v_session.settings->'conditions' ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS c(value, ord);

  IF v_briefs_mode THEN
    SELECT coalesce(array_agg(b.value ORDER BY b.ord), ARRAY[]::TEXT[]) INTO v_briefs
    FROM jsonb_array_elements_text(
           CASE WHEN jsonb_typeof(v_session.settings->'briefs') = 'array'
                THEN v_session.settings->'briefs' ELSE '[]'::jsonb END
         ) WITH ORDINALITY AS b(value, ord);
    IF cardinality(v_briefs) = 0 THEN
      RAISE EXCEPTION 'This study has no tasks yet' USING ERRCODE = 'P0002';
    END IF;

    -- Cell = condition × order (order k starts with brief k+1 and wraps
    -- around: a Latin square). The emptiest cell wins; listed order breaks
    -- ties. Only seats that finished or are still active count.
    SELECT cell.condition, cell.ord INTO v_condition, v_order
    FROM (
      SELECT c.value AS condition, c.ord AS c_ord, o.ord AS ord
      FROM unnest(
             CASE WHEN cardinality(v_conditions) = 0
                  THEN ARRAY[NULL]::TEXT[] ELSE v_conditions END
           ) WITH ORDINALITY AS c(value, ord)
      CROSS JOIN generate_series(0, cardinality(v_briefs) - 1) AS o(ord)
    ) cell
    ORDER BY (
      SELECT count(*)
      FROM public.study_assignments a
      JOIN public.study_participants sp ON sp.id = a.participant_id
      LEFT JOIN public.study_progress pr ON pr.participant_id = a.participant_id
      WHERE a.session_id = v_session.id
        AND a.condition IS NOT DISTINCT FROM cell.condition
        AND a.task_order = cell.ord
        AND (
          pr.outcome = 'completed'
          OR (pr.completed_at IS NULL AND sp.last_seen_at > now() - interval '15 minutes')
        )
    ), cell.c_ord, cell.ord
    LIMIT 1;
  ELSE
    -- Workshop: the condition with the fewest participants so far
    SELECT c.value INTO v_condition
    FROM unnest(v_conditions) WITH ORDINALITY AS c(value, ord)
    ORDER BY (
      SELECT count(*) FROM public.study_assignments a
      WHERE a.session_id = v_session.id AND a.condition = c.value
    ), c.ord
    LIMIT 1;
  END IF;

  -- Neutral, unique display name
  SELECT count(*) + 1 INTO v_n
  FROM public.study_participants sp WHERE sp.session_id = v_session.id;
  WHILE EXISTS (
    SELECT 1 FROM public.study_participants sp
    WHERE sp.session_id = v_session.id
      AND lower(sp.display_name) = lower('Participant ' || v_n)
  ) LOOP
    v_n := v_n + 1;
  END LOOP;

  IF v_briefs_mode THEN
    INSERT INTO public.study_participants (session_id, user_id, display_name)
    VALUES (v_session.id, v_uid, 'Participant ' || v_n)
    RETURNING * INTO v_part;

    FOR v_i IN 1 .. cardinality(v_briefs) LOOP
      INSERT INTO public.portfolios (title, intent, schema, space_id, owner_id, creator_role)
      VALUES ('Participant ' || v_n || ' · form ' || v_i, p_intent, p_schema,
              v_session.space_id, v_uid, 'participant')
      RETURNING id INTO v_portfolio;
      IF v_i = 1 THEN v_first := v_portfolio; END IF;
      INSERT INTO public.study_tasks (participant_id, session_id, position, brief, portfolio_id)
      VALUES (
        v_part.id, v_session.id, v_i,
        v_briefs[1 + ((v_i - 1 + v_order) % cardinality(v_briefs))],
        v_portfolio
      );
    END LOOP;
    v_portfolio := v_first;
    UPDATE public.study_participants SET portfolio_id = v_first WHERE id = v_part.id;
    INSERT INTO public.study_progress (participant_id, session_id)
    VALUES (v_part.id, v_session.id);
  ELSE
    INSERT INTO public.portfolios (title, intent, schema, space_id, owner_id, creator_role)
    VALUES ('Participant ' || v_n || '''s form', p_intent, p_schema,
            v_session.space_id, v_uid, 'participant')
    RETURNING id INTO v_portfolio;

    INSERT INTO public.study_participants (session_id, user_id, display_name, portfolio_id)
    VALUES (v_session.id, v_uid, 'Participant ' || v_n, v_portfolio)
    RETURNING * INTO v_part;
  END IF;

  INSERT INTO public.study_assignments (
    participant_id, session_id, condition, task_order,
    external_source, external_id, external_study_id, external_session_id
  ) VALUES (
    v_part.id, v_session.id, v_condition, v_order,
    v_source, v_ext,
    nullif(left(btrim(coalesce(p_external_study_id, '')), 64), ''),
    nullif(left(btrim(coalesce(p_external_session_id, '')), 64), '')
  );

  INSERT INTO public.study_events (session_id, participant_id, phase, type, portfolio_id, payload)
  VALUES (v_session.id, v_part.id,
          CASE WHEN v_briefs_mode THEN 'consent' ELSE v_session.phase END,
          'joined', v_portfolio,
          jsonb_build_object('source', v_source, 'condition', v_condition, 'order', v_order));

  RETURN QUERY SELECT v_session.id, v_part.id, v_portfolio;
END;
$$;

-- ---------------------------------------------------------------------------
-- Participant: move to the next step
-- ---------------------------------------------------------------------------

-- `p_from` is the step the participant's screen shows. If they have moved on
-- already (double click, second tab), nothing happens and the current step
-- comes back — the call is idempotent. `p_reason` is 'timeout' when a task's
-- time ran out.
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

  v_steps := public.study_brief_steps(
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

-- No consent: the seat is closed without a completion code.
CREATE OR REPLACE FUNCTION public.decline_my_study(p_session_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_part UUID;
BEGIN
  SELECT id INTO v_part FROM public.study_participants
  WHERE session_id = p_session_id AND user_id = auth.uid();
  IF v_part IS NULL THEN
    RAISE EXCEPTION 'You are not part of this study' USING ERRCODE = '42501';
  END IF;
  UPDATE public.study_progress
  SET completed_at = now(), outcome = 'declined'
  WHERE participant_id = v_part AND step = 'consent' AND completed_at IS NULL;
  IF FOUND THEN
    INSERT INTO public.study_events (session_id, participant_id, phase, type)
    VALUES (p_session_id, v_part, 'consent', 'consent_declined');
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Participant state: + own step and tasks
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_study_state(p_session_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'session', jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'join_code', s.join_code,
      'phase', s.phase,
      'phase_started_at', s.phase_started_at,
      'phase_ends_at', s.phase_ends_at,
      'phase_durations', s.phase_durations,
      'settings', s.settings
    ),
    'participant', jsonb_build_object(
      'id', sp.id,
      'display_name', sp.display_name,
      'portfolio_id', sp.portfolio_id,
      'joined_at', sp.joined_at,
      'condition', a.condition,
      'external_source', a.external_source
    ),
    'progress', CASE WHEN pr.participant_id IS NULL THEN NULL ELSE jsonb_build_object(
      'step', pr.step,
      'step_started_at', pr.step_started_at,
      'outcome', pr.outcome
    ) END,
    'tasks', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'position', t.position,
        'brief', t.brief,
        'portfolio_id', t.portfolio_id,
        'started_at', t.started_at,
        'finished_at', t.finished_at
      ) ORDER BY t.position)
      FROM public.study_tasks t WHERE t.participant_id = sp.id
    ), '[]'::jsonb),
    -- Panel participants, at the end only (it carries the completion code):
    -- when the session is closed, or when they finished a self-paced study
    'completion_url', CASE
      WHEN a.external_source IS NOT NULL
       AND (
         (s.phase = 'done' AND pr.participant_id IS NULL)
         OR pr.outcome = 'completed'
       )
      THEN sec.completion_url
    END,
    'participant_count', (
      SELECT count(*) FROM public.study_participants x WHERE x.session_id = s.id
    ),
    'server_now', now()
  )
  FROM public.study_participants sp
  JOIN public.study_sessions s ON s.id = sp.session_id
  LEFT JOIN public.study_assignments a ON a.participant_id = sp.id
  LEFT JOIN public.study_progress pr ON pr.participant_id = sp.id
  LEFT JOIN public.study_session_secrets sec ON sec.session_id = s.id
  WHERE sp.session_id = p_session_id AND sp.user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------------
-- Researcher: progress per participant
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_study_progress(p_session_id UUID)
RETURNS TABLE (
  participant_id  UUID,
  display_name    TEXT,
  condition       TEXT,
  task_order      INTEGER,
  step            TEXT,
  outcome         TEXT,
  joined_at       TIMESTAMPTZ,
  last_seen_at    TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  tasks           JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the researcher can see the progress' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    sp.id, sp.display_name, a.condition, a.task_order,
    pr.step, pr.outcome, sp.joined_at, sp.last_seen_at, pr.completed_at,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'position', t.position,
        'brief', t.brief,
        'portfolio_id', t.portfolio_id,
        'started_at', t.started_at,
        'finished_at', t.finished_at,
        'finished_by', t.finished_by,
        'field_count', p.field_count
      ) ORDER BY t.position)
      FROM public.study_tasks t
      LEFT JOIN public.portfolios p ON p.id = t.portfolio_id
      WHERE t.participant_id = sp.id
    ), '[]'::jsonb)
  FROM public.study_participants sp
  LEFT JOIN public.study_assignments a ON a.participant_id = sp.id
  LEFT JOIN public.study_progress pr ON pr.participant_id = sp.id
  WHERE sp.session_id = p_session_id
  ORDER BY sp.joined_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.study_brief_steps(INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.advance_my_study_step(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decline_my_study(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_study_progress(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.study_brief_steps(INTEGER)  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_my_study_step(UUID, TEXT, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.decline_my_study(UUID)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_study_progress(UUID)    TO authenticated, service_role;
