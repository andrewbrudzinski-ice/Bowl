# Supabase / PostgreSQL

## Status — please read

| Piece | State |
| --- | --- |
| Schema, constraints, triggers, RLS policies | **Written** — `supabase/migrations/0001_schema.sql`. Loaded and exercised against an in-process Postgres by `tests/sql.test.ts`. |
| Application reading/writing Postgres | **Not implemented.** The app uses the file store (`src/server/db.ts`). |
| Supabase Auth | **Not implemented.** Accounts use the app's own email/password auth (scrypt, server-side sessions). |

So: nothing is "connected to Supabase". Don't point production at it expecting the site to use it.

## What the migration gives you

- Every league-scoped table references its league (directly or via season/matchup) and **every policy checks the
  caller's membership/permission in that league** — isolation doesn't depend on application filtering.
- `role_permissions` mirrors `src/server/permissions.ts` row for row (a test fails if they drift).
- Integrity in the database itself: one active owner per league; unique `(matchup, bowler, game)` (duplicate-submission
  guard); a participant can appear only once per week (no double-booked/duplicate matchups); score range checks;
  finalized matchups require a rule version; `revision` column bumped on update (optimistic concurrency);
  lineup bowlers must belong to the matchup's league.
- **Finalized scores are immutable** except through `correct_result()` — a security-definer function that requires
  `results.correct`, a reason, writes the audit row and changes the scores in one transaction.
- `audit_log` is append-only (trigger + revoked privileges + no update/delete policies).
- `rule_versions` has no update/delete policy: rules history can only grow.

## Connecting it (the remaining work)

1. Create a Supabase project; run the migration (`supabase db push` or paste into the SQL editor).
2. Replace the `Store` seam. The services in `src/server/services/*` call `store.read/transaction` with a whole-database
   snapshot. The Postgres version should keep the **service signatures and permission checks** but replace the snapshot
   with queries (the domain layer needs `SeasonData` — teams, bowlers, roster, weeks, matchups, scores for one season —
   which is one query set per request). Wrap multi-record operations (`finalize`, `applyRuleChange`, imports) in
   database transactions; the file-store tests for rollback (`tests/workflow.test.ts`) define the expected behavior.
3. Sessions/auth: either keep the app's own auth tables, or adopt Supabase Auth — then map `auth.users.id` to `profiles.id`
   and add `${APP_URL}/auth/callback` to the project's redirect URLs.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` **server-side only**. Use the anon key with RLS for any browser access; privileged
   operations (accepting invitations, resolving unlisted share tokens, notification fan-out) belong in server code or
   security-definer RPCs, because they intentionally bypass row policies.
5. Unlisted leagues: the share token cannot be a table policy (policies can't see request parameters). Resolve it in a
   server route/RPC that checks `share_token`, then issue the read with the service role limited to that league.

## Migrations workflow

New schema changes go in new numbered files (`0002_…sql`); never edit a migration that has been applied.
Back up before applying (see [BACKUPS.md](BACKUPS.md)).
