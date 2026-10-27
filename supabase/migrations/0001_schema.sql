-- Bowl league platform: schema, constraints and Row Level Security for Supabase (PostgreSQL 15+).
--
-- The application's Postgres store (src/server/pg) reads and writes these tables with a privileged connection and
-- enforces authorization in its service layer; the RLS policies below are defense in depth for any direct access
-- (e.g. a future Supabase client in the browser). Exercised by tests/sql.test.ts and the full test-suite run against Postgres.
--
-- Requires the `auth` schema helpers of Supabase. On plain Postgres, apply supabase/local-prelude.sql first
-- (the migration runner does this automatically).
--
-- Permission matrix: mirrors src/server/permissions.ts. Keep the two in sync (a test compares them).

-- ---------------------------------------------------------------- enums
create type visibility as enum ('private', 'unlisted', 'public');
create type member_role as enum ('owner', 'commissioner', 'assistant', 'scorekeeper', 'bowler', 'viewer');
create type member_status as enum ('active', 'deactivated', 'removed');
create type result_state as enum ('scheduled', 'in_progress', 'draft', 'ready_for_review', 'finalized', 'corrected');
create type week_status as enum ('scheduled', 'in_progress', 'completed', 'postponed');
create type week_phase as enum ('regular', 'playoff');
create type score_kind as enum ('bowled', 'blind', 'forfeit', 'absent');

-- ---------------------------------------------------------------- profiles (1:1 with auth.users)
-- The app does its own email/password auth (scrypt + server-side sessions), so profiles carry the credentials.
-- If you later adopt Supabase Auth, add a FK from id to auth.users and drop password_hash.
create table profiles (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  email text check (email is null or email = lower(email)),
  password_hash text,
  disabled boolean not null default false,
  failed_count int not null default 0,
  failed_since timestamptz,
  display_name text not null check (char_length(display_name) between 1 and 80),
  notification_prefs jsonb not null default '{"results":true,"schedule":true,"announcements":true,"rules":true,"invitations":true,"playoffs":true,"email":false}',
  created_at timestamptz not null default now()
);
create unique index profiles_email_key on profiles (email) where email is not null;

create table sessions (
  token_hash text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table reset_tokens (
  token_hash text primary key,
  user_id uuid not null references profiles (id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

-- ---------------------------------------------------------------- leagues & membership
create table leagues (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null check (char_length(name) between 2 and 60),
  description text not null default '',
  accent text not null default '#38bdf8' check (accent ~ '^#[0-9a-fA-F]{6}$'),
  logo_text text not null default '',
  visibility visibility not null default 'private',
  share_token text not null default substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 24),
  default_config jsonb not null,
  homepage jsonb not null default '[]',
  awards_config jsonb not null default '{}',
  is_demo boolean not null default false,
  archived_at timestamptz,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  user_id uuid not null references profiles (id),
  role member_role not null,
  status member_status not null default 'active',
  bowler_id uuid,
  joined_at timestamptz not null default now(),
  unique (league_id, user_id)
);
-- exactly one active owner per league
create unique index one_active_owner on memberships (league_id) where role = 'owner' and status = 'active';

create table invitations (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  email text,
  role member_role not null check (role <> 'owner'),
  token_hash text not null unique,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_by uuid references profiles (id),
  accepted_at timestamptz
);

create table role_permissions (
  role member_role not null,
  permission text not null,
  primary key (role, permission)
);
insert into role_permissions (role, permission)
select r::member_role, p from (values
  ('owner,commissioner,assistant,scorekeeper', 'league.view_admin'),
  ('owner,commissioner', 'settings.general'),
  ('owner,commissioner', 'settings.rules'),
  ('owner', 'settings.visibility'),
  ('owner,commissioner', 'season.manage'),
  ('owner,commissioner,assistant', 'roster.manage'),
  ('owner,commissioner,assistant', 'schedule.manage'),
  ('owner,commissioner,assistant,scorekeeper', 'scores.enter'),
  ('owner,commissioner,assistant', 'results.finalize'),
  ('owner,commissioner', 'results.correct'),
  ('owner,commissioner,assistant', 'announcements.post'),
  ('owner,commissioner', 'awards.manage'),
  ('owner,commissioner,assistant', 'audit.view'),
  ('owner,commissioner', 'members.manage'),
  ('owner,commissioner,assistant', 'members.invite_basic'),
  ('owner,commissioner,assistant', 'data.export'),
  ('owner,commissioner', 'data.import'),
  ('owner', 'ownership.transfer'),
  ('owner', 'league.delete'),
  ('owner,commissioner', 'demo.reset'),
  ('owner,commissioner,assistant,scorekeeper,bowler', 'profile.edit_own')
) as v(roles, p), unnest(string_to_array(v.roles, ',')) as r;

-- ---------------------------------------------------------------- league-scoped entities
create table teams (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  short_name text not null default '',
  color text not null default '#38bdf8',
  logo text not null default '',
  active boolean not null default true,
  is_demo boolean not null default false,
  unique (id, league_id)
);
create unique index teams_unique_active_name on teams (league_id, lower(name)) where active;

create table bowlers (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  nickname text not null default '',
  avatar_color text not null default '#64748b',
  avatar_url text check (avatar_url is null or avatar_url ~ '^https://'),
  active boolean not null default true,
  user_id uuid references profiles (id),
  notes text not null default '',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, league_id)
);
alter table memberships add constraint memberships_bowler_fk foreign key (bowler_id) references bowlers (id);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  slug text not null,
  name text not null,
  year int not null check (year between 1990 and 2100),
  start_date date not null,
  regular_weeks int not null check (regular_weeks between 1 and 60),
  status text not null default 'active' check (status in ('setup', 'active', 'completed')),
  champion_id uuid,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (league_id, slug),
  unique (id, league_id)
);

