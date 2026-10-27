# PostgreSQL / Supabase

The app can store everything in PostgreSQL — Supabase, any managed Postgres (RDS, Neon, Railway…), a self-hosted
server, or an embedded Postgres (PGlite) for local work. The file store remains the zero-setup default.

## Choosing a backend

Set one of these (checked in this order; see `createStoreFromEnv` in `src/server/db.ts`):

| Variable | Backend |
| --- | --- |
| `DATABASE_URL` | PostgreSQL / Supabase via `pg`. Run `npm run db:migrate` first. |
| `BOWL_PGLITE_DIR` | Embedded Postgres (WASM) persisted in that directory. Real Postgres semantics, no server. Single process. Auto-migrates. |
| *(neither)* | File store at `BOWL_DATA_FILE` — one instance only. |

Related: `DATABASE_SSL` (`require` or `no-verify` — Supabase's pooler certificate often needs `no-verify` with node-postgres),
`DATABASE_POOL_MAX` (default 5), `BOWL_AUTO_MIGRATE=1` (apply migrations on first use; leave **off** in production and run `db:migrate` as a release step).

## Setting up on Supabase

1. Create a project. Copy the **connection string** (Project Settings → Database). The *Transaction pooler* string (port 6543) is the right one for a
   serverless/PaaS app; the direct string (5432) works for a single long-lived server. Both are supported — the store only uses transaction-scoped locks
   (`pg_advisory_xact_lock`) and unnamed statements, which are safe through the pooler.
2. `DATABASE_URL='postgresql://postgres.<ref>:<password>@<host>:6543/postgres' DATABASE_SSL=no-verify npm run db:migrate`
   — applies `supabase/migrations/*.sql` (recorded in `schema_migrations`). On Supabase the `auth` helpers already exist; on plain Postgres the runner applies
   `supabase/local-prelude.sql` first.
3. Set `DATABASE_URL` (+ `SESSION_SECRET`, `APP_URL`) on the host and deploy. No persistent disk is needed any more, so serverless hosting such as Vercel works.
4. Moving existing data from the file store: **back up `db.json`**, then
   `DATABASE_URL=… npm run db:import-file -- /path/to/db.json`. Ids are converted to UUIDs deterministically, notification links are rewritten, and the importer
   refuses to run against a database that already has accounts. Sessions are carried over (signed-in users stay signed in if `SESSION_SECRET` is unchanged).

**Never** put the database password or the Supabase service-role key in `NEXT_PUBLIC_*` variables or client code.

## How the store works (and its limits)

The services were written against an in-memory `db` object with synchronous callbacks. `PgStore` (`src/server/pg/store.ts`) keeps that contract on top of Postgres:

1. A transaction opens a Postgres transaction and takes a **global advisory lock**, so writers across *all* app instances are serialized. Read-modify-write logic
   (duplicate checks, revision checks, finalize) is therefore race-free, and the app can run on several instances.
2. The callback runs against a draft. When it touches a table not yet loaded, that table is loaded and the callback re-runs (so callbacks must be free of side effects outside `db`).
3. The draft is diffed against what was loaded and only the inserted/updated/deleted rows are written (updates before inserts, deletes first, parents before children),
   then committed. Any thrown error rolls the whole thing back — the rollback tests (`failure part-way through a multi-record update`) run against Postgres too.
4. Reads use a `REPEATABLE READ READ ONLY` snapshot.

Consequences you should know:

- **Scoped loads.** Every call site passes a `Scope` (`src/server/db.ts`) naming what it needs — a league (`leagueId` / `leagueSlug`), the acting user, an email,
  a session or invitation token, or `publicLeagues`. `PgStore` translates it to `WHERE` clauses (`src/server/pg/scope.ts`, backed by the `0002_indexes.sql` indexes),
  so a request reads one league's rows, not every league's. Rules to know:
  - Facets are OR-ed; a table with no applicable facet loads **nothing**; `all: ["leagues"]` opts a table into a full load (used where uniqueness must be checked, e.g. slugs when creating a league).
  - A call without a scope still loads whole tables (correct, just slow) — the safe default for new code. Add a scope when a path becomes hot.
  - The audit log is write-only inside transactions; the audit page and activity feed load only that league's rows.
  - Expired sessions, reset tokens and idempotency keys are swept once at process start (scoped transactions only see their own slice).
  - **Still unscoped:** the "copy rules from another league" picker on `/leagues/new`. It spans every league the user belongs to and loads whole tables.
  - **Write lock is still global** (below), so scoping reduces load time and memory, not write serialization.
  - A scope that is too narrow would make a callback see *less* data than it needs. `BOWL_VERIFY_SCOPE=1` guards against that: each scoped operation is re-run on full tables inside the
    same transaction and the result (and the rows it would write) must match, otherwise it throws `Scope mismatch`. It roughly doubles the work, so use it in tests/CI and when
    adding a scope, not in production. The whole suite passes with it on (`BOWL_VERIFY_SCOPE=1 npm run test:pg`).
- **Write throughput is one transaction at a time** (the global lock). A league night is a handful of writes; this is not a constraint for the intended use.
- **The app's connection is privileged.** It bypasses RLS and enforces permissions in `src/server/services/*`. The RLS policies in the migration are defense in depth for
  any direct client access you add later; they are tested (`tests/sql.test.ts`) but the app itself does not rely on them.
- Authentication is the app's own (email + scrypt password + hashed server-side sessions), stored in `profiles` / `sessions`. **Supabase Auth is not used.** To adopt it later,
  add a foreign key from `profiles.id` to `auth.users` and replace `src/server/auth.ts`.

## What the migration enforces in the database

- One active owner per league; unique `(matchup, bowler, game)` (duplicate-submission guard); a participant appears at most once per week (no double-booked or duplicate
  matchups); score range checks; finalized matchups carry a rule version (byes excepted); `revision` bumps on update (optimistic concurrency); lineup bowlers must belong to the
  matchup's league; one open roster entry per bowler per season.
- **Finalized scores are immutable** except through the app's authorized write path (it declares the matchups it is writing in `app.score_writes`) or the security-definer
  `correct_result()` (requires `results.correct`, a reason, and writes the audit row atomically).
- `audit_log` is append-only (trigger + revoked privileges). The only exception is deleting a whole **demo** league, declared by the app connection.
- `rule_versions` can only be appended to; the store refuses to update or delete an existing version.
- `role_permissions` mirrors `src/server/permissions.ts` row for row (a test fails if they drift).

## Testing against Postgres

The entire suite is backend-agnostic:

```bash
npm test                                  # file store (fast)
npm run test:pg                           # same suite on embedded Postgres (PGlite)
BOWL_VERIFY_SCOPE=1 npm run test:pg       # …and prove every scoped load returns what the full load would
TEST_DATABASE_URL=postgresql://postgres@localhost:5432/postgres npm run test:pg:server   # a real server; one throwaway database per test file
```

## Migrations workflow

New schema changes go in new numbered files (`0002_….sql`); never edit a migration that has been applied anywhere. Back up first (see [BACKUPS.md](BACKUPS.md)); run
`npm run db:migrate` as a release step *before* starting the new build. If the app starts against an un-migrated database it fails fast with "Database is not migrated".
