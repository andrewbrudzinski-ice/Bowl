import { z } from "zod";
import { championOf } from "@/domain/awards";
import { validateConfig } from "@/domain/config";
import { buildSeasonModel, defaultLineup } from "@/domain/engine";
import { firstEligibleWeek } from "@/domain/rulechange";
import { firstRoundBracket, generateRoundRobin, nextRoundPairs } from "@/domain/schedule";
import { bowlerSeasonStats } from "@/domain/stats";
import { computeStandings, playoffAdvancer } from "@/domain/standings";
import type { Bowler, Id, Matchup, RosterEntry, Team, WeekStatus } from "@/domain/types";
import { isOfficial } from "@/domain/types";
import { bowlerIn, leagueById, matchupIn, notifyMembers, requirePerm, seasonData, seasonIn, teamIn, writeAudit, type Actor } from "../access";
import type { DB, Store } from "../db";
import { conflict, invalid, notFound } from "../errors";
import { newId, now } from "../ids";
import { TEAM_COLORS, createSeasonRecords, makeWeeks } from "./leagues";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

// ---------- teams ----------

export const teamSchema = z.object({
  name: z.string().trim().min(1, "Team name is required.").max(40),
  shortName: z.string().trim().max(5).optional(),
  color: hex.optional(),
  logo: z.string().trim().max(3).optional(),
});

export function addTeam(store: Store, actor: Actor, leagueId: Id, raw: z.input<typeof teamSchema>): Id {
  const p = teamSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    if (db.teams.some((t) => t.leagueId === leagueId && t.active && t.name.toLowerCase() === p.data.name.toLowerCase()))
      throw conflict(`A team named “${p.data.name}” already exists.`);
    const n = db.teams.filter((t) => t.leagueId === leagueId).length;
    const t: Team = {
      id: newId("tm"), leagueId, name: p.data.name, shortName: (p.data.shortName || p.data.name.slice(0, 3)).toUpperCase(),
      color: p.data.color ?? TEAM_COLORS[n % TEAM_COLORS.length], logo: p.data.logo || p.data.name.slice(0, 1).toUpperCase(), active: true, isDemo: false,
    };
    db.teams.push(t);
    writeAudit(db, actor, { leagueId, action: "team.created", entityType: "team", entityId: t.id, after: t });
    return t.id;
  });
}

export function updateTeam(store: Store, actor: Actor, leagueId: Id, teamId: Id, raw: Partial<z.input<typeof teamSchema>> & { active?: boolean }) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    const t = teamIn(db, leagueId, teamId);
    const before = { ...t };
    if (raw.name !== undefined) {
      const name = raw.name.trim();
      if (!name) throw invalid("Team name is required.");
      if (db.teams.some((x) => x.leagueId === leagueId && x.id !== teamId && x.active && x.name.toLowerCase() === name.toLowerCase())) throw conflict(`A team named “${name}” already exists.`);
      t.name = name.slice(0, 40);
    }
    if (raw.shortName !== undefined) t.shortName = raw.shortName.trim().slice(0, 5).toUpperCase();
    if (raw.color !== undefined) {
      if (!hex.safeParse(raw.color).success) throw invalid("Use a hex color like #38bdf8.");
      t.color = raw.color;
    }
    if (raw.logo !== undefined) t.logo = raw.logo.trim().slice(0, 3);
    if (raw.active !== undefined) t.active = raw.active;
    writeAudit(db, actor, { leagueId, action: "team.updated", entityType: "team", entityId: teamId, before, after: t });
  });
}

// ---------- bowlers ----------

