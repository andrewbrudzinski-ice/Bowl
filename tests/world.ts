import { DEFAULT_CONFIG, normalizeConfig, type RuleConfig } from "@/domain/config";
import { buildSeasonModel } from "@/domain/engine";
import type { Id } from "@/domain/types";
import { seasonData, type Actor } from "@/server/access";
import { registerUser } from "@/server/auth";
import { createStore, type Store } from "@/server/db";
import { createLeague, inviteMember, acceptInvitation } from "@/server/services/leagues";
import { saveEntry, finalizeMatchup } from "@/server/services/results";
import { addBowler, addTeam, addToRoster, generateSchedule } from "@/server/services/season";
import type { Role } from "@/domain/types";
import { afterAll } from "vitest";

let counter = 0;

/**
 * Which backend the suite runs against: BOWL_TEST_STORE=file (default) | pglite | pg.
 * `pg` needs TEST_DATABASE_URL pointing at a server where a throwaway database can be created.
 * One database per test file; every mkStore() call truncates it, so tests stay independent.
 */
export const TEST_BACKEND = process.env.BOWL_TEST_STORE ?? "file";
let shared: { store: Store; truncate: () => Promise<void>; drop?: () => Promise<void> } | null = null;

export async function mkStore(): Promise<Store> {
  if (TEST_BACKEND === "file") return createStore({ file: null });
  if (!shared) {
    const { createPgClient, createPgliteClient } = await import("@/server/pg/client");
    const { PgStore } = await import("@/server/pg/store");
    const { CODECS } = await import("@/server/pg/codecs");
    let client;
    let drop: (() => Promise<void>) | undefined;
    if (TEST_BACKEND === "pglite") client = await createPgliteClient();
    else {
      const base = process.env.TEST_DATABASE_URL!;
      const name = `bowl_t_${process.pid}_${Date.now().toString(36)}`;
      const admin = await createPgClient(base, { max: 1 });
      await admin.transaction(async () => {}); // connectivity check
      const pg = await import("pg");
      const c = new pg.Client({ connectionString: base });
      await c.connect();
      await c.query(`create database ${name}`);
      await c.end();
      await admin.end();
      const u = new URL(base);
      u.pathname = "/" + name;
      client = await createPgClient(u.toString(), { max: 3 });
      drop = async () => {
        await client!.end();
        const d = new pg.Client({ connectionString: base });
        await d.connect();
        await d.query(`drop database if exists ${name} with (force)`);
        await d.end();
      };
    }
    const store = new PgStore(client, { autoMigrate: true, verifyScope: process.env.BOWL_VERIFY_SCOPE === "1" });
    const tables = CODECS.map((c) => c.table);
    shared = {
      store,
      drop,
      truncate: async () => {
        await client.transaction(async (tx) => {
          const has = (await tx.query<{ ok: boolean }>("select to_regclass('public.profiles') is not null as ok")).rows[0].ok;
          if (has) await tx.exec(`set local session_replication_role = replica; truncate ${tables.join(", ")} restart identity cascade;`);
        });
      },
    };
    afterAll(async () => {
      await store.close();
      await shared?.drop?.();
      shared = null;
    });
  }
  await shared.store.read(() => 0); // ensures migrations ran
  await shared.truncate();
  return shared.store;
}

export async function mkUser(store: Store, label = "user"): Promise<Actor> {
  const n = ++counter;
  const { user } = await registerUser(store, { email: `${label}${n}@example.com`, name: `${label} ${n}`, password: "correct-horse-battery" });
  return { id: user.id, name: user.name, email: user.email };
}

export interface World {
  store: Store;
  owner: Actor;
  leagueId: Id;
  slug: string;
  seasonId: Id;
  teamIds: Id[];
  bowlerIds: Id[][];
}

export async function mkWorld(opts: { store?: Store; owner?: Actor; teams?: number; perTeam?: number; weeks?: number; config?: RuleConfig; visibility?: "private" | "unlisted" | "public"; name?: string } = {}): Promise<World> {
  const store = opts.store ?? (await mkStore());
  const owner = opts.owner ?? await mkUser(store, "owner");
  const T = opts.teams ?? 4;
  const P = opts.perTeam ?? 3;
  const cfg = opts.config ?? normalizeConfig(DEFAULT_CONFIG);
  const { leagueId, slug, seasonId } = await createLeague(store, owner, {
    name: opts.name ?? `Test League ${++counter}`, visibility: opts.visibility ?? "private",
    season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: opts.weeks ?? 6 }, config: cfg,
  });
  const teamIds: Id[] = [];
  const bowlerIds: Id[][] = [];
  for (let t = 0; t < T; t++) {
    teamIds.push(await addTeam(store, owner, leagueId, { name: `Team ${String.fromCharCode(65 + t)}` }));
    bowlerIds.push([]);
    for (let p = 0; p < P; p++) {
      const b = await addBowler(store, owner, leagueId, { name: `Bowler ${t + 1}.${p + 1}` });
      bowlerIds[t].push(b);
      await addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: teamIds[t], enteringAverage: 150 + t * 10 + p * 5 });
    }
  }
  await generateSchedule(store, owner, leagueId, seasonId);
  return { store, owner, leagueId, slug, seasonId, teamIds, bowlerIds };
}

export async function join(w: World, role: Role, label: string = role): Promise<Actor> {
  const u = await mkUser(w.store, label);
  const { token } = await inviteMember(w.store, w.owner, w.leagueId, { role: role === "owner" ? "commissioner" : role });
  await acceptInvitation(w.store, u, token);
  return u;
}

export function weekMatchups(w: World, week: number) {
  return w.store.read((db) => db.matchups.filter((m) => m.seasonId === w.seasonId && m.weekNumber === week).map((m) => structuredClone(m)));
}

/** Enter + finalize every matchup in a week; `score(side, bowlerIndex, game)` provides scratch scores. */
export async function playWeek(w: World, week: number, score: (matchupIdx: number, side: "A" | "B", i: number, g: number) => number = (mi, side, i, g) => (side === "A" ? 170 : 160) + i * 5 + g, actor: Actor = w.owner, finalize = true) {
  for (const [idx, m] of (await weekMatchups(w, week)).entries()) {
    if (!m.sideB) continue;
    const games = 3;
    const scores = (["A", "B"] as const).flatMap((side) =>
      (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId, i) =>
        Array.from({ length: games }, (_, g) => ({ bowlerId, side, game: g + 1, scratch: score(idx, side, i, g), kind: "bowled" as const }))
      )
    );
    const res = await saveEntry(w.store, actor, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
    if (finalize) await finalizeMatchup(w.store, actor, w.leagueId, m.id, res.revision);
  }
}

export function model(w: World) {
  return w.store.read((db) => buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)));
}
