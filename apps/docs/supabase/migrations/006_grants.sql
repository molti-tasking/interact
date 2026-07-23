-- Grant the PostgREST-facing roles data access to every public table.
--
-- The app has no auth/login flow and talks to Supabase with the anon key, so
-- anon (and authenticated/service_role) must be able to read and write the
-- public tables. On this project's local setup the standard Supabase default
-- privileges were not applying SELECT/INSERT/UPDATE/DELETE to these roles,
-- leaving every query denied with "42501 permission denied for table". These
-- grants make the access explicit so it survives `supabase db reset` and fresh
-- teammate setups. (There is deliberately no RLS — access is intentionally open
-- for this prototype.)

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;

GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;

-- Cover tables/sequences created by later migrations too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO anon, authenticated, service_role;