export const bowlerSchema = z.object({
  name: z.string().trim().min(1, "Bowler name is required.").max(60),
  nickname: z.string().trim().max(30).optional(),
  avatarColor: hex.optional(),
  avatarUrl: z
    .string()
    .trim()
    .max(300)
    .refine((u) => u === "" || /^https:\/\//.test(u), "Avatar links must start with https://")
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

export function addBowler(store: Store, actor: Actor, leagueId: Id, raw: z.input<typeof bowlerSchema>): Id {
  const p = bowlerSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    const n = db.bowlers.filter((b) => b.leagueId === leagueId).length;
    const b: Bowler = {
      id: newId("bw"), leagueId, name: p.data.name, nickname: p.data.nickname ?? "", avatarColor: p.data.avatarColor ?? TEAM_COLORS[(n * 5) % TEAM_COLORS.length],
      avatarUrl: p.data.avatarUrl || null, active: true, userId: null, notes: p.data.notes ?? "", isDemo: false, createdAt: now(),
    };
    db.bowlers.push(b);
    writeAudit(db, actor, { leagueId, action: "bowler.created", entityType: "bowler", entityId: b.id, after: { name: b.name } });
    return b.id;
  });
}

export function updateBowler(store: Store, actor: Actor, leagueId: Id, bowlerId: Id, raw: Partial<z.input<typeof bowlerSchema>> & { active?: boolean }) {
  store.transaction((db) => {
    const b = bowlerIn(db, leagueId, bowlerId);
    const { membership } = requirePerm(db, actor, leagueId, "profile.edit_own");
    const isOwnProfile = membership.bowlerId === bowlerId;
    const canManage = ["owner", "commissioner", "assistant"].includes(membership.role);
    if (!canManage && !(isOwnProfile && membership.role !== "viewer")) throw invalid("You can only edit your own profile.");
    const before = { ...b };
    if (raw.name !== undefined && canManage) {
      if (!raw.name.trim()) throw invalid("Bowler name is required.");
      b.name = raw.name.trim().slice(0, 60);
    }
    if (raw.nickname !== undefined) b.nickname = raw.nickname.trim().slice(0, 30);
    if (raw.avatarColor !== undefined) {
      if (!hex.safeParse(raw.avatarColor).success) throw invalid("Use a hex color.");
      b.avatarColor = raw.avatarColor;
    }
    if (raw.avatarUrl !== undefined) {
      const u = raw.avatarUrl.trim();
      if (u && !/^https:\/\//.test(u)) throw invalid("Avatar links must start with https://");
      b.avatarUrl = u || null;
    }
    if (canManage && raw.notes !== undefined) b.notes = raw.notes.slice(0, 500);
    if (canManage && raw.active !== undefined) b.active = raw.active;
    writeAudit(db, actor, { leagueId, action: raw.active === false ? "bowler.deactivated" : "bowler.updated", entityType: "bowler", entityId: bowlerId, before, after: b });
  });
}

// ---------- rosters (season-specific, with history) ----------

export function currentEntry(db: Readonly<DB>, seasonId: Id, bowlerId: Id, week: number): RosterEntry | null {
  return (
    db.roster
      .filter((r) => r.seasonId === seasonId && r.bowlerId === bowlerId && r.fromWeek <= week && (r.toWeek == null || r.toWeek >= week))
      .sort((a, b) => b.fromWeek - a.fromWeek)[0] ?? null
  );
}

function assertWeekEditable(db: DB, leagueId: Id, seasonId: Id, week: number) {
  const eligible = firstEligibleWeek(seasonData(db, leagueId, seasonId));
  if (week < eligible) throw invalid(`Week ${week} already has finalized results. Roster changes can take effect from week ${eligible} onward; history stays intact.`);
}

export function addToRoster(
  store: Store, actor: Actor, leagueId: Id, seasonId: Id,
  input: { bowlerId: Id; teamId: Id | null; enteringAverage: number | null; isSub?: boolean; fromWeek?: number }
) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    seasonIn(db, leagueId, seasonId);
    bowlerIn(db, leagueId, input.bowlerId);
    if (input.teamId) teamIn(db, leagueId, input.teamId);
    if (input.enteringAverage != null && (!Number.isFinite(input.enteringAverage) || input.enteringAverage < 0 || input.enteringAverage > 300)) throw invalid("Entering average must be between 0 and 300.");
    const from = input.fromWeek ?? 1;
    if (db.roster.some((r) => r.seasonId === seasonId && r.bowlerId === input.bowlerId && r.toWeek == null))
      throw conflict("That bowler is already on this season's roster. Use “Change team” instead.");
    if (from > 1) assertWeekEditable(db, leagueId, seasonId, from);
    const entry: RosterEntry = {
      id: newId("ro"), seasonId, bowlerId: input.bowlerId, teamId: input.teamId, enteringAverage: input.enteringAverage ?? null,
      isSub: !!input.isSub, fromWeek: from, toWeek: null,
    };
    db.roster.push(entry);
    writeAudit(db, actor, { leagueId, seasonId, action: "roster.added", entityType: "roster", entityId: entry.id, after: entry });
  });
}

