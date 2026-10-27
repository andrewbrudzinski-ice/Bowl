import { playoffConfigFor } from "@/domain/config";
import { buildSeasonModel, snapshotForMatchup, type SeasonData } from "@/domain/engine";
import { computeStandings, type StandingRow } from "@/domain/standings";
import { validateEntry, type Issue, type ScoreInput } from "@/domain/validate";
import type { Id, Matchup, ResultState, Score, Side } from "@/domain/types";
import { isOfficial } from "@/domain/types";
import { leagueById, matchupIn, notifyMembers, requirePerm, seasonData, writeAudit, type Actor } from "../access";
import type { DB, Store } from "../db";
import { AppError, conflict, invalid } from "../errors";
import { newId, now } from "../ids";
import { advancePlayoffs } from "./season";

export interface EntryInput {
  matchupId: Id;
  expectedRevision: number;
  lineupA: Id[];
  lineupB: Id[];
  scores: ScoreInput[];
  forfeitBy?: Side | null;
  notes?: string;
  /** "ready" runs the finalize-level validation and marks the result ready for review. */
  submit?: "draft" | "ready";
  idempotencyKey?: string;
}

export interface ScoreChange {
  bowlerId: Id;
  game: number;
  before: { scratch: number | null; kind: string } | null;
  after: { scratch: number | null; kind: string } | null;
}

export interface SaveResult {
  matchupId: Id;
  revision: number;
  state: ResultState;
  issues: Issue[];
  changes: ScoreChange[];
  duplicate?: boolean;
}

/** Test seam: lets tests inject a failure part-way through multi-record operations. No-op in production. */
export const testHooks: { afterStep?: (step: string) => void } = {};
export const step = (name: string) => testHooks.afterStep?.(name);

function throwIssues(issues: Issue[], headline: string): never {
  const errors = issues.filter((i) => i.severity === "error");
  throw new AppError("validation", `${headline} ${errors[0]?.message ?? ""}`.trim(), issues);
}

function diffScores(old: Score[], next: ScoreInput[]): ScoreChange[] {
  const key = (b: Id, g: number) => `${b}|${g}`;
  const om = new Map(old.map((s) => [key(s.bowlerId, s.game), s]));
  const nm = new Map(next.filter((s) => s.kind !== "bowled" || s.scratch != null).map((s) => [key(s.bowlerId, s.game), s]));
  const out: ScoreChange[] = [];
  for (const k of new Set([...om.keys(), ...nm.keys()])) {
    const o = om.get(k);
    const n = nm.get(k);
    const same = o && n && o.scratch === n.scratch && o.kind === n.kind;
    if (same) continue;
    const [bowlerId, game] = k.split("|");
    out.push({
      bowlerId, game: Number(game),
      before: o ? { scratch: o.scratch, kind: o.kind } : null,
      after: n ? { scratch: n.scratch, kind: n.kind } : null,
    });
  }
  return out;
}

function standingsSummary(rows: StandingRow[]) {
  return rows.map((r) => ({ id: r.id, rank: r.rank, points: r.points, wins: r.wins, losses: r.losses }));
}

function weekStatusSync(db: DB, seasonId: Id, week: number) {
  const w = db.weeks.find((x) => x.seasonId === seasonId && x.number === week);
  if (!w || w.status === "postponed") return;
  const ms = db.matchups.filter((m) => m.seasonId === seasonId && m.weekNumber === week);
  if (!ms.length) return;
  if (ms.every((m) => isOfficial(m.state))) w.status = "completed";
  else if (ms.some((m) => m.state !== "scheduled")) w.status = "in_progress";
  else w.status = "scheduled";
}

