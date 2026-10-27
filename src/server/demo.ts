import { normalizeConfig, DEFAULT_CONFIG } from "@/domain/config";
import type { Id } from "@/domain/types";
import { requirePerm, type Actor } from "./access";
import type { Store } from "./db";
import { conflict } from "./errors";
import { addCommissionerAward, postAnnouncement } from "./services/content";
import { createLeague } from "./services/leagues";
import { finalizeMatchup, saveEntry } from "./services/results";
import { applyRuleChange } from "./services/rules";
import { addBowler, addTeam, addToRoster, completeSeason, createNextSeason, generatePlayoffBracket, generateSchedule } from "./services/season";

const TEAM_NAMES = ["Pin Pals", "Gutter Gang", "Strike Force", "Split Decision", "Lane Rangers", "Spare Parts"];
const BOWLERS = [
  "Alex Rivera", "Sam Chen", "Jordan Blake", "Taylor Nguyen", "Casey Morgan", "Riley Patel",
  "Jamie Okafor", "Morgan Reyes", "Quinn Larsen", "Avery Kim", "Drew Santos", "Harper Lee",
  "Logan Brooks", "Skyler Dunn", "Rowan Ellis", "Emerson Cole", "Finley Hart", "Parker Voss",
];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates a fully simulated league owned by `owner`. Everything is flagged isDemo so it can be removed in one click. */
export async function createDemoLeague(store: Store, owner: Actor): Promise<{ slug: string; leagueId: Id }> {
  const rand = rng(20260106);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const cfg2025 = normalizeConfig({
    ...DEFAULT_CONFIG,
    handicap: { ...DEFAULT_CONFIG.handicap, percentage: 80, baseValue: 210 },
    playoffs: { ...DEFAULT_CONFIG.playoffs, enabled: true, qualifiers: 4, weeks: 2 },
  });
  const { leagueId, slug, seasonId: s25 } = await createLeague(store, owner, {
    name: "Friday Night Strikers (Demo)",
    description: "Demo league with simulated bowlers and scores. Safe to explore — and to delete.",
    logoText: "FNS",
    accent: "#38bdf8",
    visibility: "private",
    season: { name: "2025 Season", year: 2025, startDate: "2025-01-10", regularWeeks: 10 },
    config: cfg2025,
  });

  const teamIds: Id[] = [];
  for (const n of TEAM_NAMES) teamIds.push(await addTeam(store, owner, leagueId, { name: n }));
  const skill = new Map<Id, number>();
  const bowlerIds: Id[] = [];
  for (const [i, name] of BOWLERS.entries()) {
    const id = await addBowler(store, owner, leagueId, { name });
    bowlerIds.push(id);
    const s = 140 + Math.round(rand() * 70);
    skill.set(id, s);
    await addToRoster(store, owner, leagueId, s25, { bowlerId: id, teamId: teamIds[Math.floor(i / 3)], enteringAverage: Math.max(110, s - 6 + Math.round(gauss() * 4)) });
  }

  const playSeason = async (seasonId: Id, weeks: number[], opts: { lastDraft?: boolean } = {}) => {
    for (const week of weeks) {
      const matchups = await store.read((db) => db.matchups.filter((m) => m.seasonId === seasonId && m.weekNumber === week && m.sideB).map((m) => structuredClone(m)), { leagueId });
      for (const [idx, m] of matchups.entries()) {
        const draftOnly = opts.lastDraft && week === weeks[weeks.length - 1];
        const scores = (["A", "B"] as const).flatMap((side) =>
          (side === "A" ? m.lineupA : m.lineupB).flatMap((bowlerId) => {
            const base = skill.get(bowlerId) ?? 160;
            const trend = ((bowlerIds.indexOf(bowlerId) * 7) % 5 - 2) * week * 0.6;
            const absent = rand() < 0.02;
            return Array.from({ length: 3 }, (_, g) => {
              if (absent) return { bowlerId, side, game: g + 1, scratch: null, kind: "absent" as const };
              const spike = rand() < 0.03 ? 30 + rand() * 25 : 0;
              const scratch = Math.max(85, Math.min(289, Math.round(base + trend + gauss() * 17 + spike)));
              return { bowlerId, side, game: g + 1, scratch, kind: "bowled" as const };
            });
          })
        );
        // Leave the draft week incomplete: the final matchup is missing its last game.
        const trimmed = draftOnly && idx === matchups.length - 1 ? scores.filter((s) => !(s.game === 3 && s.side === "B")) : scores;
        const res = await saveEntry(store, owner, leagueId, { matchupId: m.id, expectedRevision: m.revision, lineupA: m.lineupA, lineupB: m.lineupB, scores: trimmed });
        if (!draftOnly) await finalizeMatchup(store, owner, leagueId, m.id, res.revision);
      }
    }
  };

  await generateSchedule(store, owner, leagueId, s25);
  await playSeason(s25, Array.from({ length: 10 }, (_, i) => i + 1));
  await generatePlayoffBracket(store, owner, leagueId, s25);
  await playSeason(s25, [11]);
  await playSeason(s25, [12]);
  await completeSeason(store, owner, leagueId, s25);

  // 2026: copy rules and roster from 2025, then adopt this year's rules before any score exists.
  const next = await createNextSeason(store, owner, leagueId, { name: "2026 Season", year: 2026, startDate: "2026-01-09", regularWeeks: 10, copyFromSeasonId: s25, copyRoster: true, copySchedule: false, completePrevious: true });
  const cfg2026 = normalizeConfig({ ...cfg2025, handicap: { ...cfg2025.handicap, percentage: 90, baseValue: 220 } });
  await applyRuleChange(store, owner, leagueId, { seasonId: next.seasonId, proposed: cfg2026, scope: { type: "from_week", week: 1 }, reason: "Moving to 90% of 220 for 2026" });
  await generateSchedule(store, owner, leagueId, next.seasonId);
  await playSeason(next.seasonId, [1, 2, 3, 4, 5, 6]);
  await playSeason(next.seasonId, [7], { lastDraft: true });

  await postAnnouncement(store, owner, leagueId, { title: "Welcome to the demo league", body: "Everything here is simulated. Open a week, a matchup or a bowler profile to see how results are calculated, then remove the demo data from Commissioner → Seasons when you're ready to build your own league.", category: "general", pinned: true });
  await postAnnouncement(store, owner, leagueId, { title: "Week 7 bowling is this Friday", body: "Lanes 5–10 at 7:00pm. Playoffs begin after week 10 — the top four teams qualify.", category: "dates", pinned: false });
  const best = await store.read((db) => db.bowlers.find((b) => b.leagueId === leagueId && b.name === "Casey Morgan")!.id, { leagueId });
  await addCommissionerAward(store, owner, leagueId, { seasonId: next.seasonId, title: "Sportsmanship Award", recipientKind: "bowler", recipientId: best, note: "Cheered on every lane, every week.", week: null });

  // Flag everything as demo so it can be removed cleanly.
  await store.transaction((db) => {
    const league = db.leagues.find((l) => l.id === leagueId)!;
    league.isDemo = true;
    const seasonIds = new Set(db.seasons.filter((s) => s.leagueId === leagueId).map((s) => s.id));
    for (const s of db.seasons) if (seasonIds.has(s.id)) s.isDemo = true;
    for (const t of db.teams) if (t.leagueId === leagueId) t.isDemo = true;
    for (const b of db.bowlers) if (b.leagueId === leagueId) b.isDemo = true;
    for (const m of db.matchups) if (seasonIds.has(m.seasonId)) m.isDemo = true;
  }, { leagueId });
  return { slug, leagueId };
}

