-- Prolific (or any external panel) participants and study conditions.
--
-- Panel participants arrive through a link like
--   /join?code=ABC123&PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…
-- They get a neutral display name ("Participant 7") instead of typing one,
-- are assigned a condition (balanced within the session), and return to the
-- panel through the session's completion URL at the end.
--
-- Panel ids are personal data: they live in their own table that only
-- admins can read (participants can read `study_participants` of their
-- session, so the ids must not go there). A participant sees only their own
-- condition, through `get_my_study_state`.
--
-- Session settings gain an optional key (no schema change, JSONB):
--   conditions: ["full", "no-probes"]  — the least-used one is assigned
--
-- The completion URL carries the panel's completion code, so it is kept
-- out of `settings` (participants can read their session row): it lives in
-- `study_session_secrets` and is handed out by `get_my_study_state` only to
-- panel participants, and only once the session is done.

CREATE TABLE public.study_assignments (
  participant_id       UUID PRIMARY KEY
    REFERENCES public.study_participants(id) ON DELETE CASCADE,
  session_id           UUID NOT NULL
    REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  condition            TEXT,
  external_source      TEXT,
  external_id          TEXT,
  external_study_id    TEXT,
  external_session_id  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One seat per panel participant and session
CREATE UNIQUE INDEX study_assignments_external
  ON public.study_assignments(session_id, external_source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX idx_study_assignments_condition
  ON public.study_assignments(session_id, condition);

ALTER TABLE public.study_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_admin_all ON public.study_assignments
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

CREATE TABLE public.study_session_secrets (
  session_id      UUID PRIMARY KEY
    REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  completion_url  TEXT CHECK (completion_url IS NULL OR completion_url ~ '^https://'),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.study_session_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_admin_all ON public.study_session_secrets
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());

-- ---------------------------------------------------------------------------
-- Join from a panel link
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
  v_condition  TEXT;
  v_n          INTEGER;
  v_portfolio  UUID;
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

  -- Serialize joins per session (participant numbers, condition balance)
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
      UPDATE public.portfolios SET owner_id = v_uid WHERE id = v_part.portfolio_id;
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
    RAISE EXCEPTION 'This session has ended' USING ERRCODE = 'P0002';
  END IF;

  -- This browser already has a seat in the session (e.g. joined by code)
  SELECT * INTO v_part
  FROM public.study_participants sp
  WHERE sp.session_id = v_session.id AND sp.user_id = v_uid;
  IF FOUND THEN
    RAISE EXCEPTION 'This browser already takes part in this session'
      USING ERRCODE = '23505';
  END IF;

  -- Condition: the one with the fewest participants so far (listed order
  -- breaks ties); none when the session doesn't define conditions
  SELECT c.value INTO v_condition
  FROM jsonb_array_elements_text(
         CASE WHEN jsonb_typeof(v_session.settings->'conditions') = 'array'
              THEN v_session.settings->'conditions' ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS c(value, ord)
  ORDER BY (
    SELECT count(*) FROM public.study_assignments a
    WHERE a.session_id = v_session.id AND a.condition = c.value
  ), c.ord
  LIMIT 1;

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

  INSERT INTO public.portfolios (title, intent, schema, space_id, owner_id, creator_role)
  VALUES ('Participant ' || v_n || '''s form', p_intent, p_schema,
          v_session.space_id, v_uid, 'participant')
  RETURNING id INTO v_portfolio;

  INSERT INTO public.study_participants (session_id, user_id, display_name, portfolio_id)
  VALUES (v_session.id, v_uid, 'Participant ' || v_n, v_portfolio)
  RETURNING * INTO v_part;

  INSERT INTO public.study_assignments (
    participant_id, session_id, condition,
    external_source, external_id, external_study_id, external_session_id
  ) VALUES (
    v_part.id, v_session.id, v_condition,
    v_source, v_ext,
    nullif(left(btrim(coalesce(p_external_study_id, '')), 64), ''),
    nullif(left(btrim(coalesce(p_external_session_id, '')), 64), '')
  );

  INSERT INTO public.study_events (session_id, participant_id, phase, type, portfolio_id, payload)
  VALUES (v_session.id, v_part.id, v_session.phase, 'joined', v_portfolio,
          jsonb_build_object('source', v_source, 'condition', v_condition));

  RETURN QUERY SELECT v_session.id, v_part.id, v_portfolio;
END;
$$;

GRANT EXECUTE ON FUNCTION public.join_study_session_external(TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Participant state: + own condition and whether they came from a panel
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
    -- Panel participants, at the end only (it carries the completion code)
    'completion_url', CASE
      WHEN s.phase = 'done' AND a.external_source IS NOT NULL
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
  LEFT JOIN public.study_session_secrets sec ON sec.session_id = s.id
  WHERE sp.session_id = p_session_id AND sp.user_id = auth.uid();
$$;
