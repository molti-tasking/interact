-- Wave 2 (handoff), the run settings of a briefs session, and the form
-- version every response answered.
--
-- 1. Handoff. A wave-2 briefs session (`settings.handoff`) gives each
--    participant somebody else's finished wave-1 form to adapt to a variant
--    brief. The starting point is the second factor:
--
--      'portfolio'  the form with its intent and its decision trail
--                   (answered questions, history)
--      'form'       the same form, bare: fields only
--
--    Assignment balances condition × order × starting point: the emptiest
--    cell first and, among equally empty cells, each factor on its own (this
--    also applies to wave 1, where it alternates the conditions from the
--    second participant on). Each task
--    records the form it started from (`study_tasks.source_portfolio_id`);
--    sources are spread evenly per brief and starting point.
--
--      settings.handoff = {
--        "sources": { "<brief key>": ["<wave-1 portfolio id>", ...], ... },
--        "starts":  ["portfolio", "form"]      -- default: both
--      }
--
-- 2. Run settings. A briefs session can only be opened once it records the
--    model, the question strategy and the committee size it runs with
--    (`settings.run`, written by the server from its environment — see
--    /api/study/sessions/[id]/open). They are in every export.
--
-- 3. `responses.schema_version`: the revision of the form a response
--    answered, and `provenance_log.revision`: the revision a change
--    produced. Together they say which answers were given before a field's
--    wording or type changed.

-- ---------------------------------------------------------------------------
-- 3. Form version per response, revision per change
-- ---------------------------------------------------------------------------

ALTER TABLE public.responses
  ADD COLUMN IF NOT EXISTS schema_version INTEGER;
ALTER TABLE public.provenance_log
  ADD COLUMN IF NOT EXISTS revision INTEGER;

COMMENT ON COLUMN public.responses.schema_version IS
  'portfolios.revision of the form when this response was stored; NULL for responses from before migration 015';
COMMENT ON COLUMN public.provenance_log.revision IS
  'portfolios.revision this change produced; NULL for entries from before migration 015';

-- Set by trigger, so every way a response is stored is covered (the public
-- form, a study peer, record mode, an import)
CREATE OR REPLACE FUNCTION public.stamp_response_schema_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.schema_version IS NULL THEN
    SELECT p.revision INTO NEW.schema_version
    FROM public.portfolios p WHERE p.id = NEW.portfolio_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS responses_stamp_schema_version ON public.responses;
CREATE TRIGGER responses_stamp_schema_version
  BEFORE INSERT ON public.responses
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_response_schema_version();

-- `commit_portfolio_change` updates the portfolio, then logs: the revision
-- read here is the one the change produced
CREATE OR REPLACE FUNCTION public.stamp_provenance_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.revision IS NULL THEN
    SELECT p.revision INTO NEW.revision
    FROM public.portfolios p WHERE p.id = NEW.portfolio_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provenance_stamp_revision ON public.provenance_log;
CREATE TRIGGER provenance_stamp_revision
  BEFORE INSERT ON public.provenance_log
  FOR EACH ROW
  EXECUTE FUNCTION public.stamp_provenance_revision();

