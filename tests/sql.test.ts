import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { PERMISSION_MATRIX } from "@/server/permissions";

/**
 * Loads supabase/migrations/0001_schema.sql into an in-process Postgres and checks the security model:
 * permission parity with the TypeScript matrix, RLS isolation, immutability of finalized scores, append-only audit.
 * `auth.uid()` is stubbed from a session setting, like Supabase does from the JWT.
 */
let db: PGlite;
const U = { owner: "00000000-0000-0000-0000-000000000001", scorer: "00000000-0000-0000-0000-000000000002", viewer: "00000000-0000-0000-0000-000000000003", assistant: "00000000-0000-0000-0000-000000000004", other: "00000000-0000-0000-0000-000000000005", com: "00000000-0000-0000-0000-000000000006" };
const L1 = "10000000-0000-0000-0000-000000000001";
const L2 = "10000000-0000-0000-0000-000000000002";
const S1 = "20000000-0000-0000-0000-000000000001";
const M1 = "30000000-0000-0000-0000-000000000001";
const B1 = "40000000-0000-0000-0000-000000000001";

async function as<T>(user: keyof typeof U | null, fn: () => Promise<T>): Promise<T> {
  await db.exec(`select set_config('request.jwt.sub', '${user ? U[user] : ""}', false); set role ${user ? "authenticated" : "anon"};`);
  try { return await fn(); } finally { await db.exec("reset role;"); }
}
const fails = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return String((e as Error).message); } };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/local-prelude.sql"), "utf8"));
  await db.exec(fs.readFileSync(path.join(__dirname, "../supabase/migrations/0001_schema.sql"), "utf8"));
  await db.exec(`grant usage on schema public to anon, authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant select on all tables in schema public to anon;
    revoke update, delete on audit_log from anon, authenticated;`);
  for (const id of Object.values(U)) await db.exec(`insert into profiles (id, display_name) values ('${id}', 'u-${id.slice(-1)}');`);
  await db.exec(`
    insert into leagues (id, slug, name, default_config, created_by, visibility) values ('${L1}', 'alpha', 'Alpha', '{}', '${U.owner}', 'private'), ('${L2}', 'beta', 'Beta', '{}', '${U.other}', 'private');
    insert into memberships (league_id, user_id, role) values ('${L1}', '${U.owner}', 'owner'), ('${L1}', '${U.scorer}', 'scorekeeper'), ('${L1}', '${U.viewer}', 'viewer'), ('${L1}', '${U.assistant}', 'assistant'), ('${L1}', '${U.com}', 'commissioner'), ('${L2}', '${U.other}', 'owner');
    insert into seasons (id, league_id, slug, name, year, start_date, regular_weeks) values ('${S1}', '${L1}', '2026', '2026', 2026, '2026-01-06', 4);
    insert into rule_versions (season_id, version, effective_from_week, config) values ('${S1}', 1, 1, '{}');
    insert into weeks (season_id, number, date) values ('${S1}', 1, '2026-01-06'), ('${S1}', 2, '2026-01-13');
    insert into teams (league_id, name) values ('${L1}', 'A'), ('${L1}', 'B');
    insert into bowlers (id, league_id, name) values ('${B1}', '${L1}', 'Alex');
  `);
  const [ta, tb] = (await db.query<{ id: string }>(`select id from teams where league_id='${L1}' order by name`)).rows;
  await db.exec(`insert into matchups (id, season_id, week_number, kind, side_a, side_b) values ('${M1}', '${S1}', 1, 'team', '${ta.id}', '${tb.id}');`);
});