/** Moves a bowler to another team effective `week`, closing the old assignment so past results keep their team. */
export function changeTeam(store: Store, actor: Actor, leagueId: Id, seasonId: Id, bowlerId: Id, teamId: Id | null, week: number) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    seasonIn(db, leagueId, seasonId);
    bowlerIn(db, leagueId, bowlerId);
    if (teamId) teamIn(db, leagueId, teamId);
    assertWeekEditable(db, leagueId, seasonId, week);
    const open = db.roster.filter((r) => r.seasonId === seasonId && r.bowlerId === bowlerId && r.toWeek == null).sort((a, b) => b.fromWeek - a.fromWeek)[0];
    if (!open) throw notFound("Roster entry");
    if (open.teamId === teamId) throw invalid("The bowler is already on that team.");
    const before = { ...open };
    if (open.fromWeek >= week) {
      open.teamId = teamId; // same-week correction: no history to preserve for weeks they never bowled for the old team
      writeAudit(db, actor, { leagueId, seasonId, action: "roster.team_changed", entityType: "roster", entityId: open.id, before, after: open });
      return;
    }
    open.toWeek = week - 1;
    const next: RosterEntry = { id: newId("ro"), seasonId, bowlerId, teamId, enteringAverage: open.enteringAverage, isSub: open.isSub, fromWeek: week, toWeek: null };
    db.roster.push(next);
    writeAudit(db, actor, { leagueId, seasonId, action: "roster.team_changed", entityType: "roster", entityId: next.id, before, after: next, note: `Effective week ${week}` });
    // keep future, unplayed lineups in sync
    for (const m of db.matchups.filter((x) => x.seasonId === seasonId && x.weekNumber >= week && !isOfficial(x.state) && !db.scores.some((s) => s.matchupId === x.id))) {
      const sync = (lineup: Id[], side: Id | null) => (side && teamId && side === teamId ? [...lineup, bowlerId] : lineup.filter((id) => id !== bowlerId));
      m.lineupA = sync(m.lineupA, m.sideA);
      m.lineupB = sync(m.lineupB, m.sideB);
    }
  });
}

export function setEnteringAverage(store: Store, actor: Actor, leagueId: Id, seasonId: Id, bowlerId: Id, average: number | null) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    seasonIn(db, leagueId, seasonId);
    if (average != null && (!Number.isFinite(average) || average < 0 || average > 300)) throw invalid("Entering average must be between 0 and 300.");
    const entries = db.roster.filter((r) => r.seasonId === seasonId && r.bowlerId === bowlerId);
    if (!entries.length) throw notFound("Roster entry");
    const before = entries[0].enteringAverage;
    for (const e of entries) e.enteringAverage = average;
    writeAudit(db, actor, { leagueId, seasonId, action: "roster.entering_average_changed", entityType: "roster", entityId: bowlerId, before: { average: before }, after: { average }, note: "Finalized matchups keep their locked handicap snapshots." });
  });
}

export function setSubstitute(store: Store, actor: Actor, leagueId: Id, seasonId: Id, bowlerId: Id, isSub: boolean) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    seasonIn(db, leagueId, seasonId);
    const entries = db.roster.filter((r) => r.seasonId === seasonId && r.bowlerId === bowlerId && r.toWeek == null);
    if (!entries.length) throw notFound("Roster entry");
    for (const e of entries) e.isSub = isSub;
    writeAudit(db, actor, { leagueId, seasonId, action: "roster.sub_changed", entityType: "roster", entityId: bowlerId, after: { isSub } });
  });
}

/** Removes a bowler from a season roster. Only allowed when they have no recorded scores that season. */
export function removeFromRoster(store: Store, actor: Actor, leagueId: Id, seasonId: Id, bowlerId: Id) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "roster.manage");
    seasonIn(db, leagueId, seasonId);
    const ids = new Set(db.matchups.filter((m) => m.seasonId === seasonId).map((m) => m.id));
    if (db.scores.some((s) => ids.has(s.matchupId) && s.bowlerId === bowlerId))
      throw conflict("This bowler has recorded scores this season. Deactivate them instead — their history stays intact.");
    const removed = db.roster.filter((r) => r.seasonId === seasonId && r.bowlerId === bowlerId);
    db.roster = db.roster.filter((r) => !(r.seasonId === seasonId && r.bowlerId === bowlerId));
    for (const m of db.matchups.filter((x) => x.seasonId === seasonId)) {
      m.lineupA = m.lineupA.filter((i) => i !== bowlerId);
      m.lineupB = m.lineupB.filter((i) => i !== bowlerId);
    }
    writeAudit(db, actor, { leagueId, seasonId, action: "roster.removed", entityType: "roster", entityId: bowlerId, before: removed });
  });
}

// ---------- weeks ----------

