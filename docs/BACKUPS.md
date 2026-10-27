# Backups and recovery

> No backup is active unless **you** schedule it. Nothing in this repository runs backups on its own, and I can't
> confirm what your host does with its volume snapshots. Treat the steps below as a plan to put in place, then verify.

## What to back up

With the file store, **one file**: `BOWL_DATA_FILE` (default `data/db.json`). It contains users (password hashes,
never plaintext), leagues, seasons, rule versions, scores, audit history — everything.

## Two layers

1. **Operational backup of the whole database** (disaster recovery)
   - `npm run db:backup` copies the file to `data/backups/db-<timestamp>.json`, verifies it parses, and keeps the newest 30.
   - Schedule it (cron): `0 * * * * cd /srv/bowl && npm run db:backup` (hourly) — and copy the backups **off the
     machine** (rclone / `aws s3 sync` / provider snapshot). A backup on the same disk doesn't survive that disk.
   - Recommended: hourly for 48 hours, then daily for 30 days, then weekly for a year. A league's total write volume
     is tiny, so storage is not a concern.
2. **League-level export** (portability, independent of the host)
   - Commissioner → Import / export → *Download full league backup (JSON)*. Includes seasons, rule versions, teams, rosters,
     schedules, raw scores, finalized results, announcements and the audit log. Excludes accounts, emails and private links.
   - CSV exports of scores/results/rosters/schedules are also available per season and are readable in a spreadsheet
     (scores include the handicap and rule version used, so they can be audited independently).

## Restore

**Whole database:**
1. Stop the app. 2. Keep the damaged file aside (`mv db.json db.broken.json`). 3. Copy the chosen backup to the
`BOWL_DATA_FILE` path. 4. Start the app and check a league's standings and the audit log's latest entries.

**One league, or into another environment:** sign in on the target site, Commissioner → Import / export →
*Restore from a full backup* and choose the JSON file. It always creates a **new** league owned by you with fresh IDs,
so it can never overwrite or mix with an existing league. Re-invite members afterwards.

## Test a backup before you rely on it

At least once before launch and then quarterly:
1. Take a backup, copy it to a scratch directory.
2. `BOWL_DATA_FILE=/tmp/restore-test/db.json npm run dev -- -p 3100` and sign in with a real account.
3. Compare: number of seasons, one finalized matchup's score and handicap, the standings table, and the latest audit entries.
4. Restore a league bundle into a throwaway account and confirm standings match the original.
The automated test `tests/workflow.test.ts › a league bundle restores into a new, independent league` proves the
bundle round-trips with identical computed standings.

## When Postgres is adopted

Use the provider's managed backups instead (Supabase: daily backups on paid plans, point-in-time recovery as an
add-on — verify in your project's dashboard before claiming it's on), plus `pg_dump` to storage you control.
See [SUPABASE.md](SUPABASE.md).