export function applyEntry(db: DB, actor: Actor, leagueId: Id, input: EntryInput, mode: { correction: null | { reason: string } }): SaveResult {
  const { matchup, season } = matchupIn(db, leagueId, input.matchupId);
  const official = isOfficial(matchup.state);
  if (mode.correction == null && official && matchup.sideB)
    throw new AppError("locked", "This result is finalized. Use “Correct result” to change it — corrections are confirmed and audited.");
  if (mode.correction != null && !official) throw invalid("Only finalized results can be corrected.");

  if (input.idempotencyKey) {
    const seen = db.idempotency.find((i) => i.key === `${input.matchupId}:${input.idempotencyKey}`);
    if (seen) return { ...(JSON.parse(seen.result) as SaveResult), duplicate: true };
  }
  if (matchup.revision !== input.expectedRevision)
    throw conflict("Someone else changed this matchup after you opened it. Reload to see their changes before saving.", { currentRevision: matchup.revision });

  const data: SeasonData = seasonData(db, leagueId, season.id);
  const model = buildSeasonModel(data);
  const cfg = model.configForWeek(matchup.weekNumber);
  const effectiveCfg = official && matchup.ruleVersion != null ? cfgOfVersion(model, matchup) : cfg;

  const proposed: Matchup = { ...matchup, lineupA: input.lineupA, lineupB: input.lineupB, forfeitBy: input.forfeitBy ?? null };
  if (matchup.kind === "individual") {
    proposed.lineupA = [matchup.sideA];
    proposed.lineupB = matchup.sideB ? [matchup.sideB] : [];
  }
  const asReady = input.submit === "ready" || mode.correction != null;
  // Validate against the *other* matchups in the week, with this one replaced by the proposal.
  const issues = validateEntry(model, proposed, input.scores, effectiveCfg, { forFinalize: asReady });
  if (issues.some((i) => i.severity === "error")) throwIssues(issues, "Couldn't save.");

  const old = db.scores.filter((s) => s.matchupId === matchup.id);
  const changes = diffScores(old, input.scores);
  const beforeStandings = mode.correction ? standingsSummary(computeStandings(model, { scope: matchup.kind === "team" ? "team" : "bowler" }).rows) : null;

  // ---- mutate (no throws below this line) ----
  db.scores = db.scores.filter((s) => s.matchupId !== matchup.id);
  const stamp = now();
  for (const s of input.scores) {
    if (s.kind === "bowled" && s.scratch == null) continue;
    db.scores.push({ id: newId("sc"), matchupId: matchup.id, bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.kind === "bowled" ? s.scratch : null, kind: s.kind, updatedAt: stamp, updatedBy: actor.id });
  }
  const prevLineup = { A: matchup.lineupA, B: matchup.lineupB };
  const lineupChanged = JSON.stringify(prevLineup) !== JSON.stringify({ A: proposed.lineupA, B: proposed.lineupB });
  matchup.lineupA = proposed.lineupA;
  matchup.lineupB = proposed.lineupB;
  matchup.forfeitBy = proposed.forfeitBy;
  if (input.notes !== undefined) matchup.notes = input.notes.slice(0, 500);
  matchup.updatedAt = stamp;
  matchup.updatedBy = actor.id;
  matchup.revision += 1;

  const hasAny = input.scores.some((s) => s.kind !== "bowled" || s.scratch != null) || !!matchup.forfeitBy;
  if (mode.correction) {
    matchup.state = "corrected";
    // A substitute who wasn't in the original snapshot gets a handicap recorded for this night.
    const model2 = buildSeasonModel(seasonData(db, leagueId, season.id));
    const snap = matchup.handicapSnapshot ?? {};
    const fresh = snapshotForMatchup(model2, matchup);
    for (const id of Object.keys(fresh)) if (!snap[id]) snap[id] = fresh[id];
    matchup.handicapSnapshot = snap;
  } else if (input.submit === "ready") matchup.state = "ready_for_review";
  else matchup.state = hasAny ? "draft" : lineupChanged ? "in_progress" : "scheduled";
  weekStatusSync(db, season.id, matchup.weekNumber);

  if (mode.correction) {
    const after = standingsSummary(computeStandings(buildSeasonModel(seasonData(db, leagueId, season.id)), { scope: matchup.kind === "team" ? "team" : "bowler" }).rows);
    writeAudit(db, actor, {
      leagueId, seasonId: season.id, action: "result.corrected", entityType: "matchup", entityId: matchup.id,
      before: { scores: changes.map((c) => ({ bowlerId: c.bowlerId, game: c.game, ...c.before })), standings: beforeStandings, lineup: prevLineup },
      after: { scores: changes.map((c) => ({ bowlerId: c.bowlerId, game: c.game, ...c.after })), standings: after, lineup: { A: proposed.lineupA, B: proposed.lineupB } },
      note: mode.correction.reason,
    });
  } else if (changes.length || lineupChanged) {
    writeAudit(db, actor, {
      leagueId, seasonId: season.id, action: "scores.saved", entityType: "matchup", entityId: matchup.id,
      before: { scores: changes.filter((c) => c.before).map((c) => ({ bowlerId: c.bowlerId, game: c.game, ...c.before })) },
      after: { scores: changes.filter((c) => c.after).map((c) => ({ bowlerId: c.bowlerId, game: c.game, ...c.after })), state: matchup.state },
    });
  }
  const result: SaveResult = { matchupId: matchup.id, revision: matchup.revision, state: matchup.state, issues, changes };
  if (input.idempotencyKey) {
    db.idempotency.push({ key: `${input.matchupId}:${input.idempotencyKey}`, at: stamp, result: JSON.stringify(result) });
    if (db.idempotency.length > 2000) db.idempotency.splice(0, db.idempotency.length - 1000);
  }
  return result;
}

