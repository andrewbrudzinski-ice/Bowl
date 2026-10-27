# Deployment

## What you are deploying

A Next.js 15 app (Node 20+) plus a database. Two supported setups:

- **PostgreSQL / Supabase (recommended for hosting).** Set `DATABASE_URL`, run `npm run db:migrate` as a release step, deploy anywhere —
  including serverless hosts, since no local disk is used. Writes are coordinated by database advisory locks (per league), so several instances are safe.
  Details and limits: [SUPABASE.md](SUPABASE.md).
- **File store (single small server).** Data lives in one JSON file (`BOWL_DATA_FILE`, default `./data/db.json`), written atomically. It needs a
  **persistent disk and exactly one instance**; a serverless/ephemeral filesystem will lose data.

## Environment variables

Never commit real values. Copy `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | **Yes in production** (the app refuses to start auth without it) | 32+ random chars used to hash session/invite/reset tokens. `openssl rand -base64 48`. Changing it signs everyone out and invalidates outstanding invitations and reset links. |
| `APP_URL` | Yes | Public base URL, used in invitation / reset / share links, e.g. `https://league.example.com`. |
| `DATABASE_URL` | For Postgres/Supabase | Connection string. Also `DATABASE_SSL` (`require`/`no-verify`) and `DATABASE_POOL_MAX`. |
| `BOWL_DATA_FILE` | File store only | Absolute path on the persistent volume, e.g. `/data/db.json`. |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Optional | Enables real email for password resets and invitations. Without them links are written to the server log (and, outside production, the console). Core features never need email. |
| `NODE_ENV=production` | Set by `npm start` | Enables secure cookies and disables the demo seed script. |

Never prefix database credentials with `NEXT_PUBLIC_`.

## Checking a deployment

- `npm run db:check` — step-by-step diagnosis of `DATABASE_URL` (parse → DNS → TCP → login → migrations → locks → privileges). It never prints the password and says what to fix
  for the common failures (wrong password, unencoded symbols, TLS settings, blocked ports, pending migrations). Run it from the machine that will run the app.
- `GET /api/health` — `200 {"ok":true}` when the app can open its database, `503 {"ok":false}` otherwise (reasons go to the server log, never the response). Point your host's health check or an uptime
  monitor at it.

**Some hosts and sandboxes only allow outbound web traffic (port 443).** The database connection is raw TCP on 6543/5432, so it fails there with a timeout even though the host name resolves;
`db:check` reports this at the TCP step. Use a host that allows outbound database connections, or widen the network policy.

## Build and run

```bash
npm ci
npm run lint && npm test          # gate: type-check + tests
npm run build
SESSION_SECRET=… APP_URL=https://… BOWL_DATA_FILE=/data/db.json npm start   # port 3000
```

### Docker (example)

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production BOWL_DATA_FILE=/data/db.json
COPY --from=build /app ./
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
```

Run with a named volume: `docker run -p 3000:3000 -v bowl-data:/data -e SESSION_SECRET=… -e APP_URL=https://… bowl`.

## HTTPS and custom domain

Terminate TLS in front of the app (Caddy, nginx, or your PaaS's managed certificates). Caddy is the least work:

```
league.example.com {
    reverse_proxy localhost:3000
}
```

Point a DNS `A`/`AAAA` (or `CNAME` on a PaaS) record at the host; Caddy obtains and renews the certificate
automatically. Set `APP_URL` to the `https://` address. Session cookies are `Secure` + `HttpOnly` + `SameSite=Lax` in production,
so the site must be served over HTTPS. The app sends `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff` and a strict referrer policy.

Authentication redirects: there is no third-party OAuth, so there are no provider redirect URLs to register.
(When Supabase Auth is adopted, add `${APP_URL}/auth/callback` to its allowed redirect list.)

## Releases (repeatable process)

1. `git pull`, `npm ci`.
2. `npm run lint && npm test` — must pass.
3. Back up first: `npm run db:backup` (file store) or a `pg_dump` / provider snapshot (Postgres) — see BACKUPS.md.
3b. With Postgres: `npm run db:migrate` (idempotent; the app refuses to start against an un-migrated database).
4. `npm run build`, restart the process (`systemctl restart bowl` / redeploy the container).
5. Open `/` and one league's standings; check the server log for `"level":"error"`.
6. Roll back by redeploying the previous build; the data file format is backward compatible within a major version
   (new fields are defaulted on read).

## Errors and monitoring

- Server logs are one JSON object per line (`t`, `level`, `event`, …). Passwords, tokens, secrets, cookies and
  hashes are redacted by key name. Ship stdout to your log service and alert on `"level":"error"` lines.
- Users see friendly messages; unexpected exceptions show "Something went wrong… nothing was changed" and are logged
  with the framework's error digest (shown on the error page as a reference).
- Uptime: probe `GET /` and `GET /manifest.webmanifest` every minute.
- Watch free disk on the data volume and the size of `db.json`.
