-- Study mode: workshop sessions with anonymous participants.
--
-- A facilitator (app admin) runs a session through phases:
--   lobby → create → answer → review → questionnaire → done
-- Participants join with a code + display name (Supabase anonymous sign-in),
-- each gets exactly one form (portfolio) they own, answers every peer form
-- during `answer`, and reviews/refines their own form during `review`.
--
-- Access model on top of 010 (admins keep `app_admin_all` everywhere):
--
--   * Participants are `authenticated` (anonymous) users WITHOUT admin rights.
--     They may read/update only the portfolio they own, and the probes,
--     provenance and responses that belong to it. They cannot insert or
--     delete portfolios (creation goes through `join_study_session`), and a
--     trigger stops them from changing status / ownership / lineage.
--   * Peer forms are reachable only during `answer` (plus a short grace
--     window after it), via `get_published_form` / `submit_response`, which
--     now also accept `is_study_peer_form()`. Forms are never published to
--     the public `/forms/<id>` route by the study.
--   * Facilitator-only RPCs check `is_app_admin()` themselves.
--
-- Every new table enables RLS with an `app_admin_all` policy: default
-- privileges (006) give `authenticated` full table access, so a table
-- without RLS would be readable and writable by every participant.

-- ---------------------------------------------------------------------------
-- 1. Ownership and attribution columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS owner_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL
    DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_portfolios_owner ON public.portfolios(owner_id);

-- Who made a change, taken from the request rather than the client's
-- "acting as" string.
ALTER TABLE public.provenance_log
  ADD COLUMN IF NOT EXISTS actor_user_id UUID DEFAULT auth.uid();

-- Who answered (NULL for signed-out respondents on `/forms/<id>`). Set
-- explicitly by `submit_response`, not as a default, so the admin's direct
-- inserts (record mode) stay unattributed.
ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS respondent_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_responses_respondent
  ON public.responses(respondent_id) WHERE respondent_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Study tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.study_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  join_code         TEXT NOT NULL UNIQUE,
  space_id          UUID REFERENCES public.spaces(id) ON DELETE SET NULL,
  phase             TEXT NOT NULL DEFAULT 'lobby'
    CHECK (phase IN ('lobby', 'create', 'answer', 'review', 'questionnaire', 'done')),
  phase_started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft deadline shown as a countdown; NULL = no timer
  phase_ends_at     TIMESTAMPTZ,
  -- Planned seconds per phase, applied when a phase starts
  phase_durations   JSONB NOT NULL DEFAULT
    '{"create": 900, "answer": 1800, "review": 900, "questionnaire": 600}',
  -- { allowVoice: boolean, findingsMinResponses: number }
  settings          JSONB NOT NULL DEFAULT
    '{"allowVoice": false, "findingsMinResponses": 3}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.study_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id    UUID NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  portfolio_id  UUID REFERENCES public.portfolios(id) ON DELETE SET NULL,
  joined_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Set by the facilitator ("reassign seat"): until then, joining with this
  -- name from another browser takes the seat over.
  rejoin_until  TIMESTAMPTZ,
  UNIQUE (session_id, user_id)
);

CREATE UNIQUE INDEX study_participants_session_name
  ON public.study_participants(session_id, lower(display_name));
CREATE INDEX idx_study_participants_user ON public.study_participants(user_id);

-- Interaction log (what provenance_log doesn't capture: views, hovers,
-- skips, timing). participant_id is NULL for facilitator events.
CREATE TABLE public.study_events (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  participant_id  UUID REFERENCES public.study_participants(id) ON DELETE CASCADE,
  phase           TEXT,
  type            TEXT NOT NULL,
  portfolio_id    UUID,
  payload         JSONB NOT NULL DEFAULT '{}',
  client_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_study_events_session
  ON public.study_events(session_id, created_at);

-- Form state at phase boundaries. No foreign keys on purpose: snapshots are
-- research data and must survive later deletes.
CREATE TABLE public.study_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL,
  participant_id  UUID,
  portfolio_id    UUID NOT NULL,
  label           TEXT NOT NULL,
  title           TEXT,
  intent          JSONB,
  schema          JSONB,
  revision        INTEGER,
  design_probes   JSONB NOT NULL DEFAULT '[]',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_study_snapshots_session
  ON public.study_snapshots(session_id, created_at);

CREATE TABLE public.study_questionnaire_responses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  participant_id  UUID NOT NULL REFERENCES public.study_participants(id) ON DELETE CASCADE,
  instrument      TEXT NOT NULL,
  answers         JSONB NOT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (participant_id, instrument)
);