/** The rules a finalized matchup was played under (its stored rule version), with playoff overrides applied. */
function cfgOfVersion(model: ReturnType<typeof buildSeasonModel>, m: Matchup) {
  const v = model.data.season.ruleVersions.find((x) => x.version === m.ruleVersion);
  return v ? playoffConfigFor(v.config, model.weekByNumber.get(m.weekNumber)?.phase ?? "regular") : model.configForWeek(m.weekNumber);
}

export function saveEntry(store: Store, actor: Actor, leagueId: Id, input: EntryInput): Promise<SaveResult> {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "scores.enter");
    return applyEntry(db, actor, leagueId, input, { correction: null });
  }, { leagueId });
}

export interface BulkItemResult {
  matchupId: Id;
  ok: boolean;
  error?: string;
  issues?: Issue[];
  result?: SaveResult;
}

/** Saves a whole league night in one request. Each matchup succeeds or fails independently and reports why. */
export function saveWeekEntries(store: Store, actor: Actor, leagueId: Id, entries: EntryInput[]): Promise<BulkItemResult[]> {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "scores.enter");
    const out: BulkItemResult[] = [];
    for (const e of entries) {
      try {
        const result = applyEntry(db, actor, leagueId, e, { correction: null });
        out.push({ matchupId: e.matchupId, ok: true, result });
      } catch (err) {
        if (err instanceof AppError) out.push({ matchupId: e.matchupId, ok: false, error: err.message, issues: Array.isArray(err.details) ? (err.details as Issue[]) : undefined });
        else throw err;
      }
    }
    return out;
  }, { leagueId });
}

export interface FinalizePreview {
  canFinalize: boolean;
  issues: Issue[];
  standingsBefore: StandingRow[];
  standingsAfter: StandingRow[];
  summary: { winner: string | null; a: number; b: number };
}

function storedScores(db: Readonly<DB>, matchupId: Id): ScoreInput[] {
  return db.scores.filter((s) => s.matchupId === matchupId).map((s) => ({ bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.scratch, kind: s.kind }));
}

/** Shows what finalizing would do to the standings without writing anything. */
export function previewFinalize(store: Store, actor: Actor, leagueId: Id, matchupId: Id): Promise<FinalizePreview> {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "results.finalize");
    const { matchup, season } = matchupIn(db, leagueId, matchupId);
    const data = seasonData(db, leagueId, season.id);
    const model = buildSeasonModel(data);
    const cfg = model.configForWeek(matchup.weekNumber);
    const issues = validateEntry(model, matchup, storedScores(db, matchupId), cfg, { forFinalize: true });
    const scope = matchup.kind === "team" ? "team" : "bowler";
    const before = computeStandings(model, { scope }).rows;
    const snap = snapshotForMatchup(model, matchup);
    const hypothetical = data.matchups.map((m) => (m.id === matchupId ? { ...m, state: "finalized" as ResultState, handicapSnapshot: snap, ruleVersion: model.versionForWeek(m.weekNumber).version } : m));
    const model2 = buildSeasonModel({ ...data, matchups: hypothetical });
    const after = computeStandings(model2, { scope }).rows;
    const r = model2.resultById.get(matchupId)!;
    return {
      canFinalize: !issues.some((i) => i.severity === "error") && !isOfficial(matchup.state),
      issues, standingsBefore: before, standingsAfter: after,
      summary: { winner: r.winner, a: r.a.points, b: r.b?.points ?? 0 },
    };
  }, { leagueId });
}

export function finalizeInDb(db: DB, actor: Actor, leagueId: Id, matchupId: Id, expectedRevision: number): SaveResult {
  const { matchup, season } = matchupIn(db, leagueId, matchupId);
  if (isOfficial(matchup.state)) throw conflict("This result is already final.");
  if (matchup.revision !== expectedRevision) throw conflict("This matchup changed since you opened it. Reload and review before finalizing.", { currentRevision: matchup.revision });
  const model = buildSeasonModel(seasonData(db, leagueId, season.id));
  const cfg = model.configForWeek(matchup.weekNumber);
  const issues = validateEntry(model, matchup, storedScores(db, matchupId), cfg, { forFinalize: true });
  if (issues.some((i) => i.severity === "error")) throwIssues(issues, "Can't finalize yet.");
  const wasFinalizedBefore = matchup.finalizedAt != null;
  const snapshot = snapshotForMatchup(model, matchup);
  const version = model.versionForWeek(matchup.weekNumber).version;
  step("finalize:validated");
  matchup.handicapSnapshot = snapshot;
  matchup.ruleVersion = version;
  matchup.state = wasFinalizedBefore ? "corrected" : "finalized";
  matchup.finalizedAt = now();
  matchup.finalizedBy = actor.id;
  matchup.updatedAt = now();
  matchup.updatedBy = actor.id;
  matchup.revision += 1;
  step("finalize:matchup");
  weekStatusSync(db, season.id, matchup.weekNumber);
  writeAudit(db, actor, { leagueId, seasonId: season.id, action: "result.finalized", entityType: "matchup", entityId: matchup.id, after: { state: matchup.state, ruleVersion: version, handicapSnapshot: snapshot } });
  step("finalize:audit");
  const league = leagueById(db, leagueId);
  const weekMatchups = db.matchups.filter((m) => m.seasonId === season.id && m.weekNumber === matchup.weekNumber);
  if (weekMatchups.every((m) => isOfficial(m.state))) {
    notifyMembers(db, { leagueId, type: "results", title: `Week ${matchup.weekNumber} results are final`, body: `${season.name} standings are updated.`, href: `/l/${league.slug}/season/${season.slug}/week/${matchup.weekNumber}`, dedupeKey: `results:${season.id}:${matchup.weekNumber}`, exceptUserId: actor.id });
  }
  if (db.weeks.find((w) => w.seasonId === season.id && w.number === matchup.weekNumber)?.phase === "playoff") advancePlayoffs(db, leagueId, season.id, actor);
  return { matchupId, revision: matchup.revision, state: matchup.state, issues, changes: [] };
}

