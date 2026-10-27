# Technical handoff

## Architecture

- **Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4.** Server components render pages from data;
  client components exist only where interaction needs them (score entry, rule editor, wizard, charts, import, nav).
- **`src/domain` is the product.** Pure functions, no I/O, driven entirely by a `RuleConfig` (zod-validated):
  - `config.ts` rules schema, defaults, starter templates, validation, playoff overrides
  - `handicap.ts` the single handicap formula + average resolution (entering / established / rolling / blended; new-bowler and sub policies)
  - `scoring.ts` one matchup → games, series, points, bonus, winner, per-bowler pairs (format "both"), forfeits, blind scores, partial games
  - `engine.ts` builds a season: rule version per week, official-games history, handicaps entering any week, locked snapshots for finalized results
  - `standings.ts` configurable tie-breakers (incl. head-to-head), explanations, progression, streaks, mathematically-certain clinch/elimination, playoff tie rule
  - `schedule.ts` round robin (byes, balance warnings), seeded bracket · `stats.ts`, `awards.ts`, `records.ts`, `rivalry.ts`, `narrative.ts` (insights + recaps), `validate.ts`, `rulechange.ts` (diff + preview), `csv.ts`, `describe.ts` (plain-language rules)
- **`src/server`**: `db.ts` Store interface (async), file store and backend selection · `pg/` PostgreSQL store (draft + diff writes under an advisory lock), codecs, migrations · `auth.ts` scrypt passwords, hashed server-side sessions, lockout, reset tokens · `permissions.ts` the role→permission matrix ·
  `access.ts` league-scoped lookups, audit, notifications · `services/*` every mutation (permission check → validation → mutate → audit) · `demo.ts` · `mailer.ts` (optional email).
- **Security model.** Every service call: `requirePerm(db, actor, leagueId, perm)`. Every client-supplied id is re-resolved *through the league*
  (`matchupIn`, `teamIn`, `bowlerIn`, `seasonIn`), so another league's id returns "not found". Private leagues answer 404 to non-members. Pages gate by
  permission too, but the services are the real boundary. Postgres RLS (`supabase/migrations`) mirrors this for the future adapter.

## Data model (collections in `db.json`; tables in the SQL migration)

`users, sessions, resetTokens` · `leagues, memberships, invitations` · `seasons` (each holds its **`ruleVersions[]`**) · `teams, bowlers` (people, league-level)
· `roster` (season-specific, with `fromWeek/toWeek` team history) · `weeks` · `matchups` (state, revision, `ruleVersion`, **`handicapSnapshot`**) · `scores` (raw scratch — the only score source of truth)
· `audit` (append-only) · `announcements, notifications (deduped), commissionerAwards, templates, importLog, idempotency`.
Standings, averages, handicaps, awards and records are **derived on read** from scores + rule versions + snapshots; nothing derived is stored except the finalization snapshot (which is reconcilable with source scores).

### Historical integrity (how it works)
1. A season's rules are a list of versions; week *N* uses the newest version effective ≤ *N*.
2. Finalizing a matchup stores its rule version and each bowler's average/handicap. In `locked` mode the result always replays from that snapshot.
3. A rule change creates a **new version**; it can start at a future week (finalized weeks untouched), apply to future seasons only (changes the league default), or — explicitly, with typed confirmation —
   re-base the whole season ("correct history"), which re-snapshots results and writes one audit entry per recalculated result.
4. Previewing a change computes old vs. new on a copy and writes nothing.
5. Corrections to finalized scores need `results.correct`, an explicit confirmation and a reason; old/new scores and the standings movement go to the audit log.

## Feature status

**Complete and tested** (unit/integration tests, browser smoke test, production build):
configurable rules + wizard + settings; handicap engine; scoring/points/bonus/forfeit/absent; standings with tie-breakers and playoff race; round-robin/bracket;
weekly matchup pages (scoreboard, recap, breakdown, head-to-head, entering stats); home dashboard with commissioner-selectable/orderable modules;
bowler profiles (season + career, handicap breakdown, charts, history); team pages with rivalries; stats, awards (configurable + commissioner awards), record book (ties, former holders);
insights; timeline; announcements with archive; score-entry workspace (keyboard, drafts, validation, preview-before-finalize, corrections, reopen, conflict detection, idempotency, local unsaved-work recovery, leave-page warning);
audit log; commissioner overview; CSV import (preview, row errors, duplicates, all-or-nothing) / export; full league JSON backup + restore as a new league; accounts, invitations (expiring, revocable, email-bound), roles, member removal, ownership transfer, operator recovery;
in-app notifications with preferences and dedupe; shareable links (visibility-aware) and a PNG scorecard for matchups; PWA manifest/icons/offline page; structured logging.

