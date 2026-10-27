import { z } from "zod";
import { get, toCsv, toTable } from "@/domain/csv";
import { buildSeasonModel, defaultLineup } from "@/domain/engine";
import type { Bowler, Id, Matchup, RosterEntry, Side, Team } from "@/domain/types";
import { isOfficial } from "@/domain/types";
import { requirePerm, seasonData, seasonIn, writeAudit, type Actor } from "../access";
import type { DB, Store } from "../db";
import { AppError, invalid } from "../errors";
import { newId, newToken, now, uniqueSlug } from "../ids";
import { TEAM_COLORS } from "./leagues";
import { applyEntry, finalizeInDb } from "./results";

export type ImportKind = "bowlers" | "teams" | "rosters" | "schedule" | "scores";
export const IMPORT_KINDS: ImportKind[] = ["bowlers", "teams", "rosters", "schedule", "scores"];

export const IMPORT_TEMPLATES: Record<ImportKind, { headers: string[]; required: string[]; example: string[][]; needsSeason: boolean; description: string }> = {
  bowlers: { required: ["name"], headers: ["name", "nickname", "active"], example: [["Alex Rivera", "Alex", "true"], ["Sam Chen", "", "true"]], needsSeason: false, description: "People in your league. Existing names are skipped as duplicates." },
  teams: { required: ["name"], headers: ["name", "short_name", "color", "logo"], example: [["Pin Pals", "PIN", "#38bdf8", "P"], ["Gutter Gang", "GUT", "#f97316", "G"]], needsSeason: false, description: "Teams in your league. Existing team names are skipped." },
  rosters: { required: ["bowler", "team"], headers: ["bowler", "team", "entering_average", "is_sub", "from_week"], example: [["Alex Rivera", "Pin Pals", "172", "false", "1"], ["Sam Chen", "Gutter Gang", "", "false", "1"]], needsSeason: true, description: "Season roster: who bowls for which team, with entering averages. Bowlers and teams must already exist." },
  schedule: { required: ["week", "team_a", "team_b"], headers: ["week", "date", "team_a", "team_b"], example: [["1", "2026-01-06", "Pin Pals", "Gutter Gang"], ["2", "2026-01-13", "Pin Pals", ""]], needsSeason: true, description: "Weekly pairings (team or bowler names, matching the league format). Leave team_b blank for a bye." },
  scores: { required: ["week", "team", "bowler", "game", "score"], headers: ["week", "team", "bowler", "game", "score", "kind"], example: [["1", "Pin Pals", "Alex Rivera", "1", "180", "bowled"], ["1", "Pin Pals", "Alex Rivera", "2", "195", "bowled"]], needsSeason: true, description: "Scratch scores per bowler per game. `team` is the team (or bowler, for individual leagues) whose scheduled matchup this belongs to. kind is bowled or absent." },
};

export function templateCsv(kind: ImportKind): string {
  const t = IMPORT_TEMPLATES[kind];
  return toCsv(t.headers, t.example);
}

export interface ImportMessage {
  line: number;
  message: string;
}
export interface ImportReport {
  kind: ImportKind;
  rows: number;
  errors: ImportMessage[];
  warnings: ImportMessage[];
  duplicates: ImportMessage[];
  preview: Record<string, string>[];
  willCreate: number;
  willSkip: number;
  ok: boolean;
}

export interface ImportOptions {
  /** scores only: also finalize each matchup (historical results). */
  finalize?: boolean;
}

const truthy = (s: string) => ["true", "yes", "y", "1"].includes(s.trim().toLowerCase());
const lc = (s: string) => s.trim().toLowerCase();
const MAX_ROWS = 5000;

