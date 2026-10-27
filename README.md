# Bowl — bowling league platform

A mobile-first website for running bowling leagues: configurable handicap and scoring rules, weekly matchup
pages, live standings and playoffs, bowler profiles, records, awards, commissioner tools, versioned rules and
full audit history. Multiple independent leagues, each with its own members and roles.

> **Read this first — what is and isn't production-ready:** the app is fully functional and tested, but it
> stores data in a **file-backed JSON database** (atomic writes, single server instance). The Supabase/Postgres
> schema and Row Level Security policies are written (`supabase/migrations/`) and tested, but the application
> does **not yet read from Supabase**. See [docs/HANDOFF.md](docs/HANDOFF.md) for the full list of what is
> complete and what remains.

## Quick start

```bash
npm install
cp .env.example .env.local        # set SESSION_SECRET for anything but local play
npm run dev                       # http://localhost:3000
```

1. **Register** at `/register` — the first account becomes the owner of whatever league it creates.
2. **Create a league** (`/leagues/new`) — a six-step wizard: basics, format, games & scoring, handicap
   (with a live example), standings & playoffs, review.
3. Or click **Try a demo league** on the home page for simulated data (clearly labelled *DEMO DATA*; remove it from
   Commissioner → Seasons). CLI: `npm run seed:demo -- you@example.com`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server / production build / serve the build |
| `npm test` | Unit + integration + security tests (Vitest, ~120 tests incl. SQL/RLS) |
| `npm run lint` | Type-check (`tsc --noEmit`) |
| `npm run seed:demo -- <email>` | Create a removable demo league (refuses in production) |
| `npm run db:backup` | Verified copy of the file database into `data/backups/` |
| `npm run recover-owner -- <slug> <email>` | Operator recovery: make an account the owner of a league |
| `node e2e/smoke.mjs`, `node e2e/wizard.mjs` | Browser tests (Playwright; install separately) against a running server — see docs/HANDOFF.md |

## How it's organised

```
src/domain/    Pure calculation engine — no I/O. Rules config, handicap, scoring, standings, schedule,
               stats, awards, records, rivalries, insights, rule-change preview, validation.
src/server/    Store (transactional file DB), auth, permission matrix, services (every mutation is
               permission-checked and audited), demo data, mailer.
src/app/       Next.js App Router pages, server actions, route handlers (exports, scorecard PNG, PWA).
src/components UI: scoreboard, standings table, score-entry workspace, rule editor, charts, wizard…
supabase/      Postgres schema + RLS (not yet wired to the app).
tests/         Vitest suites. e2e/ has the Playwright smoke test.
docs/          Deployment, backups, Supabase, launch checklist, handoff.
```

The single most important rule of the codebase: **every calculation takes a `RuleConfig`**. No page, service
or component hardcodes a base average, a percentage, a game count or a point value.

## Documentation

- [docs/HANDOFF.md](docs/HANDOFF.md) — architecture, data model, what is done / not done, troubleshooting
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environment variables, hosting, domains, HTTPS, releases
- [docs/BACKUPS.md](docs/BACKUPS.md) — backups, restore, testing a backup
- [docs/SUPABASE.md](docs/SUPABASE.md) — the Postgres schema, RLS, and the work to connect it
- [docs/LAUNCH_CHECKLIST.md](docs/LAUNCH_CHECKLIST.md) — step-by-step go-live checklist