-- Versioned rules: a season's rules never change in place. A new row is added for every change.
create table rule_versions (
  season_id uuid not null references seasons (id) on delete cascade,
  version int not null check (version >= 1),
  effective_from_week int not null check (effective_from_week >= 1),
  config jsonb not null,
  reason text not null default '',
  created_by uuid references profiles (id),
  created_at timestamptz not null default now(),
  primary key (season_id, version)
);

create table season_rosters (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  season_id uuid not null references seasons (id) on delete cascade,
  bowler_id uuid not null references bowlers (id),
  team_id uuid references teams (id),
  entering_average numeric(5, 1) check (entering_average is null or entering_average between 0 and 300),
  is_sub boolean not null default false,
  from_week int not null default 1 check (from_week >= 1),
  to_week int check (to_week is null or to_week >= from_week)
);
-- a bowler has at most one open assignment per season
create unique index one_open_roster_entry on season_rosters (season_id, bowler_id) where to_week is null;

create table weeks (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  season_id uuid not null references seasons (id) on delete cascade,
  number int not null check (number >= 1),
  date date not null,
  status week_status not null default 'scheduled',
  phase week_phase not null default 'regular',
  label text not null default '',
  unique (season_id, number)
);

create table matchups (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  season_id uuid not null references seasons (id) on delete cascade,
  week_number int not null,
  kind text not null check (kind in ('team', 'individual')),
  side_a uuid not null,
  side_b uuid,                        -- null = bye
  state result_state not null default 'scheduled',
  forfeit_by char(1) check (forfeit_by in ('A', 'B')),
  rule_version int,
  playoff_round int,
  notes text not null default '',
  revision int not null default 1,   -- optimistic concurrency token
  finalized_at timestamptz,
  finalized_by uuid references profiles (id),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  is_demo boolean not null default false,
  foreign key (season_id, week_number) references weeks (season_id, number),
  foreign key (season_id, rule_version) references rule_versions (season_id, version),
  check (side_b is null or side_a <> side_b),
  check (state not in ('finalized', 'corrected') or side_b is null or (finalized_at is not null and rule_version is not null))
);
-- a participant can appear at most once per week (no duplicate / double-booked matchups)
create unique index matchup_side_a_once on matchups (season_id, week_number, side_a);
create unique index matchup_side_b_once on matchups (season_id, week_number, side_b) where side_b is not null;

create table matchup_lineups (
  matchup_id uuid not null references matchups (id) on delete cascade,
  side char(1) not null check (side in ('A', 'B')),
  position int not null,
  bowler_id uuid not null references bowlers (id),
  primary key (matchup_id, side, position),
  unique (matchup_id, bowler_id)       -- a bowler cannot be in two slots of one matchup
);