export function updateWeek(store: Store, actor: Actor, leagueId: Id, seasonId: Id, weekNumber: number, patch: { date?: string; status?: WeekStatus; label?: string }) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    seasonIn(db, leagueId, seasonId);
    const w = db.weeks.find((x) => x.seasonId === seasonId && x.number === weekNumber);
    if (!w) throw notFound("Week");
    const before = { ...w };
    if (patch.date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.date) || Number.isNaN(Date.parse(patch.date))) throw invalid("Use a date like 2026-01-13.");
      w.date = patch.date;
    }
    if (patch.status !== undefined) {
      if (!["scheduled", "in_progress", "completed", "postponed"].includes(patch.status)) throw invalid("Unknown week status.");
      w.status = patch.status;
    }
    if (patch.label !== undefined) w.label = patch.label.slice(0, 60);
    writeAudit(db, actor, { leagueId, seasonId, action: "week.rescheduled", entityType: "week", entityId: w.id, before, after: w });
    if (patch.date && patch.date !== before.date) {
      const league = leagueById(db, leagueId);
      const season = seasonIn(db, leagueId, seasonId);
      notifyMembers(db, { leagueId, type: "schedule", title: `Week ${weekNumber} rescheduled`, body: `Now ${patch.date} (was ${before.date}).`, href: `/l/${league.slug}/season/${season.slug}/week/${weekNumber}`, dedupeKey: `resched:${w.id}:${patch.date}`, exceptUserId: actor.id });
    } else if (patch.status === "postponed" && before.status !== "postponed") {
      const league = leagueById(db, leagueId);
      const season = seasonIn(db, leagueId, seasonId);
      notifyMembers(db, { leagueId, type: "schedule", title: `Week ${weekNumber} postponed`, body: "Watch for a new date.", href: `/l/${league.slug}/season/${season.slug}/week/${weekNumber}`, dedupeKey: `postponed:${w.id}`, exceptUserId: actor.id });
    }
  });
}

/** Keeps the number of playoff weeks aligned with the current rules. Never deletes weeks that hold matchups. */
export function syncPlayoffWeeks(db: DB, seasonId: Id) {
  const season = db.seasons.find((s) => s.id === seasonId)!;
  const latest = season.ruleVersions[season.ruleVersions.length - 1].config;
  const want = latest.playoffs.enabled ? latest.playoffs.weeks : 0;
  const have = db.weeks.filter((w) => w.seasonId === seasonId && w.phase === "playoff");
  if (have.length < want) {
    const created = makeWeeks(seasonId, season.startDate, season.regularWeeks, want).filter((w) => w.phase === "playoff" && !have.some((h) => h.number === w.number));
    db.weeks.push(...created);
  } else if (have.length > want) {
    for (const w of have.filter((h) => h.number > season.regularWeeks + want)) {
      if (!db.matchups.some((m) => m.seasonId === seasonId && m.weekNumber === w.number)) db.weeks = db.weeks.filter((x) => x.id !== w.id);
    }
  }
}

// ---------- matchups & schedule ----------

function blankMatchup(seasonId: Id, week: number, kind: Matchup["kind"], a: Id, b: Id | null, actor: Actor): Matchup {
  return {
    id: newId("mu"), seasonId, weekNumber: week, kind, sideA: a, sideB: b, lineupA: [], lineupB: [],
    state: b == null ? "finalized" : "scheduled", forfeitBy: null, ruleVersion: null, handicapSnapshot: null, playoffRound: null, notes: "",
    revision: 1, finalizedAt: b == null ? now() : null, finalizedBy: b == null ? actor.id : null, updatedAt: now(), updatedBy: actor.id, isDemo: false,
  };
}

function fillLineups(db: DB, leagueId: Id, m: Matchup) {
  if (m.kind !== "team") return;
  const data = seasonData(db, leagueId, m.seasonId);
  const size = data.season.ruleVersions[data.season.ruleVersions.length - 1].config.bowlersPerTeam;
  m.lineupA = defaultLineup(data, m.sideA, m.weekNumber, size);
  m.lineupB = m.sideB ? defaultLineup(data, m.sideB, m.weekNumber, size) : [];
}

