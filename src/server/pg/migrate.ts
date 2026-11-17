import fs from "node:fs";
import path from "node:path";
import type { SqlClient } from "./client";

export const MIGRATIONS_DIR = path.join(process.cwd(), "supabase", "migrations");
export const PRELUDE_FILE = path.join(process.cwd(), "supabase", "local-prelude.sql");

export function migrationFiles(dir = MIGRATIONS_DIR): { name: string; sql: string }[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+.*\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), "utf8") }));
}

/**
 * Applies pending migrations, each in its own transaction, recording them in schema_migrations.
 * On plain Postgres (no Supabase `auth` schema) the local prelude is applied first.
 */
export async function migrate(client: SqlClient, opts: { dir?: string } = {}): Promise<{ applied: string[]; current: string | null }> {
  const files = migrationFiles(opts.dir);
  return client.transaction(async (tx) => {
    // Only one process may migrate at a time.
    await tx.query("select pg_advisory_xact_lock(7283562)");
    await tx.exec("create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())");
    // The table lives in `public`, which Supabase exposes through its Data API. Row-level security with no policies keeps it closed to
    // everyone but its owner (our own connection), as it is for every table the migrations create. Only the owner may switch it on, so
    // anyone else running this leaves it alone instead of failing the migration.
    await tx.exec(`do $$ begin
      if exists (select 1 from pg_class where oid = 'schema_migrations'::regclass and not relrowsecurity) then
        alter table schema_migrations enable row level security;
      end if;
    exception when insufficient_privilege then null;
    end $$`);
    const hasAuth = (await tx.query<{ ok: boolean }>("select to_regnamespace('auth') is not null as ok")).rows[0].ok;
    const hasUid = hasAuth && (await tx.query<{ ok: boolean }>("select to_regprocedure('auth.uid()') is not null as ok")).rows[0].ok;
    if (!hasUid) await tx.exec(fs.readFileSync(PRELUDE_FILE, "utf8"));
    const done = new Set((await tx.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name));
    const applied: string[] = [];
    for (const f of files) {
      if (done.has(f.name)) continue;
      await tx.exec(f.sql);
      await tx.query("insert into schema_migrations (name) values ($1)", [f.name]);
      applied.push(f.name);
    }
    return { applied, current: files.length ? files[files.length - 1].name : null };
  });
}

/** Throws a clear error when the database is behind the code. */
export async function assertMigrated(client: SqlClient, opts: { dir?: string } = {}): Promise<void> {
  const files = migrationFiles(opts.dir);
  const state = await client.transaction(
    async (tx) => {
      const has = (await tx.query<{ ok: boolean }>("select to_regclass('public.schema_migrations') is not null as ok")).rows[0].ok;
      if (!has) return [] as string[];
      return (await tx.query<{ name: string }>("select name from schema_migrations")).rows.map((r) => r.name);
    },
    { readOnly: true }
  );
  const missing = files.filter((f) => !state.includes(f.name)).map((f) => f.name);
  if (missing.length) throw new Error(`Database is not migrated (pending: ${missing.join(", ")}). Run: npm run db:migrate`);
}
