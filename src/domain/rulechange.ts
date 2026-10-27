import { STRUCTURAL_PATHS, validateConfig, type ConfigIssue, type RuleConfig } from "./config";
import { buildSeasonModel, type SeasonData, type SeasonModel } from "./engine";
import { computeStandings, type StandingRow } from "./standings";
import type { Id, RuleVersion } from "./types";
import { isOfficial } from "./types";

export interface ConfigDiff {
  path: string;
  before: unknown;
  after: unknown;
}

function flatten(prefix: string, v: unknown, out: Record<string, unknown>) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v)) flatten(prefix ? `${prefix}.${k}` : k, x, out);
  } else out[prefix] = v;
}

export function diffConfig(before: RuleConfig, after: RuleConfig): ConfigDiff[] {
  const a: Record<string, unknown> = {};
  const b: Record<string, unknown> = {};
  flatten("", before, a);
  flatten("", after, b);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: ConfigDiff[] = [];
  for (const k of [...keys].sort()) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) out.push({ path: k, before: a[k], after: b[k] });
  }
  return out;
}

export interface ChangeClass {
  structural: string[];
  affectsHandicap: boolean;
  affectsScoring: boolean;
  affectsStandings: boolean;
  affectsPlayoffs: boolean;
}

export function classifyDiffs(diffs: ConfigDiff[]): ChangeClass {
  const has = (prefix: string) => diffs.some((d) => d.path === prefix || d.path.startsWith(prefix + "."));
  return {
    structural: diffs.filter((d) => STRUCTURAL_PATHS.some((p) => d.path === p)).map((d) => d.path),
    affectsHandicap: has("handicap"),
    affectsScoring: has("scoring") || has("format"),
    affectsStandings: has("standings") || has("scoring"),
    affectsPlayoffs: has("playoffs"),
  };
}

export type ChangeScope = { type: "from_week"; week: number } | { type: "historical" } | { type: "new_season" };

export interface ResultChange {
  matchupId: Id;
  week: number;
  before: { winner: string | null; a: number; b: number };
  after: { winner: string | null; a: number; b: number };
  reversed: boolean;
}

export interface RulePreview {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  configIssues: ConfigIssue[];
  diffs: ConfigDiff[];
  classification: ChangeClass;
  /** Weeks whose calculations would use the new rules. */
  affectedWeeks: number[];
  finalizedAffected: ResultChange[];
  reversedCount: number;
  standingsBefore: StandingRow[];
  standingsAfter: StandingRow[];
  playoffQualifiersChanged: boolean;
  handicapChanges: { bowlerId: Id; week: number; before: number; after: number }[];
  requiresStrongConfirmation: boolean;
  firstEligibleWeek: number;
}

export function firstEligibleWeek(data: SeasonData): number {
  let last = 0;
  for (const m of data.matchups) if (isOfficial(m.state) && m.sideB) last = Math.max(last, m.weekNumber);
  return last + 1;
}

export function nextRuleVersion(versions: RuleVersion[]): number {
  return Math.max(0, ...versions.map((v) => v.version)) + 1;
}

/** Builds the version list that would result from the change (pure; nothing is written). */
export function proposedVersions(
  data: SeasonData,
  proposed: RuleConfig,
  scope: ChangeScope,
  meta: { by: string; reason: string; now: string }
): { versions: RuleVersion[]; matchups: SeasonData["matchups"]; newVersion: number } {
  const versions = structuredClone(data.season.ruleVersions);
  const n = nextRuleVersion(versions);
  if (scope.type === "historical") {
    // Entire season re-based on the proposed config; finalized matchups are re-snapshotted under it.
    const matchups = data.matchups.map((m) => (isOfficial(m.state) && m.sideB ? { ...m, ruleVersion: n, handicapSnapshot: null } : m));
    return {
      versions: [...versions, { version: n, effectiveFromWeek: 1, config: proposed, createdAt: meta.now, createdBy: meta.by, reason: meta.reason }],
      matchups,
      newVersion: n,
    };
  }
  const from = scope.type === "from_week" ? scope.week : 1;
  return {
    versions: [...versions, { version: n, effectiveFromWeek: from, config: proposed, createdAt: meta.now, createdBy: meta.by, reason: meta.reason }],
    matchups: data.matchups,
    newVersion: n,
  };
}