export function createMatchup(store: Store, actor: Actor, leagueId: Id, seasonId: Id, input: { week: number; sideA: Id; sideB: Id | null }): Id {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const season = seasonIn(db, leagueId, seasonId);
    const format = season.ruleVersions[season.ruleVersions.length - 1].config.format;
    const kind: Matchup["kind"] = format === "individual" ? "individual" : "team";
    if (!db.weeks.some((w) => w.seasonId === seasonId && w.number === input.week)) throw invalid(`Week ${input.week} doesn't exist in this season.`);
    if (kind === "team") {
      teamIn(db, leagueId, input.sideA);
      if (input.sideB) teamIn(db, leagueId, input.sideB);
    } else {
      bowlerIn(db, leagueId, input.sideA);
      if (input.sideB) bowlerIn(db, leagueId, input.sideB);
    }
    if (input.sideB && input.sideA === input.sideB) throw invalid("A participant can't play itself.");
    const clash = db.matchups.find((m) => m.seasonId === seasonId && m.weekNumber === input.week && [m.sideA, m.sideB].some((s) => s && (s === input.sideA || s === input.sideB)));
    if (clash) throw conflict(`One of those participants already has a matchup in week ${input.week}.`);
    const m = blankMatchup(seasonId, input.week, kind, input.sideA, input.sideB, actor);
    if (kind === "individual") {
      m.lineupA = [input.sideA];
      m.lineupB = input.sideB ? [input.sideB] : [];
    } else fillLineups(db, leagueId, m);
    db.matchups.push(m);
    writeAudit(db, actor, { leagueId, seasonId, action: "matchup.created", entityType: "matchup", entityId: m.id, after: { week: m.weekNumber, sideA: m.sideA, sideB: m.sideB } });
    return m.id;
  });
}

export function deleteMatchup(store: Store, actor: Actor, leagueId: Id, matchupId: Id) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const { matchup } = matchupIn(db, leagueId, matchupId);
    if (isOfficial(matchup.state) && matchup.sideB) throw conflict("This matchup is finalized. Reopen it before removing it.");
    if (db.scores.some((s) => s.matchupId === matchupId)) throw conflict("This matchup has scores. Clear them or reopen the result first.");
    db.matchups = db.matchups.filter((m) => m.id !== matchupId);
    writeAudit(db, actor, { leagueId, seasonId: matchup.seasonId, action: "matchup.deleted", entityType: "matchup", entityId: matchupId, before: { week: matchup.weekNumber, sideA: matchup.sideA, sideB: matchup.sideB } });
  });
}

/** Moves an unplayed matchup to another week (history of the old slot is kept in the audit log). */
export function moveMatchup(store: Store, actor: Actor, leagueId: Id, matchupId: Id, toWeek: number) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const { matchup, season } = matchupIn(db, leagueId, matchupId);
    if (isOfficial(matchup.state) && matchup.sideB) throw conflict("This matchup is finalized. Reopen it before moving it.");
    if (!db.weeks.some((w) => w.seasonId === season.id && w.number === toWeek)) throw invalid(`Week ${toWeek} doesn't exist in this season.`);
    const clash = db.matchups.find((m) => m.id !== matchupId && m.seasonId === season.id && m.weekNumber === toWeek && [m.sideA, m.sideB].some((s) => s && [matchup.sideA, matchup.sideB].includes(s)));
    if (clash) throw conflict(`A participant already has a matchup in week ${toWeek}.`);
    const before = matchup.weekNumber;
    matchup.weekNumber = toWeek;
    matchup.revision++;
    writeAudit(db, actor, { leagueId, seasonId: season.id, action: "matchup.rescheduled", entityType: "matchup", entityId: matchupId, before: { week: before }, after: { week: toWeek } });
    const league = leagueById(db, leagueId);
    notifyMembers(db, { leagueId, type: "schedule", title: "A matchup was rescheduled", body: `Moved from week ${before} to week ${toWeek}.`, href: `/l/${league.slug}/matchup/${matchupId}`, dedupeKey: `move:${matchupId}:${toWeek}`, exceptUserId: actor.id });
  });
}

export interface GenerateScheduleOptions {
  fromWeek?: number;
  participants?: Id[];
}

export function participantsForSchedule(db: Readonly<DB>, leagueId: Id, seasonId: Id): { kind: "team" | "individual"; ids: Id[] } {
  const season = seasonIn(db, leagueId, seasonId);
  const cfg = season.ruleVersions[season.ruleVersions.length - 1].config;
  const roster = db.roster.filter((r) => r.seasonId === seasonId && !r.isSub);
  if (cfg.format === "individual") {
    return { kind: "individual", ids: [...new Set(roster.filter((r) => db.bowlers.find((b) => b.id === r.bowlerId)?.active).map((r) => r.bowlerId))] };
  }
  const teamIds = [...new Set(roster.map((r) => r.teamId).filter((t): t is Id => !!t))];
  return { kind: "team", ids: teamIds.filter((t) => db.teams.find((x) => x.id === t)?.active) };
}

