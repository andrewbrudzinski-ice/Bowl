/* Usage: npm run db:check
 * Diagnoses a DATABASE_URL step by step (parse → DNS → TCP → login → migrations → locks) and says what to fix.
 * Read-only: it never creates, changes or prints anything sensitive (the password is never shown). Exit code 1 if any step fails. */
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createPgClient } from "../src/server/pg/client";

let failed = 0;
const ok = (m: string) => console.log(`  ✓ ${m}`);
const bad = (m: string, hint?: string) => {
  failed++;
  console.log(`  ✗ ${m}`);
  if (hint) console.log(`      → ${hint}`);
};
const warn = (m: string) => console.log(`  ! ${m}`);
const step = (m: string) => console.log(`\n${m}`);

/** Turns the driver's error into the thing an operator should actually do. */
function explain(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/password authentication failed/i.test(m)) return "Wrong password for this user. Reset it in Supabase (Connect → Reset database password) and, if it has symbols, percent-encode them in the URL (@ → %40, # → %23, / → %2F, : → %3A).";
  if (/role ".*" does not exist/i.test(m)) return "That database user doesn't exist. Check the user in the URL (Supabase: postgres.<project-ref>).";
  if (/tenant or user not found/i.test(m)) return "The pooler didn't recognise the user or project. Copy the string again from Supabase → Connect; the user must look like postgres.<project-ref> and the host must be your project's pooler region.";
  if (/self[- ]signed|unable to verify|certificate/i.test(m)) return "TLS certificate not trusted by node-postgres. Set DATABASE_SSL=no-verify (Supabase's pooler commonly needs it).";
  if (/no pg_hba\.conf|ssl.*required|SSL connection is required/i.test(m)) return "The server requires TLS. Set DATABASE_SSL=require (or no-verify).";
  if (/ENOTFOUND|EAI_AGAIN/i.test(m)) return "The host name doesn't resolve. Check for a typo in the host, and that this machine has DNS/network access.";
  if (/ECONNREFUSED/i.test(m)) return "Nothing is listening on that host:port. Check the port (pooler: 6543 transaction / 5432 session) and that the project isn't paused.";
  if (/ETIMEDOUT|timeout/i.test(m)) return "Connection timed out. A firewall or network policy is probably blocking this port (some sandboxes only allow web traffic on 443).";
  if (/too many (clients|connections)|remaining connection slots/i.test(m)) return "The database is out of connections. Lower DATABASE_POOL_MAX or use the pooled (6543) string.";
  return m;
}

const tcp = (host: string, port: number, ms = 6000) =>
  new Promise<void>((resolve, reject) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => {
      s.destroy();
      reject(new Error("ETIMEDOUT"));
    }, ms);
    s.once("connect", () => {
      clearTimeout(t);
      s.end();
      resolve();
    });
    s.once("error", (e) => {
      clearTimeout(t);
      reject(e);
    });
  });

