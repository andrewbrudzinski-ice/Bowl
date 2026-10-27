-- Minimal stand-ins for what Supabase provides, for plain PostgreSQL (local dev, CI, RDS, PGlite).
-- Idempotent. Not needed on Supabase.
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true), current_setting('request.jwt.sub', true)), '')::uuid
$$;
-- Roles are cluster-wide, so concurrent migrations (e.g. parallel test databases) can race to create them.
do $$ begin
  begin create role anon nologin; exception when duplicate_object or unique_violation then null; end;
  begin create role authenticated nologin; exception when duplicate_object or unique_violation then null; end;
end $$;