export function previewSchedule(store: Store, actor: Actor, leagueId: Id, seasonId: Id, opts: GenerateScheduleOptions = {}) {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const season = seasonIn(db, leagueId, seasonId);
    const eligible = firstEligibleWeek(seasonData(db, leagueId, seasonId));
    const from = Math.max(opts.fromWeek ?? 1, eligible);
    const parts = opts.participants ?? participantsForSchedule(db, leagueId, seasonId).ids;
    const weekCount = season.regularWeeks - from + 1;
    const sched = generateRoundRobin(parts, weekCount, { startWeek: from });
    const warnings = [...sched.warnings];
    if (parts.length < 2) warnings.push("At least two participants with active roster entries are required.");
    return { from, participants: parts, schedule: sched, warnings };
  });
}

/** Replaces unplayed regular-season matchups from `fromWeek` with a freshly generated round robin. */
export function generateSchedule(store: Store, actor: Actor, leagueId: Id, seasonId: Id, opts: GenerateScheduleOptions = {}): { created: number; warnings: string[] } {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const season = seasonIn(db, leagueId, seasonId);
    const { kind, ids } = participantsForSchedule(db, leagueId, seasonId);
    const parts = opts.participants ?? ids;
    const eligible = firstEligibleWeek(seasonData(db, leagueId, seasonId));
    const from = Math.max(opts.fromWeek ?? 1, eligible);
    const touched = db.matchups.filter((m) => m.seasonId === seasonId && m.weekNumber >= from && m.weekNumber <= season.regularWeeks);
    const blocking = touched.filter((m) => m.state !== "scheduled" || db.scores.some((s) => s.matchupId === m.id));
    if (blocking.length) throw conflict(`Weeks from ${from} already have scores or drafts. Choose a later start week or clear those results first.`);
    if (parts.length < 2) throw invalid("At least two participants with active roster entries are needed to build a schedule.");
    const weekCount = season.regularWeeks - from + 1;
    if (weekCount < 1) throw invalid("There are no regular-season weeks left to schedule.");
    const sched = generateRoundRobin(parts, weekCount, { startWeek: from });
    const removed = touched.length;
    db.matchups = db.matchups.filter((m) => !touched.includes(m));
    let created = 0;
    for (const w of sched.weeks) {
      for (const p of w.pairs) {
        const m = blankMatchup(seasonId, w.week, kind, p.a, p.b, actor);
        if (kind === "individual") {
          m.lineupA = [p.a];
          m.lineupB = p.b ? [p.b] : [];
        } else fillLineups(db, leagueId, m);
        db.matchups.push(m);
        created++;
      }
    }
    const publications = db.audit.filter((a) => a.leagueId === leagueId && a.seasonId === seasonId && a.action === "schedule.generated").length;
    writeAudit(db, actor, { leagueId, seasonId, action: "schedule.generated", entityType: "season", entityId: seasonId, before: { replacedUnplayed: removed }, after: { created, fromWeek: from, participants: parts.length }, note: sched.warnings.join(" ") });
    const league = leagueById(db, leagueId);
    notifyMembers(db, { leagueId, type: "schedule", title: "New schedule published", body: `${season.name}: weeks ${from}–${season.regularWeeks}.`, href: `/l/${league.slug}/schedule`, dedupeKey: `schedule:${seasonId}:${publications + 1}`, exceptUserId: actor.id });
    return { created, warnings: sched.warnings };
  });
}

// ---------- playoffs ----------