**Implemented but limited — be aware:**
- **Storage:** Postgres/Supabase (`DATABASE_URL`), embedded Postgres, or the single-instance file store. The Postgres store loads only the requesting league's rows (scoped loads; verified by `BOWL_VERIFY_SCOPE=1`) and locks per league (writers in different leagues run concurrently; league creation and imports are exclusive) — see SUPABASE.md → limits. Supabase **Auth** is not used; the app has its own accounts, and its server connection bypasses RLS (policies are defense in depth).
- **Email** is used only for password reset and invitations (and only when a provider is configured). Per-event email notifications are **not implemented**; `Also send by email` in preferences is stored but has no delivery path yet.
- **Browser push notifications**: not implemented. In-app notifications only.
- **"Season approaching playoffs" notification**: not implemented (needs a scheduler). Bracket-set / round / champion notifications *are* sent.
- **Offline**: the PWA caches static assets and shows an offline page. There is **no offline score entry or sync** — by design, rather than pretend. Unsaved entries are kept in the browser's local storage on the same device and re-offered on return.
- **Images**: PNG scorecards exist for matchups. Standings, awards, profiles and weekly results are shareable by link (and print/screenshot cleanly) but have no generated image.
- **Avatars** are initials/colour or an `https://` image link; there is no file upload.
- **Playoffs**: single elimination only, seeded by standings, byes for top seeds. A level playoff matchup is resolved by the configured rule (series winner, then higher seed).
- **Handicap base** "league average / highest average" is supported but derived from *current* roster averages, so it can shift week to week by design.
- **Schedules** are round robin / double round robin / manual; no "play each opponent N times with home/away constraints" or multi-night formats.
- **Password recovery** works through the mail provider; with no provider the operator reads the link from the server log.
- No rate limiting beyond per-account login lockout; put a reverse-proxy limiter in front for public deployment.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| Everyone signed out after deploy | `SESSION_SECRET` changed or unset. Keep it stable. |
| "SESSION_SECRET must be set in production" | Set the env var; see DEPLOYMENT.md. |
| Data disappeared after redeploy | Data file not on a persistent volume — set `BOWL_DATA_FILE` to the mounted path and restore a backup. |
| Can't finalize: "missing score" | Every lineup bowler needs every game (or mark absent). Or set *Missing scores → allow partial* in rules. |
| "Someone else changed this matchup" | Optimistic-concurrency check; reload to see the other person's edit, re-apply yours. |
| Standings don't move | Only finalized results count (unless *include drafts* is on). Check the matchup state in Score entry. |
| A bowler's handicap looks wrong | Open their profile → "Handicap for week N" shows the formula, the average used and why. Finalized weeks use the locked snapshot. |
| Locked out of all admin accounts | `npm run recover-owner -- <league-slug> <email>` on the server (audited). |
| Invitation says invalid | Expired, revoked, already used, or addressed to a different email. Create a new one. |
| Import blocked | The preview lists every bad row with its line number; nothing is written until the file is clean. |

## Tests

`npm test` — 121 tests, runnable on file / embedded Postgres / a real Postgres server (`BOWL_TEST_STORE`): handicap/rounding/rolling/blended averages; hand-calculated matchups; same scores under different leagues' rules;
standings & tie-breakers; schedule byes; playoff clinch/elimination; awards/records/rivalries/recaps; validation; rule-change preview & historical integrity;
rollback on injected failure; corrections; security matrix (roles, isolation, visibility, invitations, lockout); imports; export/restore; demo data; SQL migration + RLS in an in-process Postgres.
`e2e/smoke.mjs` and `e2e/wizard.mjs` drive a real browser (Playwright is not a dependency; install it with `npm i -D playwright` or use a global install).