export function previewRuleChange(data: SeasonData, proposedRaw: unknown, scope: ChangeScope, currentModel?: SeasonModel): RulePreview {
  const check = validateConfig(proposedRaw);
  const empty: RulePreview = {
    ok: false, blockers: [], warnings: [], configIssues: check.issues, diffs: [], classification: classifyDiffs([]),
    affectedWeeks: [], finalizedAffected: [], reversedCount: 0, standingsBefore: [], standingsAfter: [],
    playoffQualifiersChanged: false, handicapChanges: [], requiresStrongConfirmation: false, firstEligibleWeek: firstEligibleWeek(data),
  };
  if (!check.ok || !check.config) {
    empty.blockers = check.issues.filter((i) => i.severity === "error").map((i) => i.message);
    return empty;
  }
  const proposed = check.config;
  const before = currentModel ?? buildSeasonModel(data);
  const totalWeeks = data.weeks.length ? Math.max(...data.weeks.map((w) => w.number)) : data.season.regularWeeks;
  const eligible = firstEligibleWeek(data);
  const currentCfg = before.configForWeek(scope.type === "from_week" ? scope.week : 1);
  const diffs = diffConfig(currentCfg, proposed);
  const classification = classifyDiffs(diffs);
  const blockers: string[] = [];
  const warnings: string[] = check.issues.filter((i) => i.severity === "warning").map((i) => i.message);

  const anyScores = data.scores.length > 0;
  if (scope.type === "new_season") {
    return { ...empty, ok: true, blockers: [], warnings, diffs, classification, affectedWeeks: [], firstEligibleWeek: eligible };
  }
  if (!diffs.length) {
    return { ...empty, ok: false, blockers: ["No settings were changed."], diffs, classification };
  }
  if (classification.structural.length && anyScores)
    blockers.push(`${classification.structural.join(", ")} cannot change after scores have been entered. Apply it to a new season instead.`);
  if (scope.type === "from_week") {
    if (scope.week < 1 || scope.week > totalWeeks) blockers.push(`Week ${scope.week} is outside this season.`);
    if (scope.week < eligible)
      blockers.push(`Week ${scope.week} already has finalized results. Choose week ${eligible} or later, or use the historical correction process.`);
  }

  const applyFrom = scope.type === "from_week" ? scope.week : 1;
  const { versions, matchups } = proposedVersions(data, proposed, scope, { by: "preview", reason: "preview", now: new Date(0).toISOString() });
  const after = buildSeasonModel({ ...data, matchups }, { versionsOverride: versions });

  const finalizedAffected: ResultChange[] = [];
  for (const r of before.results) {
    if (!r.official || r.isBye) continue;
    const r2 = after.resultById.get(r.matchup.id);
    if (!r2) continue;
    const b = { winner: r.winner, a: r.a.points, b: r.b?.points ?? 0 };
    const a = { winner: r2.winner, a: r2.a.points, b: r2.b?.points ?? 0 };
    const changedScores =
      r.a.basisSeries !== r2.a.basisSeries || (r.b?.basisSeries ?? 0) !== (r2.b?.basisSeries ?? 0) || b.a !== a.a || b.b !== a.b || b.winner !== a.winner;
    if (changedScores) finalizedAffected.push({ matchupId: r.matchup.id, week: r.weekNumber, before: b, after: a, reversed: b.winner !== a.winner });
  }
  const reversedCount = finalizedAffected.filter((c) => c.reversed).length;

  const standingsBefore = computeStandings(before, { scope: "team" }).rows;
  const standingsAfter = computeStandings(after, { scope: "team", config: after.configForWeek(Math.max(1, Math.min(totalWeeks, data.season.regularWeeks))) }).rows;
  const q = proposed.playoffs.enabled ? proposed.playoffs.qualifiers : currentCfg.playoffs.enabled ? currentCfg.playoffs.qualifiers : 0;
  const topSet = (rows: StandingRow[]) => rows.slice(0, q).map((r) => r.id).sort().join(",");
  const playoffQualifiersChanged = q > 0 && topSet(standingsBefore) !== topSet(standingsAfter);

  const affectedWeeks: number[] = [];
  for (let w = applyFrom; w <= totalWeeks; w++) affectedWeeks.push(w);

  // Handicap preview for the first affected week.
  const handicapChanges: RulePreview["handicapChanges"] = [];
  if (classification.affectsHandicap) {
    const week = scope.type === "from_week" ? scope.week : eligible;
    const ids = new Set(data.roster.filter((r) => r.fromWeek <= week && (r.toWeek == null || r.toWeek >= week)).map((r) => r.bowlerId));
    for (const id of ids) {
      const b = before.handicapAt(id, week).breakdown.handicap;
      const a = after.handicapAt(id, week).breakdown.handicap;
      if (a !== b) handicapChanges.push({ bowlerId: id, week, before: b, after: a });
    }
  }

  if (scope.type === "historical") warnings.push("This rewrites finalized results for the whole season. The original rules and every changed result are kept in the audit log.");
  if (scope.type === "from_week" && affectedWeeks.length === 0) warnings.push("No weeks remain, so nothing will use the new rules this season.");

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    configIssues: check.issues,
    diffs,
    classification,
    affectedWeeks,
    finalizedAffected,
    reversedCount,
    standingsBefore,
    standingsAfter,
    playoffQualifiersChanged,
    handicapChanges,
    requiresStrongConfirmation: scope.type === "historical" || reversedCount > 0 || playoffQualifiersChanged,
    firstEligibleWeek: eligible,
  };
}