/** Runs an import against `db` (mutating it). Callers either discard the db (preview) or keep it (commit). */
function runImport(db: DB, actor: Actor, leagueId: Id, seasonId: Id | null, kind: ImportKind, text: string, opts: ImportOptions): ImportReport {
  const tpl = IMPORT_TEMPLATES[kind];
  const report: ImportReport = { kind, rows: 0, errors: [], warnings: [], duplicates: [], preview: [], willCreate: 0, willSkip: 0, ok: false };
  const err = (line: number, message: string) => report.errors.push({ line, message });
  const dup = (line: number, message: string) => report.duplicates.push({ line, message });
  const { table, error } = toTable(text, tpl.required);
  if (!table) {
    err(1, error ?? "Could not read the file.");
    return report;
  }
  if (table.rows.length > MAX_ROWS) {
    err(1, `Files are limited to ${MAX_ROWS} rows; split this one up.`);
    return report;
  }
  report.rows = table.rows.length;
  report.preview = table.rows.slice(0, 8).map((r) => r.values);
  if (!table.rows.length) {
    err(1, "The file has a header but no data rows.");
    return report;
  }
  if (tpl.needsSeason && !seasonId) {
    err(1, "Choose a season for this import.");
    return report;
  }
  const season = seasonId ? seasonIn(db, leagueId, seasonId) : null;
  const league = db.leagues.find((l) => l.id === leagueId)!;
  const cfg = season ? season.ruleVersions[season.ruleVersions.length - 1].config : league.defaultConfig;

  if (kind === "bowlers") {
    const names = new Set(db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => lc(b.name)));
    const seen = new Set<string>();
    for (const r of table.rows) {
      const name = get(r, "name");
      if (!name) { err(r.line, "name is required."); continue; }
      if (name.length > 60) { err(r.line, "name is longer than 60 characters."); continue; }
      if (seen.has(lc(name))) { err(r.line, `“${name}” appears more than once in this file.`); continue; }
      seen.add(lc(name));
      if (names.has(lc(name))) { dup(r.line, `“${name}” already exists — will be skipped.`); report.willSkip++; continue; }
      const b: Bowler = { id: newId("bw"), leagueId, name, nickname: get(r, "nickname").slice(0, 30), avatarColor: TEAM_COLORS[(db.bowlers.length * 5) % TEAM_COLORS.length], avatarUrl: null, active: get(r, "active") === "" ? true : truthy(get(r, "active")), userId: null, notes: "", isDemo: false, createdAt: now() };
      db.bowlers.push(b);
      report.willCreate++;
    }
  } else if (kind === "teams") {
    const names = new Set(db.teams.filter((t) => t.leagueId === leagueId && t.active).map((t) => lc(t.name)));
    const seen = new Set<string>();
    for (const r of table.rows) {
      const name = get(r, "name");
      if (!name) { err(r.line, "name is required."); continue; }
      if (seen.has(lc(name))) { err(r.line, `“${name}” appears more than once in this file.`); continue; }
      seen.add(lc(name));
      if (names.has(lc(name))) { dup(r.line, `Team “${name}” already exists — will be skipped.`); report.willSkip++; continue; }
      const color = get(r, "color");
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) { err(r.line, `color “${color}” isn't a hex color like #38bdf8.`); continue; }
      const t: Team = { id: newId("tm"), leagueId, name: name.slice(0, 40), shortName: (get(r, "short_name") || name.slice(0, 3)).slice(0, 5).toUpperCase(), color: color || TEAM_COLORS[db.teams.length % TEAM_COLORS.length], logo: (get(r, "logo") || name.slice(0, 1)).slice(0, 3), active: true, isDemo: false };
      db.teams.push(t);
      report.willCreate++;
    }
  } else if (kind === "rosters") {
    const bowlerBy = new Map(db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => [lc(b.name), b]));
    const teamBy = new Map(db.teams.filter((t) => t.leagueId === leagueId && t.active).map((t) => [lc(t.name), t]));
    const seen = new Set<string>();
    for (const r of table.rows) {
      const bn = get(r, "bowler");
      const b = bowlerBy.get(lc(bn));
      if (!b) { err(r.line, `Unknown bowler “${bn}”. Import or add bowlers first.`); continue; }
      if (seen.has(b.id)) { err(r.line, `“${bn}” appears more than once in this file.`); continue; }
      seen.add(b.id);
      const tn = get(r, "team");
      const t = tn ? teamBy.get(lc(tn)) : null;
      if (tn && !t) { err(r.line, `Unknown team “${tn}”. Import or add teams first.`); continue; }
      const avgRaw = get(r, "entering_average");
      const avg = avgRaw === "" ? null : Number(avgRaw);
      if (avg != null && (!Number.isFinite(avg) || avg < 0 || avg > 300)) { err(r.line, `entering_average “${avgRaw}” must be a number from 0 to 300.`); continue; }
      const fromRaw = get(r, "from_week");
      const from = fromRaw === "" ? 1 : Number(fromRaw);
      if (!Number.isInteger(from) || from < 1 || from > season!.regularWeeks) { err(r.line, `from_week “${fromRaw}” must be a week in this season.`); continue; }
      if (db.roster.some((x) => x.seasonId === seasonId && x.bowlerId === b.id && x.toWeek == null)) { dup(r.line, `${b.name} is already on this season's roster — skipped.`); report.willSkip++; continue; }
      const entry: RosterEntry = { id: newId("ro"), seasonId: seasonId!, bowlerId: b.id, teamId: t?.id ?? null, enteringAverage: avg, isSub: truthy(get(r, "is_sub")), fromWeek: from, toWeek: null };
      db.roster.push(entry);
      report.willCreate++;
    }
  } else if (kind === "schedule") {
    const individual = cfg.format === "individual";
    const byName = individual
      ? new Map(db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => [lc(b.name), b.id]))
      : new Map(db.teams.filter((t) => t.leagueId === leagueId && t.active).map((t) => [lc(t.name), t.id]));
    const weekNums = new Set(db.weeks.filter((w) => w.seasonId === seasonId).map((w) => w.number));
    for (const r of table.rows) {
      const wk = Number(get(r, "week"));
      if (!Number.isInteger(wk) || !weekNums.has(wk)) { err(r.line, `week “${get(r, "week")}” isn't a week in this season (1–${Math.max(...weekNums)}).`); continue; }
      const an = get(r, "team_a");
      const bn = get(r, "team_b");
      const a = byName.get(lc(an));
      const b = bn ? byName.get(lc(bn)) : null;
      if (!a) { err(r.line, `Unknown ${individual ? "bowler" : "team"} “${an}”.`); continue; }
      if (bn && !b) { err(r.line, `Unknown ${individual ? "bowler" : "team"} “${bn}”.`); continue; }
      if (b && a === b) { err(r.line, "A participant can't play itself."); continue; }
      const existing = db.matchups.filter((m) => m.seasonId === seasonId && m.weekNumber === wk);
      const same = existing.find((m) => m.sideA === a && (m.sideB ?? null) === (b ?? null) || (b && m.sideA === b && m.sideB === a));
      if (same) { dup(r.line, `Week ${wk}: that pairing already exists — skipped.`); report.willSkip++; continue; }
      if (existing.some((m) => [m.sideA, m.sideB].some((s) => s && (s === a || s === b)))) { err(r.line, `Week ${wk}: a participant already has a matchup that week.`); continue; }
      const date = get(r, "date");
      if (date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) { err(r.line, `date “${date}” must look like 2026-01-06.`); continue; }
        const w = db.weeks.find((x) => x.seasonId === seasonId && x.number === wk)!;
        if (w.date !== date) { report.warnings.push({ line: r.line, message: `Week ${wk} date will change from ${w.date} to ${date}.` }); w.date = date; }
      }
      const m: Matchup = {
        id: newId("mu"), seasonId: seasonId!, weekNumber: wk, kind: individual ? "individual" : "team", sideA: a, sideB: b ?? null, lineupA: [], lineupB: [],
        state: b ? "scheduled" : "finalized", forfeitBy: null, ruleVersion: null, handicapSnapshot: null, playoffRound: null, notes: "", revision: 1,
        finalizedAt: b ? null : now(), finalizedBy: b ? null : actor.id, updatedAt: now(), updatedBy: actor.id, isDemo: false,
      };
      db.matchups.push(m);
      if (individual) { m.lineupA = [a]; m.lineupB = b ? [b] : []; }
      else {
        const data = seasonData(db, leagueId, seasonId!);
        m.lineupA = defaultLineup(data, a, wk, cfg.bowlersPerTeam);
        m.lineupB = b ? defaultLineup(data, b, wk, cfg.bowlersPerTeam) : [];
      }
      report.willCreate++;
    }
  } else if (kind === "scores") {
    const individual = cfg.format === "individual";
    const bowlerBy = new Map(db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => [lc(b.name), b]));
    const partBy = individual ? new Map([...bowlerBy].map(([k, v]) => [k, v.id])) : new Map(db.teams.filter((t) => t.leagueId === leagueId).map((t) => [lc(t.name), t.id]));
    type Group = { matchup: Matchup; line: number; scores: { bowlerId: Id; side: Side; game: number; scratch: number | null; kind: "bowled" | "absent" }[]; lineupA: Id[]; lineupB: Id[] };
    const groups = new Map<Id, Group>();
    const seenKey = new Set<string>();
    for (const r of table.rows) {
      const wk = Number(get(r, "week"));
      const part = partBy.get(lc(get(r, "team")));
      const bowler = bowlerBy.get(lc(get(r, "bowler")));
      const game = Number(get(r, "game"));
      const kindRaw = lc(get(r, "kind")) || "bowled";
      if (!Number.isInteger(wk)) { err(r.line, `week “${get(r, "week")}” must be a whole number.`); continue; }
      if (!part) { err(r.line, `Unknown ${individual ? "bowler" : "team"} “${get(r, "team")}”.`); continue; }
      if (!bowler) { err(r.line, `Unknown bowler “${get(r, "bowler")}”.`); continue; }
      if (!Number.isInteger(game) || game < 1) { err(r.line, `game “${get(r, "game")}” must be a whole number ≥ 1.`); continue; }
      if (kindRaw !== "bowled" && kindRaw !== "absent") { err(r.line, `kind “${kindRaw}” must be bowled or absent.`); continue; }
      const scoreRaw = get(r, "score");
      const score = scoreRaw === "" ? null : Number(scoreRaw);
      if (kindRaw === "bowled" && (score == null || !Number.isFinite(score))) { err(r.line, `score “${scoreRaw}” must be a number.`); continue; }
      const m = db.matchups.find((x) => x.seasonId === seasonId && x.weekNumber === wk && (x.sideA === part || x.sideB === part));
      if (!m) { err(r.line, `No scheduled matchup for “${get(r, "team")}” in week ${wk}. Import the schedule first.`); continue; }
      if (isOfficial(m.state)) { err(r.line, `Week ${wk}: that matchup is already finalized; imports never overwrite official results.`); continue; }
      if (db.scores.some((s) => s.matchupId === m.id)) { err(r.line, `Week ${wk}: that matchup already has scores. Imports never silently replace scores.`); continue; }
      const k = `${m.id}|${bowler.id}|${game}`;
      if (seenKey.has(k)) { err(r.line, `Duplicate score for ${bowler.name}, week ${wk}, game ${game}.`); continue; }
      seenKey.add(k);
      const side: Side = m.sideA === part ? "A" : "B";
      const g = groups.get(m.id) ?? { matchup: m, line: r.line, scores: [], lineupA: [], lineupB: [] };
      g.scores.push({ bowlerId: bowler.id, side, game, scratch: kindRaw === "absent" ? null : score, kind: kindRaw as "bowled" | "absent" });
      const lineup = side === "A" ? g.lineupA : g.lineupB;
      if (!lineup.includes(bowler.id)) lineup.push(bowler.id);
      groups.set(m.id, g);
    }
    if (!report.errors.length) {
      for (const g of groups.values()) {
        try {
          const label = `Week ${g.matchup.weekNumber}`;
          const res = applyEntry(db, actor, leagueId, {
            matchupId: g.matchup.id, expectedRevision: g.matchup.revision, lineupA: g.lineupA, lineupB: g.lineupB, scores: g.scores,
            submit: opts.finalize ? "ready" : "draft", notes: "Imported from CSV",
          }, { correction: null });
          for (const i of res.issues.filter((x) => x.severity === "warning")) report.warnings.push({ line: g.line, message: `${label}: ${i.message}` });
          if (opts.finalize) finalizeInDb(db, actor, leagueId, g.matchup.id, res.revision);
          report.willCreate++;
        } catch (e) {
          if (e instanceof AppError) err(g.line, `Week ${g.matchup.weekNumber}: ${e.message}`);
          else throw e;
        }
      }
    }
  }
  report.ok = report.errors.length === 0;
  return report;
}