-- Raw scratch scores are the source of truth.
create table scores (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  matchup_id uuid not null references matchups (id) on delete cascade,
  bowler_id uuid not null references bowlers (id),
  side char(1) not null check (side in ('A', 'B')),
  game int not null check (game >= 1),
  scratch int check (scratch is null or scratch between 0 and 450),
  kind score_kind not null default 'bowled',
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles (id),
  unique (matchup_id, bowler_id, game),             -- duplicate-submission guard
  check (kind <> 'bowled' or scratch is not null)
);

-- Handicap snapshot taken at finalization so results stay reproducible.
create table matchup_handicaps (
  matchup_id uuid not null references matchups (id) on delete cascade,
  bowler_id uuid not null references bowlers (id),
  average numeric(6, 2),
  handicap int not null,
  note text not null default '',
  primary key (matchup_id, bowler_id)
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  season_id uuid references seasons (id) on delete set null,
  at timestamptz not null default now(),
  user_id uuid not null references profiles (id),
  user_name text not null,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  note text not null default ''
);
create index audit_league_at on audit_log (league_id, at desc);

create table announcements (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 120),
  body text not null check (char_length(body) between 1 and 5000),
  category text not null,
  pinned boolean not null default false,
  created_by uuid not null references profiles (id),
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_name text not null
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  user_id uuid not null references profiles (id) on delete cascade,
  league_id uuid not null references leagues (id) on delete cascade,
  type text not null,
  title text not null,
  body text not null default '',
  href text not null,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, dedupe_key)               -- repeated edits can never notify twice
);

create table commissioner_awards (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  season_id uuid not null references seasons (id) on delete cascade,
  title text not null,
  recipient_kind text not null check (recipient_kind in ('bowler', 'team')),
  recipient_id uuid not null,
  note text not null default '',
  week int,
  created_by uuid not null references profiles (id),
  created_at timestamptz not null default now()
);