-- ---------------------------------------------------------------------------
-- 2. Run settings: a briefs session can't be opened without them
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.require_study_run_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_run JSONB := NEW.settings->'run';
BEGIN
  IF NEW.settings->>'mode' = 'briefs'
     AND NEW.phase = 'create'
     AND (TG_OP = 'INSERT' OR OLD.phase IS DISTINCT FROM 'create') THEN
    IF v_run IS NULL
       OR jsonb_typeof(v_run) <> 'object'
       OR btrim(coalesce(v_run->>'model', '')) = ''
       OR coalesce(v_run->>'questionStrategy', '') NOT IN ('committee', 'prompted')
       OR coalesce(v_run->>'committeeSize', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'This study cannot be opened: the model, the question strategy and the committee size it runs with are not recorded. Set LLM_MODEL_NAME, PROBE_STRATEGY and PROBE_COMMITTEE_SIZE on the server and open the study from its page.'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS study_sessions_require_run_settings ON public.study_sessions;
CREATE TRIGGER study_sessions_require_run_settings
  BEFORE INSERT OR UPDATE ON public.study_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.require_study_run_settings();

-- ---------------------------------------------------------------------------
-- 1. Handoff
-- ---------------------------------------------------------------------------

ALTER TABLE public.study_tasks
  ADD COLUMN IF NOT EXISTS source_portfolio_id UUID
    REFERENCES public.portfolios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_kind TEXT
    CHECK (start_kind IS NULL OR start_kind IN ('portfolio', 'form'));

ALTER TABLE public.study_assignments
  ADD COLUMN IF NOT EXISTS start_kind TEXT
    CHECK (start_kind IS NULL OR start_kind IN ('portfolio', 'form'));

CREATE INDEX IF NOT EXISTS idx_study_tasks_source
  ON public.study_tasks(source_portfolio_id);

-- Copy a wave-1 form into a participant's task form. 'portfolio' brings the
-- intent, the answered questions and the history; 'form' only the fields.
-- Either way the new form's trail starts by saying where it came from.
CREATE OR REPLACE FUNCTION public.study_start_from_source(
  p_portfolio_id  UUID,
  p_source_id     UUID,
  p_start_kind    TEXT,
  p_actor         TEXT
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_source public.portfolios%ROWTYPE;
BEGIN
  SELECT * INTO v_source FROM public.portfolios WHERE id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'A form this study starts from no longer exists' USING ERRCODE = 'P0002';
  END IF;

  IF p_start_kind = 'portfolio' THEN
    UPDATE public.portfolios
    SET schema = v_source.schema, intent = v_source.intent
    WHERE id = p_portfolio_id;

    -- The decisions behind the form: answered questions, as history
    INSERT INTO public.design_probes (
      portfolio_id, text, explanation, layer, source, options, selected_option,
      status, dimension_id, dimension_name, created_at, resolved_at, resolved_by,
      edited_at, edited_by, edit_count, previous_selected_option, priority,
      preview_status
    )
    SELECT p_portfolio_id, dp.text, dp.explanation, dp.layer, dp.source, dp.options,
           dp.selected_option, dp.status, dp.dimension_id, dp.dimension_name,
           dp.created_at, dp.resolved_at, 'Previous author',
           dp.edited_at, CASE WHEN dp.edited_by IS NULL THEN NULL ELSE 'Previous author' END,
           dp.edit_count, dp.previous_selected_option, dp.priority, dp.preview_status
    FROM public.design_probes dp
    WHERE dp.portfolio_id = p_source_id AND dp.status = 'resolved';

    -- …and the trail of changes (who is not passed on: the author stays
    -- anonymous to the next participant)
    INSERT INTO public.provenance_log (
      portfolio_id, action, layer, diff, prev_intent, prev_schema, rationale,
      actor, creator_role, created_at, revision, actor_user_id
    )
    SELECT p_portfolio_id, pl.action, pl.layer, pl.diff, pl.prev_intent, pl.prev_schema,
           pl.rationale,
           CASE WHEN pl.actor = 'system' THEN 'system' ELSE 'Previous author' END,
           pl.creator_role, pl.created_at, 0, NULL
    FROM public.provenance_log pl
    WHERE pl.portfolio_id = p_source_id;
  ELSE
    UPDATE public.portfolios
    SET schema = v_source.schema
    WHERE id = p_portfolio_id;
  END IF;

  INSERT INTO public.provenance_log (
    portfolio_id, action, layer, diff, prev_intent, prev_schema, rationale, actor
  ) VALUES (
    p_portfolio_id, 'portfolio_derived', 'configuration',
    '{"added": [], "removed": [], "modified": []}'::jsonb,
    NULL, NULL,
    CASE WHEN p_start_kind = 'portfolio'
         THEN 'Took over a form with its intent and decisions'
         ELSE 'Took over a form (fields only)' END,
    p_actor
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.study_start_from_source(UUID, UUID, TEXT, TEXT) FROM PUBLIC;

-- The panel join, as in 014, plus the handoff: a third assignment factor
-- and a source form per task.
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
  v_handoff    JSONB;
  v_starts     TEXT[];
  v_start      TEXT;
  v_brief      TEXT;
  v_from       UUID;
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
  v_handoff := CASE
    WHEN v_briefs_mode AND jsonb_typeof(v_session.settings->'handoff'->'sources') = 'object'
    THEN v_session.settings->'handoff' END;

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

    -- Handoff: the starting points, and a source form for every brief
    IF v_handoff IS NOT NULL THEN
      SELECT coalesce(array_agg(s.value ORDER BY s.ord), ARRAY[]::TEXT[]) INTO v_starts
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(v_handoff->'starts') = 'array'
                  THEN v_handoff->'starts' ELSE '["portfolio", "form"]'::jsonb END
           ) WITH ORDINALITY AS s(value, ord)
      WHERE s.value IN ('portfolio', 'form');
      IF cardinality(v_starts) = 0 THEN
        v_starts := ARRAY['portfolio', 'form'];
      END IF;
      FOREACH v_brief IN ARRAY v_briefs LOOP
        IF jsonb_typeof(v_handoff->'sources'->v_brief) IS DISTINCT FROM 'array'
           OR jsonb_array_length(v_handoff->'sources'->v_brief) = 0 THEN
          RAISE EXCEPTION 'This study has no forms to start from yet' USING ERRCODE = 'P0002';
        END IF;
      END LOOP;
    ELSE
      v_starts := ARRAY[NULL]::TEXT[];
    END IF;

    -- Cell = condition × order × starting point (order k starts with brief
    -- k+1 and wraps around: a Latin square). The emptiest cell wins. Among
    -- equally empty cells, the one whose starting point, then condition,
    -- then order has the fewest seats so far — so each factor is balanced
    -- on its own from the first participants on, not only once every cell
    -- has been filled. Listed order breaks the remaining ties. Only seats
    -- that finished or are still active count.
    WITH seats AS (
      SELECT a.condition, a.task_order, a.start_kind
      FROM public.study_assignments a
      JOIN public.study_participants sp ON sp.id = a.participant_id
      LEFT JOIN public.study_progress pr ON pr.participant_id = a.participant_id
      WHERE a.session_id = v_session.id
        AND (
          pr.outcome = 'completed'
          OR (pr.completed_at IS NULL AND sp.last_seen_at > now() - interval '15 minutes')
        )
    ),
    cells AS (
      SELECT c.value AS condition, c.ord AS c_ord, o.ord AS ord,
             s.value AS start, s.ord AS s_ord
      FROM unnest(
             CASE WHEN cardinality(v_conditions) = 0
                  THEN ARRAY[NULL]::TEXT[] ELSE v_conditions END
           ) WITH ORDINALITY AS c(value, ord)
      CROSS JOIN generate_series(0, cardinality(v_briefs) - 1) AS o(ord)
      CROSS JOIN unnest(v_starts) WITH ORDINALITY AS s(value, ord)
    )
    SELECT cell.condition, cell.ord, cell.start INTO v_condition, v_order, v_start
    FROM cells cell
    ORDER BY
      (SELECT count(*) FROM seats x
       WHERE x.condition IS NOT DISTINCT FROM cell.condition
         AND x.task_order = cell.ord
         AND x.start_kind IS NOT DISTINCT FROM cell.start),
      (SELECT count(*) FROM seats x WHERE x.start_kind IS NOT DISTINCT FROM cell.start),
      (SELECT count(*) FROM seats x WHERE x.condition IS NOT DISTINCT FROM cell.condition),
      (SELECT count(*) FROM seats x WHERE x.task_order = cell.ord),
      cell.s_ord, cell.c_ord, cell.ord
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
      v_brief := v_briefs[1 + ((v_i - 1 + v_order) % cardinality(v_briefs))];
      INSERT INTO public.portfolios (title, intent, schema, space_id, owner_id, creator_role)
      VALUES ('Participant ' || v_n || ' · form ' || v_i, p_intent, p_schema,
              v_session.space_id, v_uid, 'participant')
      RETURNING id INTO v_portfolio;
      IF v_i = 1 THEN v_first := v_portfolio; END IF;

      v_from := NULL;
      IF v_handoff IS NOT NULL THEN
        -- The source used least for this brief and starting point among
        -- seats that count (listed order breaks ties)
        SELECT src.id INTO v_from
        FROM (
          SELECT e.value::uuid AS id, e.ord
          FROM jsonb_array_elements_text(v_handoff->'sources'->v_brief)
               WITH ORDINALITY AS e(value, ord)
        ) src
        ORDER BY (
          SELECT count(*)
          FROM public.study_tasks t
          JOIN public.study_participants sp ON sp.id = t.participant_id
          LEFT JOIN public.study_progress pr ON pr.participant_id = t.participant_id
          WHERE t.session_id = v_session.id
            AND t.brief = v_brief
            AND t.start_kind = v_start
            AND t.source_portfolio_id = src.id
            AND (
              pr.outcome = 'completed'
              OR (pr.completed_at IS NULL AND sp.last_seen_at > now() - interval '15 minutes')
            )
        ), src.ord
        LIMIT 1;
        PERFORM public.study_start_from_source(
          v_portfolio, v_from, v_start, 'Participant ' || v_n
        );
      END IF;

      INSERT INTO public.study_tasks (
        participant_id, session_id, position, brief, portfolio_id,
        source_portfolio_id, start_kind
      )
      VALUES (v_part.id, v_session.id, v_i, v_brief, v_portfolio, v_from, v_start);
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
    participant_id, session_id, condition, task_order, start_kind,
    external_source, external_id, external_study_id, external_session_id
  ) VALUES (
    v_part.id, v_session.id, v_condition, v_order, v_start,
    v_source, v_ext,
    nullif(left(btrim(coalesce(p_external_study_id, '')), 64), ''),
    nullif(left(btrim(coalesce(p_external_session_id, '')), 64), '')
  );

  INSERT INTO public.study_events (session_id, participant_id, phase, type, portfolio_id, payload)
  VALUES (v_session.id, v_part.id,
          CASE WHEN v_briefs_mode THEN 'consent' ELSE v_session.phase END,
          'joined', v_portfolio,
          jsonb_build_object('source', v_source, 'condition', v_condition,
                             'order', v_order, 'start', v_start));

  RETURN QUERY SELECT v_session.id, v_part.id, v_portfolio;
END;
$$;

-- ---------------------------------------------------------------------------
-- Participant state: tasks say how they start; the researcher's settings
-- (run, handoff sources) stay with the researcher
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
      'settings', s.settings - 'run' - 'handoff'
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
        'finished_at', t.finished_at,
        'start_kind', t.start_kind
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

-- Researcher: progress per participant (+ starting point per task)
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
        'field_count', p.field_count,
        'start_kind', t.start_kind,
        'source_portfolio_id', t.source_portfolio_id
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

-- Researcher: the finished forms of a briefs session, to choose what a
-- wave-2 session starts from.
CREATE OR REPLACE FUNCTION public.get_study_handoff_candidates(p_session_id UUID)
RETURNS TABLE (
  portfolio_id  UUID,
  participant   TEXT,
  condition     TEXT,
  brief         TEXT,
  field_count   INTEGER,
  decisions     INTEGER,
  finished_at   TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT public.is_app_admin() THEN
    RAISE EXCEPTION 'Only the researcher can see the forms' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.portfolio_id, sp.display_name, a.condition, t.brief,
         p.field_count,
         (SELECT count(*)::int FROM public.design_probes dp
          WHERE dp.portfolio_id = t.portfolio_id AND dp.status = 'resolved'),
         t.finished_at
  FROM public.study_tasks t
  JOIN public.study_participants sp ON sp.id = t.participant_id
  JOIN public.study_progress pr ON pr.participant_id = t.participant_id
  JOIN public.portfolios p ON p.id = t.portfolio_id
  LEFT JOIN public.study_assignments a ON a.participant_id = t.participant_id
  WHERE t.session_id = p_session_id
    AND pr.outcome = 'completed'
    AND t.finished_at IS NOT NULL
    AND p.field_count > 0
  ORDER BY t.brief, sp.joined_at;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_study_handoff_candidates(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_study_handoff_candidates(UUID)
  TO authenticated, service_role;
