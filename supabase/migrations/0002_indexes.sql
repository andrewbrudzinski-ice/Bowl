-- Indexes for league-scoped loading (the app reads/writes a league's rows by league_id, season_id, user_id and token).
create index if not exists memberships_league_idx on memberships (league_id);
create index if not exists memberships_user_idx on memberships (user_id);
create index if not exists invitations_league_idx on invitations (league_id);
create index if not exists teams_league_idx on teams (league_id);
create index if not exists bowlers_league_idx on bowlers (league_id);
create index if not exists season_rosters_season_idx on season_rosters (season_id);
create index if not exists matchups_season_idx on matchups (season_id);
create index if not exists scores_matchup_idx on scores (matchup_id);
create index if not exists announcements_league_idx on announcements (league_id);
create index if not exists notifications_user_idx on notifications (user_id);
create index if not exists notifications_league_idx on notifications (league_id);
create index if not exists commissioner_awards_league_idx on commissioner_awards (league_id);
create index if not exists templates_league_idx on templates (league_id);
create index if not exists import_log_league_idx on import_log (league_id);
create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists reset_tokens_user_idx on reset_tokens (user_id);
create index if not exists idempotency_prefix_idx on idempotency_keys (split_part(key, ':', 1));