export function generatePlayoffBracket(store: Store, actor: Actor, leagueId: Id, seasonId: Id, opts: { force?: boolean } = {}): { created: number } {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "schedule.manage");
    const season = seasonIn(db, leagueId, seasonId);
    const cfg = season.ruleVersions[season.ruleVersions.length - 1].config;
    if (!cfg.playoffs.enabled) throw invalid("Playoffs are not enabled in this season's rules.");
    const data = seasonData(db, leagueId, seasonId);
    const model = buildSeasonModel(data);
    const regular = model.results.filter((r) => (model.weekByNumber.get(r.weekNumber)?.phase ?? "regular") === "regular" && !r.isBye);
    if (regular.some((r) => !r.official) && !opts.force) throw conflict("Regular-season matchups are still unfinalized. Finalize them first, or confirm to seed from the current standings.");
    const firstPlayoff = season.regularWeeks + 1;
    if (db.matchups.some((m) => m.seasonId === seasonId && m.weekNumber >= firstPlayoff)) throw conflict("Playoff matchups already exist.");
    const scope = cfg.format === "individual" ? "bowler" : "team";
    const { rows } = computeStandings(model, { scope });
    const seeds = rows.slice(0, cfg.playoffs.qualifiers).map((r) => r.id);
    if (seeds.length < 2) throw invalid("Not enough qualified participants to build a bracket.");
    const kind: Matchup["kind"] = scope === "team" ? "team" : "individual";
    const pairs = firstRoundBracket(seeds);
    for (const p of pairs) {
      const m = blankMatchup(seasonId, firstPlayoff, kind, p.a, p.b, actor);
      m.playoffRound = 1;
      if (kind === "individual") {
        m.lineupA = [p.a];
        m.lineupB = p.b ? [p.b] : [];
      } else fillLineups(db, leagueId, m);
      db.matchups.push(m);
    }
    writeAudit(db, actor, { leagueId, seasonId, action: "playoffs.bracket_generated", entityType: "season", entityId: seasonId, after: { seeds } });
    const league = leagueById(db, leagueId);
    notifyMembers(db, { leagueId, type: "playoffs", title: "Playoff bracket set", body: `${seeds.length} ${scope === "team" ? "teams" : "bowlers"} qualified.`, href: `/l/${league.slug}/schedule`, dedupeKey: `playoffs:${seasonId}:bracket` });
    return { created: pairs.length };
  });
}

/** Called after finalizing a playoff matchup: builds the next round (or crowns the champion) when a round is complete. */
export function advancePlayoffs(db: DB, leagueId: Id, seasonId: Id, actor: Actor) {
  const season = db.seasons.find((s) => s.id === seasonId)!;
  const data = seasonData(db, leagueId, seasonId);
  const model = buildSeasonModel(data);
  const cfg = season.ruleVersions[season.ruleVersions.length - 1].config;
  if (!cfg.playoffs.enabled) return;
  const playoff = model.results.filter((r) => model.weekByNumber.get(r.weekNumber)?.phase === "playoff");
  if (!playoff.length) return;
  const lastWeek = Math.max(...playoff.map((r) => r.weekNumber));
  const round = playoff.filter((r) => r.weekNumber === lastWeek);
  if (!round.every((r) => r.official)) return;
  const survivors: Id[] = [];
  for (const r of round) {
    const side = playoffAdvancer(r, cfg);
    if (!side) return;
    survivors.push(side === "A" ? r.a.participantId : r.b!.participantId);
  }
  const league = leagueById(db, leagueId);
  if (survivors.length === 1) {
    if (season.championId !== survivors[0]) {
      season.championId = survivors[0];
      const name = cfg.format === "individual" ? db.bowlers.find((b) => b.id === survivors[0])?.name : db.teams.find((t) => t.id === survivors[0])?.name;
      writeAudit(db, actor, { leagueId, seasonId, action: "season.champion_decided", entityType: "season", entityId: seasonId, after: { championId: survivors[0] } });
      notifyMembers(db, { leagueId, type: "playoffs", title: `${name ?? "A champion"} wins the ${season.name} title`, body: "The playoff final is complete.", href: `/l/${league.slug}/history/${season.slug}`, dedupeKey: `champion:${seasonId}` });
    }
    return;
  }
  const nextWeek = lastWeek + 1;
  if (!model.weekByNumber.has(nextWeek)) return;
  if (db.matchups.some((m) => m.seasonId === seasonId && m.weekNumber === nextWeek)) return;
  const kind: Matchup["kind"] = cfg.format === "individual" ? "individual" : "team";
  const maxRound = Math.max(...round.map((r) => r.matchup.playoffRound ?? 1));
  for (const p of nextRoundPairs(survivors)) {
    const m = blankMatchup(seasonId, nextWeek, kind, p.a, p.b, actor);
    m.playoffRound = maxRound + 1;
    if (kind === "individual") {
      m.lineupA = [p.a];
      m.lineupB = p.b ? [p.b] : [];
    } else fillLineups(db, leagueId, m);
    db.matchups.push(m);
  }
  notifyMembers(db, { leagueId, type: "playoffs", title: "Next playoff round is set", body: `Week ${nextWeek} matchups are posted.`, href: `/l/${league.slug}/season/${season.slug}/week/${nextWeek}`, dedupeKey: `playoffs:${seasonId}:round:${maxRound + 1}` });
}

