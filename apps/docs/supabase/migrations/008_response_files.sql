-- Storage for files attached to form responses (file fields).
--
-- The form renderer uploads each selected file before inserting the
-- response and stores a reference in responses.data:
--   { "path": "<portfolio_id>/<uuid>-<name>", "name", "size", "type", "url" }
--
-- Like the public tables (see 006_grants.sql) the prototype has no auth, so
-- the anon role may upload to and read from this one bucket. Storage is the
-- exception to "no RLS": storage.objects always has RLS enabled, so access
-- needs explicit policies. There is deliberately no UPDATE/DELETE policy —
-- uploads are append-only from the browser.

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('response-files', 'response-files', true, 52428800) -- 50 MiB
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "response_files_insert" ON storage.objects;
CREATE POLICY "response_files_insert"
  ON storage.objects
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'response-files');

DROP POLICY IF EXISTS "response_files_select" ON storage.objects;
CREATE POLICY "response_files_select"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'response-files');