export function previewImport(store: Store, actor: Actor, leagueId: Id, seasonId: Id | null, kind: ImportKind, text: string, opts: ImportOptions = {}): ImportReport {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "data.import");
    const clone = structuredClone(db) as DB;
    return runImport(clone, actor, leagueId, seasonId, kind, text, opts);
  });
}

/** All-or-nothing: if any row fails, the transaction is discarded and nothing is written. */
export function commitImport(store: Store, actor: Actor, leagueId: Id, seasonId: Id | null, kind: ImportKind, text: string, confirm: boolean, opts: ImportOptions = {}): ImportReport {
  if (!confirm) throw invalid("Confirm the import before writing data.");
  try {
    return store.transaction((db) => {
      requirePerm(db, actor, leagueId, "data.import");
      const report = runImport(db, actor, leagueId, seasonId, kind, text, opts);
      if (!report.ok) throw new AppError("validation", `Import blocked: ${report.errors.length} problem${report.errors.length === 1 ? "" : "s"} found. Nothing was imported.`, report);
      db.importLog.push({ id: newId("im"), leagueId, at: now(), userId: actor.id, kind, ok: true, rows: report.rows, errors: [] });
      writeAudit(db, actor, { leagueId, seasonId, action: "data.imported", entityType: "import", entityId: kind, after: { rows: report.rows, created: report.willCreate, skipped: report.willSkip, finalized: !!opts.finalize } });
      return report;
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "validation" && e.details && typeof e.details === "object" && "errors" in (e.details as object)) {
      const rep = e.details as ImportReport;
      store.transaction((db) => {
        db.importLog.push({ id: newId("im"), leagueId, at: now(), userId: actor.id, kind, ok: false, rows: rep.rows, errors: rep.errors.slice(0, 10).map((x) => `Line ${x.line}: ${x.message}`) });
      });
    }
    throw e;
  }
}

// ---------------- exports ----------------

export type ExportKind = ImportKind | "results" | "all-scores";

export function exportCsv(store: Store, actor: Actor, leagueId: Id, seasonId: Id | null, kind: ExportKind): { filename: string; csv: string } {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "data.export");
    const league = db.leagues.find((l) => l.id === leagueId)!;
    const base = league.slug;
    if (kind === "bowlers") {
      return { filename: `${base}-bowlers.csv`, csv: toCsv(["name", "nickname", "active"], db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => [b.name, b.nickname, b.active])) };
    }
    if (kind === "teams") {
      return { filename: `${base}-teams.csv`, csv: toCsv(["name", "short_name", "color", "logo", "active"], db.teams.filter((t) => t.leagueId === leagueId).map((t) => [t.name, t.shortName, t.color, t.logo, t.active])) };
    }
    if (!seasonId) throw invalid("Choose a season to export.");
    const season = seasonIn(db, leagueId, seasonId);
    const data = seasonData(db, leagueId, seasonId);
    const model = buildSeasonModel(data);
    const tn = (id: Id | null) => (id ? (data.teams.find((t) => t.id === id)?.name ?? data.bowlers.find((b) => b.id === id)?.name ?? "") : "");
    const bn = (id: Id) => data.bowlers.find((b) => b.id === id)?.name ?? "";
    if (kind === "rosters") {
      return { filename: `${base}-${season.slug}-rosters.csv`, csv: toCsv(["bowler", "team", "entering_average", "is_sub", "from_week", "to_week"], data.roster.map((r) => [bn(r.bowlerId), tn(r.teamId), r.enteringAverage ?? "", r.isSub, r.fromWeek, r.toWeek ?? ""])) };
    }
    if (kind === "schedule") {
      return {
        filename: `${base}-${season.slug}-schedule.csv`,
        csv: toCsv(["week", "date", "phase", "team_a", "team_b", "state"], [...data.matchups].sort((a, b) => a.weekNumber - b.weekNumber).map((m) => {
          const w = model.weekByNumber.get(m.weekNumber);
          return [m.weekNumber, w?.date ?? "", w?.phase ?? "", tn(m.sideA), tn(m.sideB), m.state];
        })),
      };
    }
    if (kind === "results") {
      return {
        filename: `${base}-${season.slug}-results.csv`,
        csv: toCsv(["season", "week", "date", "matchup_id", "state", "rule_version", "side_a", "side_b", "winner", "points_a", "points_b", "scratch_series_a", "scratch_series_b", "adjusted_series_a", "adjusted_series_b", "margin"],
          model.results.filter((r) => r.b).map((r) => [season.name, r.weekNumber, model.weekByNumber.get(r.weekNumber)?.date ?? "", r.matchup.id, r.matchup.state, r.ruleVersion ?? "", tn(r.a.participantId), tn(r.b!.participantId), r.winner === "A" ? tn(r.a.participantId) : r.winner === "B" ? tn(r.b!.participantId) : r.winner ?? "", r.a.points, r.b!.points, r.a.scratchSeries, r.b!.scratchSeries, r.a.adjustedSeries, r.b!.adjustedSeries, r.margin ?? ""])),
      };
    }
    // scores (audit-grade: includes the handicap actually used)
    const rows: unknown[][] = [];
    for (const r of model.results) {
      if (!r.b) continue;
      for (const side of [r.a, r.b]) {
        for (const l of side.lineup) {
          for (const g of l.games) {
            if (g.kind === "missing") continue;
            rows.push([season.name, r.weekNumber, model.weekByNumber.get(r.weekNumber)?.date ?? "", r.matchup.id, r.matchup.state, r.ruleVersion ?? model.versionForWeek(r.weekNumber).version, tn(r.a.participantId), tn(r.b!.participantId), side.side, tn(side.participantId), bn(l.bowlerId), g.game, g.kind === "absent" ? "" : (g.kind === "bowled" ? g.scratch : ""), g.kind, l.average ?? "", g.handicap, g.adjusted ?? "", r.matchup.finalizedAt ?? ""]);
          }
        }
      }
    }
    return {
      filename: `${base}-${season.slug}-scores.csv`,
      csv: toCsv(["season", "week", "date", "matchup_id", "state", "rule_version", "team_a", "team_b", "side", "team", "bowler", "game", "scratch", "kind", "average_used", "handicap", "adjusted", "finalized_at"], rows),
    };
  });
}