async function main() {
  console.log("Bowl database check");

  step("1. Connection string");
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    bad("DATABASE_URL is not set", "Export DATABASE_URL (see .env.example), then re-run.");
    return;
  }
  // Unencoded # or @ in the password silently changes how the URL parses (host becomes "ss" in postgres://u:pa@ss#w@host/db).
  const authority = raw.replace(/^[a-z]+:\/\//i, "").split("/")[0];
  if (raw.includes("#") || (authority.match(/@/g) ?? []).length > 1) {
    bad("The URL contains a # or more than one @, which usually means the password has unencoded symbols", "Percent-encode them in the password (@ → %40, # → %23, / → %2F, : → %3A, ? → %3F) or reset the password to letters and numbers only.");
    return;
  }
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    bad("DATABASE_URL isn't a valid URL", "Usually an unencoded symbol in the password, or leftover [YOUR-PASSWORD] brackets. Percent-encode symbols (@ → %40, # → %23).");
    return;
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) bad(`Unexpected scheme "${u.protocol}"`, "It must start with postgresql://");
  const host = u.hostname;
  const port = Number(u.port || 5432);
  const user = decodeURIComponent(u.username);
  const db = u.pathname.replace(/^\//, "") || "postgres";
  const local = /^(localhost|127\.0\.0\.1|::1|\[::1\])$/.test(host);
  if (!u.password && local) warn("No password in the URL (fine for a local trust-auth database).");
  else if (!u.password) bad("No password in the URL", "Replace [YOUR-PASSWORD] with the real password.");
  else if (/^\[.*\]$/.test(decodeURIComponent(u.password))) bad("The password is still the [YOUR-PASSWORD] placeholder", "Replace it, brackets included.");
  else ok(`host ${host}, port ${port}, user ${user}, database ${db} (password hidden)`);
  if (!u.password && local) ok(`host ${host}, port ${port}, user ${user}, database ${db}`);
  const isSupabasePooler = /pooler\.supabase\.com$/.test(host);
  if (isSupabasePooler && !/^postgres\.[a-z0-9]+$/.test(user)) warn(`Supabase pooler users look like "postgres.<project-ref>"; this one is "${user}".`);
  if (isSupabasePooler && port === 5432) warn("Port 5432 on the pooler is session mode. It works, but 6543 (transaction mode) is the one meant for apps like this.");
  const ssl = process.env.DATABASE_SSL;
  if (isSupabasePooler && !ssl) warn("DATABASE_SSL isn't set. Supabase's pooler usually needs DATABASE_SSL=no-verify with node-postgres.");
  if (ssl && !["require", "no-verify", "disable"].includes(ssl)) warn(`DATABASE_SSL="${ssl}" isn't recognised (use require, no-verify or disable).`);

  step("2. DNS");
  try {
    const addrs = await dns.lookup(host, { all: true });
    ok(`${host} → ${addrs.map((a) => a.address).join(", ")}`);
  } catch (e) {
    bad(`Can't resolve ${host}`, explain(e));
    return;
  }

  step("3. TCP");
  try {
    const t0 = Date.now();
    await tcp(host, port);
    ok(`connected to ${host}:${port} in ${Date.now() - t0} ms`);
  } catch (e) {
    bad(`Can't reach ${host}:${port}`, explain(e));
    return;
  }

  step("4. Login");
  const sslMode = ssl === "no-verify" ? "no-verify" : ssl === "require" ? "require" : ssl === "disable" ? "disable" : undefined;
  const client = await createPgClient(raw, { max: 1, ssl: sslMode }).catch((e) => {
    bad("Couldn't create a client", explain(e));
    return null;
  });
  if (!client) return;
  try {
    const t0 = Date.now();
    const info = await client.transaction(async (tx) => (await tx.query<{ v: string; u: string; d: string; ssl: boolean | null }>(
      "select version() as v, current_user as u, current_database() as d, (select ssl from pg_stat_ssl where pid = pg_backend_pid()) as ssl"
    )).rows[0]);
    ok(`logged in as ${info.u} to ${info.d} in ${Date.now() - t0} ms`);
    ok(info.v.split(" ").slice(0, 2).join(" "));
    if (info.ssl === false) warn("This connection is NOT encrypted. Set DATABASE_SSL=require (or no-verify) for any network you don't control.");

    step("5. Schema");
    const files = fs.readdirSync(path.resolve(__dirname, "../supabase/migrations")).filter((f) => f.endsWith(".sql")).sort();
    const has = await client.transaction(async (tx) => (await tx.query<{ ok: boolean }>("select to_regclass('public.schema_migrations') is not null as ok")).rows[0].ok);
    if (!has) bad("The database hasn't been migrated (no schema_migrations table)", "Run: npm run db:migrate");
    else {
      const applied = new Set(await client.transaction(async (tx) => (await tx.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name)));
      const pending = files.filter((f) => !applied.has(f));
      if (pending.length) bad(`Pending migrations: ${pending.join(", ")}`, "Run: npm run db:migrate (before starting the new build)");
      else ok(`all ${files.length} migrations applied`);
      const unknown = [...applied].filter((n) => !files.includes(n));
      if (unknown.length) warn(`The database has migrations this checkout doesn't know about: ${unknown.join(", ")} (a newer build has run here)`);
    }

    step("6. Locking (used by every write)");
    const locks = await client.transaction(async (tx) => {
      const a = (await tx.query<{ ok: boolean }>("select pg_try_advisory_xact_lock_shared(7283561) as ok")).rows[0].ok;
      const b = (await tx.query<{ ok: boolean }>("select pg_try_advisory_xact_lock(hashtextextended('bowl:db-check', 0)) as ok")).rows[0].ok;
      return a && b;
    });
    if (locks) ok("advisory locks work (safe through the transaction pooler)");
    else bad("Couldn't take an advisory lock", "Another process holds the global lock exclusively right now; re-run in a moment.");

    step("7. Privileges");
    const priv = await client.transaction(async (tx) => (await tx.query<{ c: boolean }>("select has_schema_privilege(current_user, 'public', 'CREATE') as c")).rows[0].c);
    if (priv) ok("this user can create objects in the public schema (needed by db:migrate)");
    else warn("This user can't create objects in public. That's fine for running the app, but db:migrate must use a privileged user.");
  } catch (e) {
    bad("Query failed", explain(e));
  } finally {
    await client.end().catch(() => undefined);
  }
}

main()
  .catch((e) => bad("Unexpected error", explain(e)))
  .finally(() => {
    console.log(failed ? `\n${failed} problem(s) found.` : "\nAll checks passed.");
    process.exit(failed ? 1 : 0);
  });