create table templates (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  name text not null,
  description text not null default '',
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table import_log (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  league_id uuid not null references leagues (id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid not null references profiles (id),
  kind text not null,
  ok boolean not null,
  rows int not null default 0,
  errors jsonb not null default '[]'
);

-- Short-lived duplicate-submission guard for score saves.
create table idempotency_keys (
  key text primary key,
  seq bigint generated always as identity,
  at timestamptz not null default now(),
  result text not null
);

-- ---------------------------------------------------------------- helpers used by policies
create or replace function is_active_member(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.league_id = lid and m.user_id = auth.uid() and m.status = 'active');
$$;

create or replace function has_permission(lid uuid, perm text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m join role_permissions rp on rp.role = m.role
    where m.league_id = lid and m.user_id = auth.uid() and m.status = 'active' and rp.permission = perm);
$$;

create or replace function league_is_public(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from leagues l where l.id = lid and l.visibility = 'public' and l.archived_at is null);
$$;

create or replace function can_read_league(lid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_member(lid) or league_is_public(lid);
$$;

create or replace function season_league(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select league_id from seasons where id = sid;
$$;

create or replace function matchup_league(mid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select s.league_id from matchups m join seasons s on s.id = m.season_id where m.id = mid;
$$;

create or replace function matchup_is_official(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from matchups where id = mid and state in ('finalized', 'corrected'));
$$;

-- ---------------------------------------------------------------- integrity triggers
-- Finalized results are protected: score rows cannot change unless a correction is in progress, which only the
-- security-definer correct_result() below can declare, and only for users holding results.correct.
-- The application's own (privileged) connection declares the matchups it is writing in `app.score_writes`, after its
-- service layer has already authorized the change (finalize flows write scores and flip state in one transaction).
create or replace function protect_official_scores() returns trigger language plpgsql as $$
declare mid uuid := coalesce(new.matchup_id, old.matchup_id);
begin
  if matchup_is_official(mid)
     and coalesce(current_setting('app.correcting', true), '') <> mid::text
     and not (mid::text = any (string_to_array(coalesce(current_setting('app.score_writes', true), ''), ','))) then
    raise exception 'This result is finalized. Use correct_result() to change it.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;
create trigger scores_protect before insert or update or delete on scores
  for each row execute function protect_official_scores();

-- Cross-league guard: lineup bowlers must belong to the matchup's league.
create or replace function lineup_same_league() returns trigger language plpgsql as $$
begin
  if (select league_id from bowlers where id = new.bowler_id) <> matchup_league(new.matchup_id) then
    raise exception 'Bowler belongs to a different league';
  end if;
  return new;
end $$;
create trigger lineup_league_guard before insert or update on matchup_lineups
  for each row execute function lineup_same_league();

create or replace function bump_revision() returns trigger language plpgsql as $$
begin
  if new.revision = old.revision then new.revision := old.revision + 1; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger matchups_revision before update on matchups for each row execute function bump_revision();

-- Audit entries are append-only, enforced even against privileged roles that have table access.
create or replace function audit_immutable() returns trigger language plpgsql as $$
begin
  -- The only permitted removal: deleting a whole *demo* league, declared by the privileged app connection.
  if tg_op = 'DELETE'
     and old.league_id::text = any (string_to_array(coalesce(current_setting('app.purge_demo', true), ''), ','))
     and exists (select 1 from leagues l where l.id = old.league_id and l.is_demo) then
    return old;
  end if;
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_no_update before update or delete on audit_log for each row execute function audit_immutable();

-- A finalized correction: one transaction changes the scores, marks the matchup corrected and writes the audit row.
create or replace function correct_result(mid uuid, new_scores jsonb, reason text) returns void
language plpgsql security definer set search_path = public as $$
declare lid uuid := matchup_league(mid); old_scores jsonb;
begin
  if not has_permission(lid, 'results.correct') then raise exception 'forbidden' using errcode = '42501'; end if;
  if reason is null or char_length(trim(reason)) < 3 then raise exception 'A reason is required'; end if;
  if not matchup_is_official(mid) then raise exception 'Only finalized results can be corrected'; end if;
  perform set_config('app.correcting', mid::text, true);
  select coalesce(jsonb_agg(to_jsonb(s)), '[]') into old_scores from scores s where matchup_id = mid;
  delete from scores where matchup_id = mid;
  insert into scores (matchup_id, bowler_id, side, game, scratch, kind, updated_by)
    select mid, (x->>'bowler_id')::uuid, x->>'side', (x->>'game')::int, nullif(x->>'scratch', '')::int, (x->>'kind')::score_kind, auth.uid()
    from jsonb_array_elements(new_scores) x;
  update matchups set state = 'corrected', updated_by = auth.uid() where id = mid;
  insert into audit_log (league_id, season_id, user_id, user_name, action, entity_type, entity_id, before, after, note)
    select lid, m.season_id, auth.uid(), coalesce((select display_name from profiles where id = auth.uid()), ''), 'result.corrected', 'matchup', mid::text, old_scores, new_scores, reason
    from matchups m where m.id = mid;
end $$;

-- ---------------------------------------------------------------- Row Level Security
alter table profiles enable row level security;
alter table leagues enable row level security;
alter table memberships enable row level security;
alter table invitations enable row level security;
alter table role_permissions enable row level security;
alter table teams enable row level security;
alter table bowlers enable row level security;
alter table seasons enable row level security;
alter table rule_versions enable row level security;
alter table season_rosters enable row level security;
alter table weeks enable row level security;
alter table matchups enable row level security;
alter table matchup_lineups enable row level security;
alter table scores enable row level security;
alter table matchup_handicaps enable row level security;
alter table audit_log enable row level security;
alter table announcements enable row level security;
alter table notifications enable row level security;
alter table commissioner_awards enable row level security;
alter table sessions enable row level security;
alter table reset_tokens enable row level security;
alter table templates enable row level security;
alter table import_log enable row level security;
alter table idempotency_keys enable row level security;

create policy profiles_self on profiles for select using (id = auth.uid());
create policy role_permissions_read on role_permissions for select using (true);

-- leagues: members and public viewers read; settings need permission. Unlisted links are resolved by a
-- security-definer RPC that checks the share token server-side (never via a table policy).
create policy leagues_read on leagues for select using (archived_at is null and (is_active_member(id) or visibility = 'public'));
create policy leagues_update on leagues for update using (has_permission(id, 'settings.general')) with check (has_permission(id, 'settings.general'));
create policy leagues_insert on leagues for insert with check (created_by = auth.uid());

-- memberships: see your own, and (for admins) your league's
create policy memberships_read on memberships for select using (user_id = auth.uid() or has_permission(league_id, 'members.invite_basic'));
create policy memberships_manage on memberships for update using (has_permission(league_id, 'members.manage') and role <> 'owner') with check (has_permission(league_id, 'members.manage') and role <> 'owner');
create policy invitations_read on invitations for select using (has_permission(league_id, 'members.invite_basic'));
create policy invitations_write on invitations for insert with check (has_permission(league_id, 'members.invite_basic') and created_by = auth.uid());
create policy invitations_revoke on invitations for update using (has_permission(league_id, 'members.invite_basic'));

-- league data: public/members read; changes by permission; every row is checked against its own league
create policy teams_read on teams for select using (can_read_league(league_id));
create policy teams_write on teams for all using (has_permission(league_id, 'roster.manage')) with check (has_permission(league_id, 'roster.manage'));
create policy bowlers_read on bowlers for select using (can_read_league(league_id));
create policy bowlers_write on bowlers for all using (has_permission(league_id, 'roster.manage')) with check (has_permission(league_id, 'roster.manage'));
create policy seasons_read on seasons for select using (can_read_league(league_id));
create policy seasons_write on seasons for all using (has_permission(league_id, 'season.manage')) with check (has_permission(league_id, 'season.manage'));
create policy rule_versions_read on rule_versions for select using (can_read_league(season_league(season_id)));
create policy rule_versions_insert on rule_versions for insert with check (has_permission(season_league(season_id), 'settings.rules'));  -- no update/delete policy: versions are immutable
create policy rosters_read on season_rosters for select using (can_read_league(season_league(season_id)));
create policy rosters_write on season_rosters for all using (has_permission(season_league(season_id), 'roster.manage')) with check (has_permission(season_league(season_id), 'roster.manage'));
create policy weeks_read on weeks for select using (can_read_league(season_league(season_id)));
create policy weeks_write on weeks for all using (has_permission(season_league(season_id), 'schedule.manage')) with check (has_permission(season_league(season_id), 'schedule.manage'));
create policy matchups_read on matchups for select using (can_read_league(season_league(season_id)));
create policy matchups_insert on matchups for insert with check (has_permission(season_league(season_id), 'schedule.manage'));
create policy matchups_update on matchups for update using (has_permission(season_league(season_id), 'scores.enter') and state not in ('finalized', 'corrected'))
  with check (has_permission(season_league(season_id), 'scores.enter') and (state not in ('finalized', 'corrected') or has_permission(season_league(season_id), 'results.finalize')));
create policy matchups_delete on matchups for delete using (has_permission(season_league(season_id), 'schedule.manage') and state = 'scheduled');
create policy lineups_read on matchup_lineups for select using (can_read_league(matchup_league(matchup_id)));
create policy lineups_write on matchup_lineups for all using (has_permission(matchup_league(matchup_id), 'scores.enter') and not matchup_is_official(matchup_id)) with check (has_permission(matchup_league(matchup_id), 'scores.enter'));
create policy scores_read on scores for select using (can_read_league(matchup_league(matchup_id)));
create policy scores_write on scores for all using (has_permission(matchup_league(matchup_id), 'scores.enter')) with check (has_permission(matchup_league(matchup_id), 'scores.enter'));  -- official rows are additionally blocked by the trigger
create policy handicaps_read on matchup_handicaps for select using (can_read_league(matchup_league(matchup_id)));
create policy handicaps_write on matchup_handicaps for all using (has_permission(matchup_league(matchup_id), 'results.finalize')) with check (has_permission(matchup_league(matchup_id), 'results.finalize'));

-- audit: readable by auditors, insertable by anyone acting in the league, never updatable or deletable
create policy audit_read on audit_log for select using (has_permission(league_id, 'audit.view'));
create policy audit_insert on audit_log for insert with check (is_active_member(league_id) and user_id = auth.uid());

create policy announcements_read on announcements for select using (can_read_league(league_id));
create policy announcements_write on announcements for all using (has_permission(league_id, 'announcements.post')) with check (has_permission(league_id, 'announcements.post'));
create policy notifications_own on notifications for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy awards_read on commissioner_awards for select using (can_read_league(league_id));
create policy awards_write on commissioner_awards for all using (has_permission(league_id, 'awards.manage')) with check (has_permission(league_id, 'awards.manage'));

-- Credentials, sessions and housekeeping tables have RLS enabled and NO policies: only the privileged server connection can touch them.
create policy templates_read on templates for select using (has_permission(league_id, 'settings.rules'));
create policy import_log_read on import_log for select using (has_permission(league_id, 'data.import'));

-- Never let the audit trail be tampered with through the API, whatever policies say.
revoke update, delete on audit_log from anon, authenticated;