// ---------------- full-league bundle (portability) ----------------

export const BUNDLE_FORMAT = "bowl-league-export@1";

export function exportBundle(store: Store, actor: Actor, leagueId: Id) {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "data.export");
    const league = db.leagues.find((l) => l.id === leagueId)!;
    const seasons = db.seasons.filter((s) => s.leagueId === leagueId);
    const seasonIds = new Set(seasons.map((s) => s.id));
    const matchups = db.matchups.filter((m) => seasonIds.has(m.seasonId));
    const matchupIds = new Set(matchups.map((m) => m.id));
    return {
      format: BUNDLE_FORMAT,
      exportedAt: now(),
      // Share tokens and member identities are deliberately excluded.
      league: { ...league, shareToken: undefined, id: undefined },
      leagueId: league.id,
      seasons,
      teams: db.teams.filter((t) => t.leagueId === leagueId),
      bowlers: db.bowlers.filter((b) => b.leagueId === leagueId).map((b) => ({ ...b, userId: null })),
      roster: db.roster.filter((r) => seasonIds.has(r.seasonId)),
      weeks: db.weeks.filter((w) => seasonIds.has(w.seasonId)),
      matchups,
      scores: db.scores.filter((s) => matchupIds.has(s.matchupId)),
      announcements: db.announcements.filter((a) => a.leagueId === leagueId),
      commissionerAwards: db.commissionerAwards.filter((a) => a.leagueId === leagueId),
      templates: db.templates.filter((t) => t.leagueId === leagueId),
      audit: db.audit.filter((a) => a.leagueId === leagueId),
    };
  });
}