describe("schema & RLS (supabase/migrations/0001_schema.sql)", () => {
  it("role_permissions matches the TypeScript permission matrix exactly", async () => {
    const rows = (await db.query<{ role: string; permission: string }>("select role::text, permission from role_permissions")).rows;
    const sql = new Set(rows.map((r) => `${r.role}:${r.permission}`));
    const ts = new Set(Object.entries(PERMISSION_MATRIX).flatMap(([perm, roles]) => roles.map((r) => `${r}:${perm}`)));
    expect([...sql].filter((x) => !ts.has(x))).toEqual([]);
    expect([...ts].filter((x) => !sql.has(x))).toEqual([]);
  });

  it("a private league is invisible to non-members, and members see only their own league", async () => {
    expect((await as(null, () => db.query("select * from leagues"))).rows).toHaveLength(0);
    expect((await as("other", () => db.query("select slug from leagues"))).rows.map((r) => (r as { slug: string }).slug)).toEqual(["beta"]);
    expect((await as("other", () => db.query("select * from teams"))).rows).toHaveLength(0);
    expect((await as("other", () => db.query("select * from matchups"))).rows).toHaveLength(0);
    expect((await as("viewer", () => db.query("select * from teams"))).rows).toHaveLength(2);
  });

  it("public leagues expose standings data but not audit, members or invitations", async () => {
    await db.exec(`update leagues set visibility = 'public' where id = '${L1}'`);
    try {
      expect((await as("other", () => db.query("select * from matchups where season_id = '" + S1 + "'"))).rows).toHaveLength(1);
      expect((await as(null, () => db.query("select * from teams"))).rows.length).toBeGreaterThan(0);
      expect((await as("other", () => db.query("select * from memberships where league_id = '" + L1 + "'"))).rows).toHaveLength(0);
      expect((await as("other", () => db.query("select * from audit_log where league_id = '" + L1 + "'"))).rows).toHaveLength(0);
      expect(await as("other", () => fails(db.exec(`insert into teams (league_id, name) values ('${L1}', 'Hax')`)))).toMatch(/row-level security/);
    } finally {
      await db.exec(`update leagues set visibility = 'private' where id = '${L1}'`);
    }
  });

  it("viewers cannot write scores; scorekeepers can; duplicates are rejected", async () => {
    const ins = (g: number) => db.exec(`insert into scores (matchup_id, bowler_id, side, game, scratch, updated_by) values ('${M1}', '${B1}', 'A', ${g}, 180, null)`);
    expect(await as("viewer", () => fails(ins(1)))).toMatch(/row-level security/);
    expect(await as("other", () => fails(ins(1)))).toMatch(/row-level security/);
    expect(await as("scorer", () => fails(ins(1)))).toBeNull();
    expect(await as("scorer", () => fails(ins(1)))).toMatch(/duplicate key/);
    expect(await fails(db.exec(`insert into scores (matchup_id, bowler_id, side, game, scratch) values ('${M1}', '${B1}', 'A', 2, 451)`))).toMatch(/violates check/);
  });

  it("scorekeepers cannot change league settings or members", async () => {
    expect((await as("scorer", () => db.query(`update leagues set name = 'Hacked' where id = '${L1}' returning id`))).rows).toHaveLength(0);
    expect((await as("scorer", () => db.query(`update memberships set role = 'owner' where user_id = '${U.scorer}' returning id`))).rows).toHaveLength(0);
  });

  it("finalized scores are immutable; only correct_result() (commissioners) may change them, with an audit row", async () => {
    await db.exec(`update matchups set state = 'finalized', finalized_at = now(), rule_version = 1 where id = '${M1}'`);
    expect(await as("scorer", () => fails(db.exec(`update scores set scratch = 200 where matchup_id = '${M1}'`)))).toMatch(/finalized|row-level/);
    expect(await fails(db.exec(`delete from scores where matchup_id = '${M1}'`))).toMatch(/finalized/);
    const payload = JSON.stringify([{ bowler_id: B1, side: "A", game: 1, scratch: 199, kind: "bowled" }]);
    expect(await as("assistant", () => fails(db.query(`select correct_result('${M1}', '${payload}'::jsonb, 'typo')`)))).toMatch(/forbidden/);
    expect(await as("com", () => fails(db.query(`select correct_result('${M1}', '${payload}'::jsonb, '')`)))).toMatch(/reason/i);
    expect(await as("com", () => fails(db.query(`select correct_result('${M1}', '${payload}'::jsonb, 'Misread sheet')`)))).toBeNull();
    expect((await db.query<{ scratch: number }>(`select scratch from scores where matchup_id = '${M1}'`)).rows[0].scratch).toBe(199);
    expect((await db.query<{ state: string }>(`select state::text from matchups where id = '${M1}'`)).rows[0].state).toBe("corrected");
    const audit = (await db.query<{ action: string; note: string; before: unknown }>(`select action, note, before from audit_log where league_id = '${L1}'`)).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "result.corrected", note: "Misread sheet" });
  });

  it("the audit log is append-only, even for the table owner", async () => {
    expect(await fails(db.exec(`update audit_log set note = 'x'`))).toMatch(/append-only/);
    expect(await fails(db.exec(`delete from audit_log`))).toMatch(/append-only/);
    expect(await as("owner", () => fails(db.exec(`delete from audit_log`)))).not.toBeNull();
  });

  it("enforces: one active owner, finalized-needs-rule-version, no self-play, no double-booking, same-league lineups", async () => {
    expect(await fails(db.exec(`insert into memberships (league_id, user_id, role) values ('${L1}', '${U.other}', 'owner')`))).toMatch(/duplicate key|one_active_owner/);
    expect(await fails(db.exec(`insert into matchups (season_id, week_number, kind, side_a, side_b, state) values ('${S1}', 2, 'team', gen_random_uuid(), gen_random_uuid(), 'finalized')`))).toMatch(/violates check/);
    const [ta] = (await db.query<{ id: string }>(`select id from teams where league_id='${L1}' order by name`)).rows;
    expect(await fails(db.exec(`insert into matchups (season_id, week_number, kind, side_a, side_b) values ('${S1}', 2, 'team', '${ta.id}', '${ta.id}')`))).toMatch(/violates check/);
    expect(await fails(db.exec(`insert into matchups (season_id, week_number, kind, side_a) values ('${S1}', 1, 'team', '${ta.id}')`))).toMatch(/duplicate key/);
    const foreign = "40000000-0000-0000-0000-000000000099";
    await db.exec(`insert into bowlers (id, league_id, name) values ('${foreign}', '${L2}', 'Intruder')`);
    expect(await fails(db.exec(`insert into matchup_lineups (matchup_id, side, position, bowler_id) values ('${M1}', 'A', 1, '${foreign}')`))).toMatch(/different league/);
  });

  it("rule versions are immutable through the API (no update or delete policy)", async () => {
    expect((await as("owner", () => db.query(`update rule_versions set reason = 'x' where season_id = '${S1}' returning version`))).rows).toHaveLength(0);
    expect((await as("owner", () => db.query(`delete from rule_versions where season_id = '${S1}' returning version`))).rows).toHaveLength(0);
  });
});