-- ---------------------------------------------------------------------------
-- 3. Helper functions (SECURITY DEFINER: used inside policies, so they must
--    not be subject to the policies themselves — avoids recursion)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.owns_portfolio(p_portfolio_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE id = p_portfolio_id AND owner_id = auth.uid()
  );
$$;

-- Storage paths: compares as text so a malformed segment can't throw.
CREATE OR REPLACE FUNCTION public.owns_portfolio_text(p_portfolio_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE id::text = p_portfolio_id AND owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.my_session_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT session_id FROM public.study_participants WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.my_participant_ids()
RETURNS SETOF UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id FROM public.study_participants WHERE user_id = auth.uid();
$$;

-- Participant of a session that hasn't finished: may use the LLM features.
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
    WHERE sp.user_id = auth.uid() AND s.phase <> 'done'
  );
$$;

-- The caller may load and answer this form as a study peer: same session,
-- not their own form, and the session is answering (or just left it — a
-- grace window so submissions in flight at the phase change still land).
CREATE OR REPLACE FUNCTION public.is_study_peer_form(p_portfolio_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.study_participants owner
    JOIN public.study_sessions s ON s.id = owner.session_id
    JOIN public.study_participants me
      ON me.session_id = s.id AND me.user_id = auth.uid()
    WHERE owner.portfolio_id::text = p_portfolio_id
      AND owner.id <> me.id
      AND (
        s.phase = 'answer'
        OR (s.phase = 'review' AND s.phase_started_at > now() - interval '2 minutes')
      )
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Respondent entry points: also open to study peers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_form_accepting(p_portfolio_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.is_app_admin()
      OR EXISTS (
        SELECT 1 FROM public.portfolios
        WHERE id::text = p_portfolio_id AND status = 'published'
      )
      OR public.is_study_peer_form(p_portfolio_id);
$$;

CREATE OR REPLACE FUNCTION public.get_published_form(p_id UUID)
RETURNS TABLE (id UUID, title TEXT, schema JSONB, purpose TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id, p.title, p.schema, p.intent -> 'purpose' ->> 'content'
  FROM public.portfolios p
  WHERE p.id = p_id
    AND (
      p.status = 'published'
      OR public.is_app_admin()
      OR public.is_study_peer_form(p.id::text)
    );
$$;

CREATE OR REPLACE FUNCTION public.submit_response(
  p_portfolio_id UUID,
  p_data         JSONB
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id UUID;
  v_uid UUID := auth.uid();
BEGIN
  IF NOT public.is_form_accepting(p_portfolio_id::text) THEN
    RAISE EXCEPTION 'This form is not accepting responses'
      USING ERRCODE = 'P0002';
  END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' THEN
    RAISE EXCEPTION 'Response data must be a JSON object'
      USING ERRCODE = '22023';
  END IF;
  IF octet_length(p_data::text) > 1000000 THEN
    RAISE EXCEPTION 'Response is too large'
      USING ERRCODE = '54000';
  END IF;

  -- Study peers answer each form once. The lock serializes double submits.
  IF v_uid IS NOT NULL AND public.is_study_peer_form(p_portfolio_id::text) THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(p_portfolio_id::text || ':' || v_uid::text)
    );
    IF EXISTS (
      SELECT 1 FROM public.responses
      WHERE portfolio_id = p_portfolio_id AND respondent_id = v_uid
    ) THEN
      RAISE EXCEPTION 'You have already answered this form'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  INSERT INTO public.responses (portfolio_id, data, respondent_id)
  VALUES (p_portfolio_id, p_data, v_uid)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Guard: participants can't publish, re-own or re-parent their form.
--    `commit_portfolio_change` accepts `p_status` and is SECURITY INVOKER, so
--    hiding the Publish button alone would not be enough. SECURITY DEFINER
--    functions (run as the table owner) are trusted and skip the check.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.portfolios_guard_owner_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') AND NOT public.is_app_admin() THEN
    IF NEW.status     IS DISTINCT FROM OLD.status
    OR NEW.owner_id   IS DISTINCT FROM OLD.owner_id
    OR NEW.space_id   IS DISTINCT FROM OLD.space_id
    OR NEW.base_id    IS DISTINCT FROM OLD.base_id
    OR NEW.projection IS DISTINCT FROM OLD.projection THEN
      RAISE EXCEPTION 'Only the facilitator can change a form''s status, owner or lineage'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER portfolios_guard_owner_fields
  BEFORE UPDATE ON public.portfolios
  FOR EACH ROW
  EXECUTE FUNCTION public.portfolios_guard_owner_fields();

-- Any participant event counts as "seen" (drives the facilitator roster).
CREATE OR REPLACE FUNCTION public.study_events_touch_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.participant_id IS NOT NULL THEN
    UPDATE public.study_participants
    SET last_seen_at = now()
    WHERE id = NEW.participant_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER study_events_touch_participant
  AFTER INSERT ON public.study_events
  FOR EACH ROW
  EXECUTE FUNCTION public.study_events_touch_participant();

-- ---------------------------------------------------------------------------
-- 6. Participant RPCs
-- ---------------------------------------------------------------------------

-- Join (or re-enter) a session. Idempotent per browser (auth user). Creates
-- the participant's one and only form in the session's space; the empty
-- intent/schema JSON comes from the app (`emptyStructuredIntent`,
-- `emptyPortfolioSchema`) so its shape isn't duplicated here.
CREATE OR REPLACE FUNCTION public.join_study_session(
  p_code          TEXT,
  p_display_name  TEXT,
  p_intent        JSONB,
  p_schema        JSONB
)
RETURNS TABLE (session_id UUID, participant_id UUID, portfolio_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_session   public.study_sessions%ROWTYPE;
  v_part      public.study_participants%ROWTYPE;
  v_name      TEXT;
  v_old_uid   UUID;
  v_portfolio UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Please sign in first' USING ERRCODE = '28000';
  END IF;

  -- Display names end up in provenance actors "Name (Participant)": no
  -- parentheses, no reserved actor names, single spaces.
  v_name := btrim(regexp_replace(
    regexp_replace(coalesce(p_display_name, ''), '[()<>]', '', 'g'),
    '\s+', ' ', 'g'
  ));
  IF length(v_name) < 1 OR length(v_name) > 40 THEN
    RAISE EXCEPTION 'Please enter a name of 1–40 characters' USING ERRCODE = '22023';
  END IF;
  IF lower(v_name) IN ('system', 'ai', 'assistant', 'llm', 'creator', 'facilitator') THEN
    RAISE EXCEPTION 'Please choose another name' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.study_sessions
  WHERE upper(join_code) = upper(btrim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No session with this code' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.phase = 'done' THEN
    RAISE EXCEPTION 'This session has ended' USING ERRCODE = 'P0002';
  END IF;

  -- Same browser again
  SELECT * INTO v_part
  FROM public.study_participants sp
  WHERE sp.session_id = v_session.id AND sp.user_id = v_uid;
  IF FOUND THEN
    RETURN QUERY SELECT v_session.id, v_part.id, v_part.portfolio_id;
    RETURN;
  END IF;

  -- Name taken: take the seat over only when the facilitator allowed it
  SELECT * INTO v_part
  FROM public.study_participants sp
  WHERE sp.session_id = v_session.id AND lower(sp.display_name) = lower(v_name)
  FOR UPDATE;
  IF FOUND THEN
    IF v_part.rejoin_until IS NULL OR v_part.rejoin_until < now() THEN
      RAISE EXCEPTION 'This name is already taken in this session'
        USING ERRCODE = '23505';
    END IF;
    v_old_uid := v_part.user_id;
    UPDATE public.study_participants
    SET user_id = v_uid, rejoin_until = NULL, last_seen_at = now()
    WHERE id = v_part.id;
    UPDATE public.portfolios SET owner_id = v_uid WHERE id = v_part.portfolio_id;
    UPDATE public.responses SET respondent_id = v_uid WHERE respondent_id = v_old_uid;
    INSERT INTO public.study_events (session_id, participant_id, phase, type)
    VALUES (v_session.id, v_part.id, v_session.phase, 'seat_reassigned');
    RETURN QUERY SELECT v_session.id, v_part.id, v_part.portfolio_id;
    RETURN;
  END IF;

  INSERT INTO public.portfolios (title, intent, schema, space_id, owner_id, creator_role)
  VALUES (v_name || '''s form', p_intent, p_schema, v_session.space_id, v_uid, 'participant')
  RETURNING id INTO v_portfolio;

  INSERT INTO public.study_participants (session_id, user_id, display_name, portfolio_id)
  VALUES (v_session.id, v_uid, v_name, v_portfolio)
  RETURNING * INTO v_part;

  INSERT INTO public.study_events (session_id, participant_id, phase, type, portfolio_id)
  VALUES (v_session.id, v_part.id, v_session.phase, 'joined', v_portfolio);

  RETURN QUERY SELECT v_session.id, v_part.id, v_portfolio;
END;
$$;

-- Everything the participant shell needs in one poll, incl. the server
-- clock so countdowns don't depend on the participant's clock.
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
      'joined_at', sp.joined_at
    ),
    'participant_count', (
      SELECT count(*) FROM public.study_participants x WHERE x.session_id = s.id
    ),
    'server_now', now()
  )
  FROM public.study_participants sp
  JOIN public.study_sessions s ON s.id = sp.session_id
  WHERE sp.session_id = p_session_id AND sp.user_id = auth.uid();
$$;

-- The peer forms for the answer gallery (never the caller's own).
CREATE OR REPLACE FUNCTION public.get_study_forms(p_session_id UUID)
RETURNS TABLE (
  participant_id  UUID,
  portfolio_id    UUID,
  owner_name      TEXT,
  title           TEXT,
  field_count     INTEGER,
  answered_by_me  BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    owner.id,
    p.id,
    owner.display_name,
    p.title,
    p.field_count,
    EXISTS (
      SELECT 1 FROM public.responses r
      WHERE r.portfolio_id = p.id AND r.respondent_id = auth.uid()
    )
  FROM public.study_participants owner
  JOIN public.portfolios p ON p.id = owner.portfolio_id
  WHERE owner.session_id = p_session_id
    AND owner.user_id <> auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.study_participants me
      WHERE me.session_id = p_session_id AND me.user_id = auth.uid()
    )
  ORDER BY owner.joined_at;
$$;

-- ---------------------------------------------------------------------------
-- 7. Facilitator RPCs (admin only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_study_session(
  p_name             TEXT,
  p_phase_durations  JSONB DEFAULT NULL,
  p_settings         JSONB DEFAULT NULL
)
RETURNS public.study_sessions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- No 0/O, 1/I/L: codes are read off a projector
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     TEXT;
  v_space    UUID;
  v_session  public.study_sessions%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the facilitator can create sessions' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_name), '') = '' THEN
    RAISE EXCEPTION 'Please name the session' USING ERRCODE = '22023';
  END IF;

  LOOP
    SELECT string_agg(substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1), '')
    INTO v_code
    FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.study_sessions WHERE join_code = v_code
    );
  END LOOP;

  -- origin 'user': `useEnsureSpace` only reuses 'system' spaces
  INSERT INTO public.spaces (name, description, origin)
  VALUES ('Study: ' || btrim(p_name), 'Forms created in a workshop session', 'user')
  RETURNING id INTO v_space;

  INSERT INTO public.study_sessions (name, join_code, space_id)
  VALUES (btrim(p_name), v_code, v_space)
  RETURNING * INTO v_session;

  UPDATE public.study_sessions SET
    phase_durations = phase_durations || coalesce(p_phase_durations, '{}'),
    settings = settings || coalesce(p_settings, '{}')
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;

-- Move the whole room to another phase. Leaving `create` or `review`
-- snapshots every form (with its probes) first, in the same transaction.
CREATE OR REPLACE FUNCTION public.advance_study_phase(
  p_session_id  UUID,
  p_phase       TEXT
)
RETURNS public.study_sessions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session  public.study_sessions%ROWTYPE;
  v_seconds  INTEGER;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the facilitator can change phases' USING ERRCODE = '42501';
  END IF;
  IF p_phase NOT IN ('lobby', 'create', 'answer', 'review', 'questionnaire', 'done') THEN
    RAISE EXCEPTION 'Unknown phase %', p_phase USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session
  FROM public.study_sessions WHERE id = p_session_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_session.phase = p_phase THEN
    RETURN v_session;
  END IF;

  IF v_session.phase IN ('create', 'review') THEN
    INSERT INTO public.study_snapshots (
      session_id, participant_id, portfolio_id, label,
      title, intent, schema, revision, design_probes
    )
    SELECT
      v_session.id, sp.id, p.id, 'end_of_' || v_session.phase,
      p.title, p.intent, p.schema, p.revision,
      coalesce((
        SELECT jsonb_agg(to_jsonb(dp) ORDER BY dp.created_at)
        FROM public.design_probes dp WHERE dp.portfolio_id = p.id
      ), '[]')
    FROM public.study_participants sp
    JOIN public.portfolios p ON p.id = sp.portfolio_id
    WHERE sp.session_id = v_session.id;
  END IF;

  v_seconds := nullif(v_session.phase_durations ->> p_phase, '')::INTEGER;

  UPDATE public.study_sessions SET
    phase = p_phase,
    phase_started_at = now(),
    phase_ends_at = CASE
      WHEN v_seconds IS NULL OR v_seconds <= 0 THEN NULL
      ELSE now() + make_interval(secs => v_seconds)
    END
  WHERE id = v_session.id
  RETURNING * INTO v_session;

  INSERT INTO public.study_events (session_id, phase, type, payload)
  VALUES (
    v_session.id, p_phase, 'phase_changed',
    jsonb_build_object('to', p_phase)
  );

  RETURN v_session;
END;
$$;

-- "+2 min": push the soft deadline (from now if it already passed).
CREATE OR REPLACE FUNCTION public.extend_study_phase(
  p_session_id  UUID,
  p_seconds     INTEGER
)
RETURNS public.study_sessions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.study_sessions%ROWTYPE;
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the facilitator can change the timer' USING ERRCODE = '42501';
  END IF;
  UPDATE public.study_sessions SET
    phase_ends_at = greatest(coalesce(phase_ends_at, now()), now())
      + make_interval(secs => p_seconds)
  WHERE id = p_session_id
  RETURNING * INTO v_session;
  INSERT INTO public.study_events (session_id, phase, type, payload)
  VALUES (p_session_id, v_session.phase, 'phase_extended',
          jsonb_build_object('seconds', p_seconds));
  RETURN v_session;
END;
$$;

-- Let a participant re-enter from another browser under the same name.
CREATE OR REPLACE FUNCTION public.reassign_study_seat(p_participant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the facilitator can reassign seats' USING ERRCODE = '42501';
  END IF;
  UPDATE public.study_participants
  SET rejoin_until = now() + interval '10 minutes'
  WHERE id = p_participant_id;
END;
$$;

-- One row per participant with live progress, for the console roster.
CREATE OR REPLACE FUNCTION public.get_study_roster(p_session_id UUID)
RETURNS TABLE (
  participant_id      UUID,
  display_name        TEXT,
  joined_at           TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  rejoin_until        TIMESTAMPTZ,
  portfolio_id        UUID,
  title               TEXT,
  field_count         INTEGER,
  revision            INTEGER,
  probes_resolved     INTEGER,
  responses_given     INTEGER,
  responses_received  INTEGER,
  questionnaire_done  BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the facilitator can see the roster' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT
    sp.id,
    sp.display_name,
    sp.joined_at,
    sp.last_seen_at,
    sp.rejoin_until,
    p.id,
    p.title,
    p.field_count,
    p.revision,
    (SELECT count(*)::int FROM public.design_probes dp
      WHERE dp.portfolio_id = p.id AND dp.status = 'resolved'),
    (SELECT count(*)::int FROM public.responses r
      JOIN public.study_participants peer
        ON peer.portfolio_id = r.portfolio_id AND peer.session_id = sp.session_id
      WHERE r.respondent_id = sp.user_id),
    (SELECT count(*)::int FROM public.responses r
      JOIN public.study_participants peer
        ON peer.user_id = r.respondent_id AND peer.session_id = sp.session_id
      WHERE r.portfolio_id = p.id),
    EXISTS (SELECT 1 FROM public.study_questionnaire_responses q
      WHERE q.participant_id = sp.id)
  FROM public.study_participants sp
  LEFT JOIN public.portfolios p ON p.id = sp.portfolio_id
  WHERE sp.session_id = p_session_id
  ORDER BY sp.joined_at;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants (010 revoked default EXECUTE from PUBLIC)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION public.owns_portfolio(UUID)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owns_portfolio_text(TEXT)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_session_ids()            TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_participant_ids()        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_study_participant()      TO authenticated, service_role;
-- Reached via is_form_accepting / get_published_form, also by signed-out visitors
GRANT EXECUTE ON FUNCTION public.is_study_peer_form(TEXT)    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.join_study_session(TEXT, TEXT, JSONB, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_my_study_state(UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_study_forms(UUID)       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_study_session(TEXT, JSONB, JSONB)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.advance_study_phase(UUID, TEXT)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.extend_study_phase(UUID, INTEGER)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reassign_study_seat(UUID)   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_study_roster(UUID)      TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Row-level security
-- ---------------------------------------------------------------------------

-- New tables: admins only by default (same as 010) …
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'study_sessions', 'study_participants', 'study_events',
    'study_snapshots', 'study_questionnaire_responses'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS app_admin_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY app_admin_all ON public.%I FOR ALL TO authenticated '
      'USING ((SELECT public.is_app_admin())) '
      'WITH CHECK ((SELECT public.is_app_admin()))',
      t
    );
  END LOOP;
END $$;

-- … plus narrow participant policies. Policies are OR-ed with app_admin_all.

-- Own form: read and update (no insert — join creates it; no delete — that
-- would cascade to the responses peers submitted).
CREATE POLICY participant_select_own ON public.portfolios
  FOR SELECT TO authenticated
  USING (owner_id = (SELECT auth.uid()));
CREATE POLICY participant_update_own ON public.portfolios
  FOR UPDATE TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY participant_select_own ON public.design_probes
  FOR SELECT TO authenticated
  USING (public.owns_portfolio(portfolio_id));
CREATE POLICY participant_insert_own ON public.design_probes
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_portfolio(portfolio_id));
CREATE POLICY participant_update_own ON public.design_probes
  FOR UPDATE TO authenticated
  USING (public.owns_portfolio(portfolio_id))
  WITH CHECK (public.owns_portfolio(portfolio_id));

CREATE POLICY participant_select_own ON public.provenance_log
  FOR SELECT TO authenticated
  USING (public.owns_portfolio(portfolio_id));
CREATE POLICY participant_insert_own ON public.provenance_log
  FOR INSERT TO authenticated
  WITH CHECK (public.owns_portfolio(portfolio_id));

-- Responses to my form, and the ones I gave
CREATE POLICY participant_select_own ON public.responses
  FOR SELECT TO authenticated
  USING (
    public.owns_portfolio(portfolio_id)
    OR respondent_id = (SELECT auth.uid())
  );

CREATE POLICY participant_select_own ON public.study_sessions
  FOR SELECT TO authenticated
  USING (id IN (SELECT public.my_session_ids()));

CREATE POLICY participant_select_session ON public.study_participants
  FOR SELECT TO authenticated
  USING (session_id IN (SELECT public.my_session_ids()));

CREATE POLICY participant_insert_own ON public.study_events
  FOR INSERT TO authenticated
  WITH CHECK (
    participant_id IN (SELECT public.my_participant_ids())
    AND session_id IN (SELECT public.my_session_ids())
  );

CREATE POLICY participant_select_own ON public.study_questionnaire_responses
  FOR SELECT TO authenticated
  USING (participant_id IN (SELECT public.my_participant_ids()));
CREATE POLICY participant_insert_own ON public.study_questionnaire_responses
  FOR INSERT TO authenticated
  WITH CHECK (
    participant_id IN (SELECT public.my_participant_ids())
    AND session_id IN (SELECT public.my_session_ids())
  );

-- Files respondents uploaded to my form (signed URLs in the review phase)
DROP POLICY IF EXISTS "response_files_owner_read" ON storage.objects;
CREATE POLICY "response_files_owner_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'response-files'
    AND public.owns_portfolio_text((storage.foldername(name))[1])
  );