const bundleSchema = z.object({
  format: z.literal(BUNDLE_FORMAT),
  league: z.record(z.unknown()),
  seasons: z.array(z.record(z.unknown())),
  teams: z.array(z.record(z.unknown())),
  bowlers: z.array(z.record(z.unknown())),
  roster: z.array(z.record(z.unknown())),
  weeks: z.array(z.record(z.unknown())),
  matchups: z.array(z.record(z.unknown())),
  scores: z.array(z.record(z.unknown())),
  announcements: z.array(z.record(z.unknown())).default([]),
  commissionerAwards: z.array(z.record(z.unknown())).default([]),
  templates: z.array(z.record(z.unknown())).default([]),
  audit: z.array(z.record(z.unknown())).default([]),
});

/** Restores a bundle as a *new* league owned by the importing user. Every id is remapped, so imports never collide with or touch existing leagues. */
export function importBundle(store: Store, actor: Actor, raw: unknown, newName?: string): { slug: string; leagueId: Id } {
  const parsed = bundleSchema.safeParse(raw);
  if (!parsed.success) throw invalid(`This isn't a valid league export: ${parsed.error.issues[0].path.join(".")} ${parsed.error.issues[0].message}`);
  const b = parsed.data;
  return store.transaction((db) => {
    const map = new Map<string, string>();
    const remap = (prefix: string, id: unknown) => {
      const key = String(id);
      if (!map.has(key)) map.set(key, newId(prefix));
      return map.get(key)!;
    };
    const leagueId = newId("lg");
    const name = (newName ?? String(b.league.name ?? "Imported league")).slice(0, 60);
    const slug = uniqueSlug(name, (s) => db.leagues.some((l) => l.slug === s));
    db.leagues.push({ ...(b.league as object), id: leagueId, slug, name, shareToken: newToken().slice(0, 24), createdBy: actor.id, createdAt: now(), archivedAt: null, isDemo: false } as never);
    db.memberships.push({ id: newId("mb"), leagueId, userId: actor.id, role: "owner", status: "active", bowlerId: null, joinedAt: now() });
    for (const t of b.teams) db.teams.push({ ...(t as object), id: remap("tm", t.id), leagueId } as never);
    for (const x of b.bowlers) db.bowlers.push({ ...(x as object), id: remap("bw", x.id), leagueId, userId: null } as never);
    for (const s of b.seasons) db.seasons.push({ ...(s as object), id: remap("se", s.id), leagueId, championId: s.championId ? remap(String(s.championId).startsWith("tm") ? "tm" : "bw", s.championId) : null } as never);
    const sid = (id: unknown) => map.get(String(id)) ?? (() => { throw invalid("The export is inconsistent (a record points at a missing season)."); })();
    for (const r of b.roster) db.roster.push({ ...(r as object), id: newId("ro"), seasonId: sid(r.seasonId), bowlerId: remap("bw", r.bowlerId), teamId: r.teamId ? remap("tm", r.teamId) : null } as never);
    for (const w of b.weeks) db.weeks.push({ ...(w as object), id: newId("wk"), seasonId: sid(w.seasonId) } as never);
    for (const m of b.matchups) {
      const mm = m as unknown as Matchup;
      const kindIsTeam = mm.kind === "team";
      const mapSide = (id: string | null) => (id ? remap(kindIsTeam ? "tm" : "bw", id) : null);
      const snap = mm.handicapSnapshot ? Object.fromEntries(Object.entries(mm.handicapSnapshot).map(([k, v]) => [remap("bw", k), v])) : null;
      db.matchups.push({ ...mm, id: remap("mu", mm.id), seasonId: sid(mm.seasonId), sideA: mapSide(mm.sideA)!, sideB: mapSide(mm.sideB), lineupA: mm.lineupA.map((i) => remap("bw", i)), lineupB: mm.lineupB.map((i) => remap("bw", i)), handicapSnapshot: snap, updatedBy: actor.id } as never);
    }
    for (const sc of b.scores) db.scores.push({ ...(sc as object), id: newId("sc"), matchupId: remap("mu", sc.matchupId), bowlerId: remap("bw", sc.bowlerId), updatedBy: actor.id } as never);
    for (const a of b.announcements) db.announcements.push({ ...(a as object), id: newId("an"), leagueId, createdBy: actor.id } as never);
    for (const a of b.commissionerAwards) db.commissionerAwards.push({ ...(a as object), id: newId("ca"), leagueId, seasonId: remap("se", a.seasonId), recipientId: remap(a.recipientKind === "team" ? "tm" : "bw", a.recipientId), createdBy: actor.id } as never);
    for (const t of b.templates) db.templates.push({ ...(t as object), id: newId("tp"), leagueId } as never);
    for (const a of b.audit) db.audit.push({ ...(a as object), id: newId("au"), leagueId, seasonId: a.seasonId ? (map.get(String(a.seasonId)) ?? null) : null } as never);
    writeAudit(db, actor, { leagueId, action: "data.bundle_imported", entityType: "league", entityId: leagueId, after: { seasons: b.seasons.length, scores: b.scores.length } });
    return { slug, leagueId };
  });
}