// ---------- seasons ----------

export const newSeasonSchema = z.object({
  name: z.string().trim().min(1).max(60),
  year: z.number().int().min(1990).max(2100),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  regularWeeks: z.number().int().min(1).max(60),
  copyFromSeasonId: z.string().nullable().default(null),
  copyRoster: z.boolean().default(true),
  copySchedule: z.boolean().default(false),
  completePrevious: z.boolean().default(true),
});

export function createNextSeason(store: Store, actor: Actor, leagueId: Id, raw: z.input<typeof newSeasonSchema>): { seasonId: Id; slug: string } {
  const p = newSeasonSchema.safeParse(raw);
  if (!p.success) throw invalid(p.error.issues[0].message);
  const input = p.data;
  return store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "season.manage");
    const src = input.copyFromSeasonId ? seasonIn(db, leagueId, input.copyFromSeasonId) : null;
    // The new season gets its own *copy* of the rules; later changes to either side never touch the other.
    const cfg = structuredClone(src ? src.ruleVersions[src.ruleVersions.length - 1].config : league.defaultConfig);
    const check = validateConfig(cfg);
    if (!check.ok) throw invalid("The copied rules are no longer valid: " + check.issues[0].message);
    const season = createSeasonRecords(db, actor, league, { name: input.name, year: input.year, startDate: input.startDate, regularWeeks: input.regularWeeks, config: cfg, reason: src ? `Copied from ${src.name}` : "Initial rules" });
    if (src) {
      if (input.completePrevious && src.status !== "completed") {
        src.status = "completed";
        const champ = championOf(buildSeasonModel(seasonData(db, leagueId, src.id)));
        if (champ && !src.championId) src.championId = champ.id;
      }
      if (input.copyRoster) {
        const srcData = seasonData(db, leagueId, src.id);
        const srcModel = buildSeasonModel(srcData);
        const stats = bowlerSeasonStats(srcModel);
        const latest = new Map<Id, RosterEntry>();
        for (const r of srcData.roster.sort((a, b) => a.fromWeek - b.fromWeek)) latest.set(r.bowlerId, r);
        for (const [bowlerId, r] of latest) {
          const b = db.bowlers.find((x) => x.id === bowlerId);
          if (!b || !b.active || r.isSub) continue;
          const st = stats.find((s) => s.bowlerId === bowlerId);
          const avg = st && st.games >= cfg.handicap.establishAfterGames && st.average != null ? Math.floor(st.average) : r.enteringAverage;
          db.roster.push({ id: newId("ro"), seasonId: season.id, bowlerId, teamId: r.teamId, enteringAverage: avg ?? null, isSub: false, fromWeek: 1, toWeek: null });
        }
      }
      if (input.copySchedule) {
        const weeksSrc = db.weeks.filter((w) => w.seasonId === src.id && w.phase === "regular");
        for (const m of db.matchups.filter((x) => x.seasonId === src.id && x.weekNumber <= Math.min(src.regularWeeks, input.regularWeeks))) {
          if (!weeksSrc.some((w) => w.number === m.weekNumber)) continue;
          const copy = blankMatchup(season.id, m.weekNumber, m.kind, m.sideA, m.sideB, actor);
          if (m.kind === "individual") {
            copy.lineupA = [m.sideA];
            copy.lineupB = m.sideB ? [m.sideB] : [];
          } else fillLineups(db, leagueId, copy);
          db.matchups.push(copy);
        }
      }
    }
    writeAudit(db, actor, { leagueId, seasonId: season.id, action: "season.created", entityType: "season", entityId: season.id, after: { name: season.name, copiedFrom: src?.id ?? null, copyRoster: input.copyRoster, copySchedule: input.copySchedule } });
    return { seasonId: season.id, slug: season.slug };
  });
}

export function completeSeason(store: Store, actor: Actor, leagueId: Id, seasonId: Id) {
  store.transaction((db) => {
    requirePerm(db, actor, leagueId, "season.manage");
    const season = seasonIn(db, leagueId, seasonId);
    const model = buildSeasonModel(seasonData(db, leagueId, seasonId));
    const unfinished = model.results.filter((r) => !r.official).length;
    season.status = "completed";
    const champ = championOf(model);
    if (champ && !season.championId) season.championId = champ.id;
    writeAudit(db, actor, { leagueId, seasonId, action: "season.completed", entityType: "season", entityId: seasonId, after: { unfinishedMatchups: unfinished, championId: season.championId } });
  });
}

