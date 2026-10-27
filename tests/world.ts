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

let counter = 0;
export function mkStore(): Store {
  return createStore({ file: null });
}

export function mkUser(store: Store, label = "user"): Actor {
  const n = ++counter;
  const { user } = registerUser(store, { email: `${label}${n}@example.com`, name: `${label} ${n}`, password: "correct-horse-battery" });
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

export function mkWorld(opts: { store?: Store; owner?: Actor; teams?: number; perTeam?: number; weeks?: number; config?: RuleConfig; visibility?: "private" | "unlisted" | "public"; name?: string } = {}): World {
  const store = opts.store ?? mkStore();
  const owner = opts.owner ?? mkUser(store, "owner");
  const T = opts.teams ?? 4;
  const P = opts.perTeam ?? 3;
  const cfg = opts.config ?? normalizeConfig(DEFAULT_CONFIG);
  const { leagueId, slug, seasonId } = createLeague(store, owner, {
    name: opts.name ?? `Test League ${++counter}`, visibility: opts.visibility ?? "private",
    season: { name: "2026 Season", year: 2026, startDate: "2026-01-06", regularWeeks: opts.weeks ?? 6 }, config: cfg,
  });
  const teamIds: Id[] = [];
  const bowlerIds: Id[][] = [];
  for (let t = 0; t < T; t++) {
    teamIds.push(addTeam(store, owner, leagueId, { name: `Team ${String.fromCharCode(65 + t)}` }));
    bowlerIds.push([]);
    for (let p = 0; p < P; p++) {
      const b = addBowler(store, owner, leagueId, { name: `Bowler ${t + 1}.${p + 1}` });
      bowlerIds[t].push(b);
      addToRoster(store, owner, leagueId, seasonId, { bowlerId: b, teamId: teamIds[t], enteringAverage: 150 + t * 10 + p * 5 });
    }
  }
  generateSchedule(store, owner, leagueId, seasonId);
  return { store, owner, leagueId, slug, seasonId, teamIds, bowlerIds };
}

export function join(w: World, role: Role, label: string = role): Actor {
  const u = mkUser(w.store, label);
  const { token } = inviteMember(w.store, w.owner, w.leagueId, { role: role === "owner" ? "commissioner" : role });
  acceptInvitation(w.store, u, token);
  return u;
}

export function weekMatchups(w: World, week: number) {
  return w.store.read((db) => db.matchups.filter((m) => m.seasonId === w.seasonId && m.weekNumber === week).map((m) => structuredClone(m)));
}

/** Enter + finalize every matchup in a week; `score(side, bowlerIndex, game)` provides scratch scores. */
export function playWeek(w: World, week: number, score: (matchupIdx: number, side: "A" | "B", i: number, g: number) => number = (mi, side, i, g) => (side === "A" ? 170 : 160) + i * 5 + g, actor: Actor = w.owner, finalize = true) {
  weekMatchups(w, week).forEach((m, idx) => {
    if (!m.sideB) return;
    const games = 3;
    const scores = (["A", "B"] as const).flatMap((side) =>
      (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId, i) =>
        Array.from({ length: games }, (_, g) => ({ bowlerId, side, game: g + 1, scratch: score(idx, side, i, g), kind: "bowled" as const }))
      )
    );
    const res = saveEntry(w.store, actor, w.leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores });
    if (finalize) finalizeMatchup(w.store, actor, w.leagueId, m.id, res.revision);
  });
}

export function model(w: World) {
  return w.store.read((db) => buildSeasonModel(seasonData(db, w.leagueId, w.seasonId)));
}
