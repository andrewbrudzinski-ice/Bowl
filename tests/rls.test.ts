import { describe, expect, it } from "vitest";
import { createPgliteClient } from "@/server/pg/client";
import { assertMigrated, migrate } from "@/server/pg/migrate";

/**
 * Supabase exposes every table in the `public` schema through its Data API, and warns (rls_disabled_in_public) about any without
 * row-level security. The app connects as the table owner, which bypasses it, so every table can have it on. This keeps it that way:
 * a migration that adds a table without enabling it fails here, and so does the migration runner's own bookkeeping table.
 */
describe("row-level security", () => {
  it("is on for every table in the public schema, including the migration bookkeeping table", async () => {
    const client = await createPgliteClient();
    await migrate(client);
    const unprotected = await client.transaction(async (tx) =>
      (await tx.query<{ name: string }>("select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1")).rows.map((r) => r.name)
    );
    expect(unprotected).toEqual([]);
    const tables = await client.transaction(async (tx) => (await tx.query<{ n: number }>("select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'")).rows[0].n);
    expect(tables).toBeGreaterThan(20); // a real check: there were tables to look at
  });

  it("is switched on for a database whose bookkeeping table was created before, and the app still reads and migrates it", async () => {
    const client = await createPgliteClient();
    await migrate(client);
    await client.transaction(async (tx) => { await tx.exec("alter table schema_migrations disable row level security"); });
    const flag = () => client.transaction(async (tx) => (await tx.query<{ on: boolean }>("select relrowsecurity as on from pg_class where oid = 'schema_migrations'::regclass")).rows[0].on);
    expect(await flag()).toBe(false);
    const again = await migrate(client); // runs again, as on every deploy that migrates
    expect(again.applied).toEqual([]);
    expect(await flag()).toBe(true);
    await expect(assertMigrated(client)).resolves.toBeUndefined();
    await migrate(client); // and again: nothing to do, nothing breaks
    expect(await flag()).toBe(true);
  });
});
