import { validateConfig, type RuleConfig } from "@/domain/config";
import { buildSeasonModel, snapshotForMatchup } from "@/domain/engine";
import { previewRuleChange, proposedVersions, type ChangeScope, type RulePreview } from "@/domain/rulechange";
import type { Id } from "@/domain/types";
import { isOfficial } from "@/domain/types";
import { leagueById, notifyMembers, requirePerm, seasonData, seasonIn, writeAudit, type Actor } from "../access";
import type { Store } from "../db";
import { invalid } from "../errors";
import { now } from "../ids";
import { step } from "./results";
import { syncPlayoffWeeks } from "./season";

export function previewSeasonRules(store: Store, actor: Actor, leagueId: Id, seasonId: Id, proposed: unknown, scope: ChangeScope): Promise<RulePreview> {
  return store.read((db) => {
    requirePerm(db, actor, leagueId, "settings.rules");
    return previewRuleChange(seasonData(db, leagueId, seasonId), proposed, scope);
  });
}

export interface ApplyRulesInput {
  seasonId: Id;
  proposed: unknown;
  scope: ChangeScope;
  reason: string;
  /** Required whenever the preview says the change reverses results or alters playoff qualification. */
  strongConfirmation?: string;
}

/**
 * Applies a rule change atomically. The server recomputes the preview itself (never trusting the client's),
 * writes a new rule version, re-snapshots finalized results only for explicit historical corrections, and records
 * the before/after in the audit log. Any failure rolls the whole thing back.
 */
export function applyRuleChange(store: Store, actor: Actor, leagueId: Id, input: ApplyRulesInput): Promise<{ version: number; reversed: number }> {
  if (!input.reason || input.reason.trim().length < 3) throw invalid("Add a short note explaining why the rules are changing.");
  return store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.rules");
    const season = seasonIn(db, leagueId, input.seasonId);
    const data = seasonData(db, leagueId, input.seasonId);
    const preview = previewRuleChange(data, input.proposed, input.scope);
    if (!preview.ok) throw invalid(preview.blockers[0] ?? "These rules can't be applied.", preview);
    if (preview.requiresStrongConfirmation && input.strongConfirmation !== "CHANGE RESULTS")
      throw invalid("This change affects finalized results or playoff qualification. Type CHANGE RESULTS to confirm.", preview);

    const check = validateConfig(input.proposed);
    const proposed = check.config as RuleConfig;
    const previousVersion = season.ruleVersions[season.ruleVersions.length - 1].version;

    if (input.scope.type === "new_season") {
      const before = league.defaultConfig;
      league.defaultConfig = proposed;
      step("rules:default");
      writeAudit(db, actor, { leagueId, action: "rules.defaults_changed", entityType: "league", entityId: leagueId, before, after: proposed, note: input.reason });
      return { version: 0, reversed: 0 };
    }

    const { versions, newVersion } = proposedVersions(data, proposed, input.scope, { by: actor.id, reason: input.reason.trim().slice(0, 300), now: now() });
    season.ruleVersions = versions;
    step("rules:version");
    let reversed = 0;
    if (input.scope.type === "historical") {
      // Explicit correction: finalized results are re-based on the new rules and re-snapshotted.
      const model = buildSeasonModel(seasonData(db, leagueId, input.seasonId));
      for (const m of db.matchups.filter((x) => x.seasonId === season.id && isOfficial(x.state) && x.sideB)) {
        const before = model.resultById.get(m.id)!;
        m.ruleVersion = newVersion;
        m.handicapSnapshot = null;
        const fresh = buildSeasonModel(seasonData(db, leagueId, season.id));
        m.handicapSnapshot = snapshotForMatchup(fresh, m);
        const after = buildSeasonModel(seasonData(db, leagueId, season.id)).resultById.get(m.id)!;
        if (before.winner !== after.winner) reversed++;
        writeAudit(db, actor, {
          leagueId, seasonId: season.id, action: "result.recalculated", entityType: "matchup", entityId: m.id,
          before: { winner: before.winner, pointsA: before.a.points, pointsB: before.b?.points ?? 0, ruleVersion: before.ruleVersion },
          after: { winner: after.winner, pointsA: after.a.points, pointsB: after.b?.points ?? 0, ruleVersion: newVersion },
          note: input.reason,
        });
        step("rules:recalc");
      }
    }
    syncPlayoffWeeks(db, season.id);
    writeAudit(db, actor, {
      leagueId, seasonId: season.id, action: "rules.changed", entityType: "season", entityId: season.id,
      before: { version: previousVersion, diffs: preview.diffs.map((d) => ({ path: d.path, value: d.before })) },
      after: { version: newVersion, scope: input.scope, diffs: preview.diffs.map((d) => ({ path: d.path, value: d.after })) },
      note: input.reason,
    });
    notifyMembers(db, {
      leagueId, type: "rules", title: "League rules updated",
      body: `${preview.diffs.length} setting${preview.diffs.length === 1 ? "" : "s"} changed${input.scope.type === "from_week" ? ` starting week ${input.scope.week}` : " for the whole season"}.`,
      href: `/l/${leagueById(db, leagueId).slug}/rules`, dedupeKey: `rules:${season.id}:${newVersion}`, exceptUserId: actor.id,
    });
    return { version: newVersion, reversed };
  });
}

/** League-wide defaults for *future* seasons. Never touches an existing season's rules. */
export async function updateLeagueDefaults(store: Store, actor: Actor, leagueId: Id, proposed: unknown, reason: string) {
  const check = validateConfig(proposed);
  if (!check.ok || !check.config) throw invalid(check.issues.find((i) => i.severity === "error")!.message);
  await store.transaction((db) => {
    const { league } = requirePerm(db, actor, leagueId, "settings.rules");
    const before = league.defaultConfig;
    league.defaultConfig = check.config!;
    writeAudit(db, actor, { leagueId, action: "rules.defaults_changed", entityType: "league", entityId: leagueId, before, after: check.config, note: reason });
  });
}