/** Deletes a demo league and everything in it. Refuses to touch real leagues. */
export async function removeDemoLeague(store: Store, actor: Actor, leagueId: Id) {
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "demo.reset");
    if (!league.isDemo) throw conflict("This isn't a demo league, so it can't be removed this way.");
    const seasonIds = new Set(db.seasons.filter((s) => s.leagueId === leagueId).map((s) => s.id));
    const matchupIds = new Set(db.matchups.filter((m) => seasonIds.has(m.seasonId)).map((m) => m.id));
    db.scores = db.scores.filter((s) => !matchupIds.has(s.matchupId));
    db.matchups = db.matchups.filter((m) => !seasonIds.has(m.seasonId));
    db.weeks = db.weeks.filter((w) => !seasonIds.has(w.seasonId));
    db.roster = db.roster.filter((r) => !seasonIds.has(r.seasonId));
    db.seasons = db.seasons.filter((s) => s.leagueId !== leagueId);
    db.teams = db.teams.filter((t) => t.leagueId !== leagueId);
    db.bowlers = db.bowlers.filter((b) => b.leagueId !== leagueId);
    db.announcements = db.announcements.filter((a) => a.leagueId !== leagueId);
    db.commissionerAwards = db.commissionerAwards.filter((a) => a.leagueId !== leagueId);
    db.templates = db.templates.filter((t) => t.leagueId !== leagueId);
    db.invitations = db.invitations.filter((i) => i.leagueId !== leagueId);
    db.notifications = db.notifications.filter((n) => n.leagueId !== leagueId);
    db.importLog = db.importLog.filter((i) => i.leagueId !== leagueId);
    db.memberships = db.memberships.filter((m) => m.leagueId !== leagueId);
    db.audit = db.audit.filter((a) => a.leagueId !== leagueId);
    db.leagues = db.leagues.filter((l) => l.id !== leagueId);
  }, { leagueId });
}
