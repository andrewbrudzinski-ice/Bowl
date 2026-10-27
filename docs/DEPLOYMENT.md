# Deployment

## What you are deploying

A Next.js 15 app (Node 20+). **Data lives in a JSON file** (`BOWL_DATA_FILE`, default `./data/db.json`),
written atomically (temp file + rename) inside synchronous transactions. Consequences you must plan for:

- The host needs a **persistent disk** and must run **exactly one instance**. A serverless/ephemeral filesystem
  (e.g. Vercel's) will lose data. Good fits: a small VM, Fly.io / Railway / Render with a mounted volume, Docker on a VPS.
- Multiple instances writing the same file are not safe. Don't scale horizontally until the Postgres adapter
  exists (see [SUPABASE.md](SUPABASE.md)).
- A league of dozens of bowlers over many seasons is a few MB; this is comfortable. Hundreds of leagues is not
  what this storage layer is for.

## Environment variables

Never commit real values. Copy `.env.example`.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | **Yes in production** (the app refuses to start auth without it) | 32+ random chars used to hash session/invite/reset tokens. `openssl rand -base64 48`. Changing it signs everyone out and invalidates outstanding invitations and reset links. |
| `APP_URL` | Yes | Public base URL, used in invitation / reset / share links, e.g. `https://league.example.com`. |
| `BOWL_DATA_FILE` | Recommended | Absolute path on the persistent volume, e.g. `/data/db.json`. |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | Optional | Enables real email for password resets and invitations. Without them links are written to the server log (and, outside production, the console). Core features never need email. |
| `NODE_ENV=production` | Set by `npm start` | Enables secure cookies and disables the demo seed script. |

Supabase variables in `.env.example` are placeholders for the future adapter; the app ignores them today.

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
3. `npm run db:backup` on the server (verified copy of the live data).
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
