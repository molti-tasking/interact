-- Private by default: only the app owner(s) can read or change data.
--
-- Until now every table was readable and writable with the public anon key
-- (see 006_grants.sql). From here on:
--
--   * Signed-out visitors (respondents) can do exactly two things, both via
--     SECURITY DEFINER functions:
--       - get_published_form(id)          title/schema/purpose of a published form
--       - submit_response(id, data)       insert a response into a published form
--     plus uploading files for a published form into `response-files`.
--     They cannot list forms or read any response, draft, probe or log.
--
--   * Signed-in users listed in `app_admins` have full access (RLS policies).
--     Being signed in is not enough: a stray sign-up gets nothing.
--
-- After applying, make your account an admin once (Studio → SQL editor):
--
--   INSERT INTO public.app_admins (user_id)
--   SELECT id FROM auth.users WHERE email = 'you@example.com';
--
-- New tables: enable RLS and add an `app_admin_all` policy like below,
-- otherwise authenticated users cannot reach them.

-- ---------------------------------------------------------------------------
-- 1. Admin allow-list
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_admins WHERE user_id = auth.uid()
  );
$$;

-- True when respondents may submit to (and upload files for) this form.
-- Takes TEXT so it can be fed a storage path segment without cast errors.
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
      );
$$;

-- ---------------------------------------------------------------------------
-- 2. Respondent entry points
-- ---------------------------------------------------------------------------

-- Only what the public form page renders — never the full intent, the
-- projection or the design history. Admins can also load drafts (preview).
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
    AND (p.status = 'published' OR public.is_app_admin());
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

  INSERT INTO public.responses (portfolio_id, data)
  VALUES (p_portfolio_id, p_data)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Take the anon key's table access away
-- ---------------------------------------------------------------------------

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, PUBLIC;

-- …including for objects created by later migrations (undoes 006's defaults).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, PUBLIC;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_admins
  TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_published_form(UUID)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_response(UUID, JSONB)
  TO anon, authenticated, service_role;
-- Called from storage policies, which run as the requesting role.
GRANT EXECUTE ON FUNCTION public.is_form_accepting(TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_app_admin()
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commit_portfolio_change(
  UUID, INTEGER, JSONB, JSONB, TEXT, TEXT, JSONB
) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Row-level security: admins only, on every public table
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
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

-- ---------------------------------------------------------------------------
-- 5. Response files: private bucket, respondents may upload but not read
-- ---------------------------------------------------------------------------

UPDATE storage.buckets SET public = false WHERE id = 'response-files';

DROP POLICY IF EXISTS "response_files_select" ON storage.objects;
DROP POLICY IF EXISTS "response_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "response_files_admin_read" ON storage.objects;

-- Uploads only into `<portfolio_id>/…` of a form that accepts responses.
CREATE POLICY "response_files_insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'response-files'
    AND public.is_form_accepting((storage.foldername(name))[1])
  );

-- Reading (signed URLs in the response viewer) is admin-only.
CREATE POLICY "response_files_admin_read"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'response-files'
    AND (SELECT public.is_app_admin())
  );