export function finalizeMatchup(store: Store, actor: Actor, leagueId: Id, matchupId: Id, expectedRevision: number): Promise<SaveResult> {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "results.finalize");
    return finalizeInDb(db, actor, leagueId, matchupId, expectedRevision);
  }, { leagueId });
}

export function markReady(store: Store, actor: Actor, leagueId: Id, matchupId: Id, expectedRevision: number): Promise<SaveResult> {
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "scores.enter");
    const { matchup, season } = matchupIn(db, leagueId, matchupId);
    if (isOfficial(matchup.state)) throw conflict("This result is already final.");
    if (matchup.revision !== expectedRevision) throw conflict("This matchup changed since you opened it. Reload first.", { currentRevision: matchup.revision });
    const model = buildSeasonModel(seasonData(db, leagueId, season.id));
    const issues = validateEntry(model, matchup, storedScores(db, matchupId), model.configForWeek(matchup.weekNumber), { forFinalize: true });
    if (issues.some((i) => i.severity === "error")) throwIssues(issues, "Not ready for review yet.");
    matchup.state = "ready_for_review";
    matchup.revision += 1;
    matchup.updatedAt = now();
    matchup.updatedBy = actor.id;
    weekStatusSync(db, season.id, matchup.weekNumber);
    writeAudit(db, actor, { leagueId, seasonId: season.id, action: "result.marked_ready", entityType: "matchup", entityId: matchupId });
    return { matchupId, revision: matchup.revision, state: matchup.state, issues, changes: [] };
  }, { leagueId });
}

export interface CorrectionInput extends EntryInput {
  reason: string;
  confirm: boolean;
}

/** Correct a finalized result. Requires an explicit confirmation and a reason; the old values stay in the audit log. */
export function correctResult(store: Store, actor: Actor, leagueId: Id, input: CorrectionInput): Promise<SaveResult> {
  if (!input.confirm) throw invalid("Confirm that you want to change a finalized result.");
  if (!input.reason || input.reason.trim().length < 3) throw invalid("Give a short reason for the correction (it's recorded in the audit history).");
  return store.transaction((db) => {
    requirePerm(db, actor, leagueId, "results.correct");
    return applyEntry(db, actor, leagueId, input, { correction: { reason: input.reason.trim().slice(0, 300) } });
  }, { leagueId });
}

/** Takes a finalized result out of the official standings so it can be edited normally. */
export async function reopenResult(store: Store, actor: Actor, leagueId: Id, matchupId: Id, reason: string, confirm: boolean) {
  if (!confirm) throw invalid("Confirm that you want to reopen a finalized result.");
  if (!reason || reason.trim().length < 3) throw invalid("Give a short reason for reopening this result.");
  await store.transaction((db) => {
    requirePerm(db, actor, leagueId, "results.correct");
    const { matchup, season } = matchupIn(db, leagueId, matchupId);
    if (!isOfficial(matchup.state)) throw conflict("This result isn't final.");
    if (!matchup.sideB) throw conflict("Bye weeks have no result to reopen.");
    const before = matchup.state;
    matchup.state = "draft";
    matchup.revision += 1;
    matchup.updatedAt = now();
    matchup.updatedBy = actor.id;
    weekStatusSync(db, season.id, matchup.weekNumber);
    writeAudit(db, actor, { leagueId, seasonId: season.id, action: "result.reopened", entityType: "matchup", entityId: matchupId, before: { state: before }, after: { state: "draft" }, note: reason.trim().slice(0, 300) });
  }, { leagueId });
}
