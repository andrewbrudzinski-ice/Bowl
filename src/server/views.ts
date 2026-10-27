import { computeStandings, type StandingRow } from "@/domain/standings";
import type { MatchupResult } from "@/domain/scoring";
import type { Id } from "@/domain/types";
import { isOfficial } from "@/domain/types";
import type { LeagueCtx } from "./context";
import { getStore } from "./db";

export interface Participant {
  id: Id;
  name: string;
  color: string;
  logo: string;
  kind: "team" | "bowler";
  href: string;
}

export function participant(ctx: LeagueCtx, id: Id, kind: "team" | "individual", seasonQ: string | null = null): Participant {
  const q = seasonQ ? `?season=${seasonQ}` : "";
  if (kind === "team") {
    const t = ctx.model!.teamById.get(id);
    return { id, name: t?.name ?? "Unknown team", color: t?.color ?? "#64748b", logo: t?.logo ?? "?", kind: "team", href: `/l/${ctx.league.slug}/teams/${id}${q}` };
  }
  const b = ctx.model!.bowlerById.get(id);
  return { id, name: b?.name ?? "Unknown bowler", color: b?.avatarColor ?? "#64748b", logo: (b?.name ?? "?").slice(0, 1), kind: "bowler", href: `/l/${ctx.league.slug}/bowlers/${id}${q}` };
}

/** The week the league is "on": the first one with unfinished matchups, else the last completed one. */
export function currentWeek(ctx: LeagueCtx): number {
  const m = ctx.model!;
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number);
  if (!weeks.length) return 1;
  for (const w of weeks) {
    if (w.status === "postponed") continue;
    const ms = m.results.filter((r) => r.weekNumber === w.number && !r.isBye);
    if (ms.length && ms.some((r) => !r.official)) return w.number;
    if (!ms.length && !m.results.some((r) => r.weekNumber > w.number)) return w.number;
  }
  return m.lastOfficialWeek || weeks[weeks.length - 1].number;
}

export type RecordLine = { rank: number; w: number; l: number; t: number; points: number };

export function recordsEntering(ctx: LeagueCtx, week: number): Map<Id, RecordLine> {
  const scope = ctx.cfg.format === "individual" ? "bowler" : "team";
  const { rows } = computeStandings(ctx.model!, { scope, throughWeek: week - 1 });
  return new Map(rows.map((r) => [r.id, { rank: r.rank, w: r.wins, l: r.losses, t: r.ties, points: r.points }]));
}

export const recordText = (r: RecordLine | undefined) => (r ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}` : "0-0");

export function standingsRows(ctx: LeagueCtx, through?: number): StandingRow[] {
  const scope = ctx.cfg.format === "individual" ? "bowler" : "team";
  return computeStandings(ctx.model!, { scope, throughWeek: through }).rows;
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) {
  if (!iso) return "";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function resultStatus(r: MatchupResult): { label: string; tone: "win" | "warn" | "neutral" | "info"; final: boolean } {
  const s = r.matchup.state;
  if (r.isBye) return { label: "BYE", tone: "neutral", final: true };
  if (r.forfeitBy && isOfficial(s)) return { label: "FORFEIT", tone: "info", final: true };
  if (s === "finalized") return { label: "FINAL", tone: "win", final: true };
  if (s === "corrected") return { label: "FINAL · CORRECTED", tone: "win", final: true };
  if (s === "ready_for_review") return { label: "PENDING REVIEW", tone: "warn", final: false };
  if (s === "draft") return { label: r.complete ? "DRAFT · UNOFFICIAL" : "DRAFT · INCOMPLETE", tone: "warn", final: false };
  if (s === "in_progress") return { label: "IN PROGRESS", tone: "info", final: false };
  return { label: "SCHEDULED", tone: "neutral", final: false };
}

export interface ActivityItem {
  at: string;
  text: string;
  href?: string;
}

/** Recent activity for the home feed. Public viewers get event types only, never who did it. */
export function activityFeed(ctx: LeagueCtx, limit = 10): ActivityItem[] {
  const store = getStore();
  const slug = ctx.league.slug;
  const seasonSlug = ctx.season?.slug;
  return store.read((db) => {
    const items: ActivityItem[] = [];
    const nameOf = (a: { userName: string }) => (ctx.isMember ? a.userName : "The commissioner");
    for (const a of db.audit.filter((x) => x.leagueId === ctx.league.id && (!ctx.season || x.seasonId === ctx.season.id || x.seasonId == null)).sort((x, y) => y.at.localeCompare(x.at))) {
      const m = a.entityType === "matchup" ? db.matchups.find((x) => x.id === a.entityId) : null;
      const wk = m?.weekNumber;
      if (a.action === "result.finalized" && m) items.push({ at: a.at, text: `Week ${wk} result finalized`, href: `/l/${slug}/matchup/${m.id}` });
      else if (a.action === "result.corrected" && m) items.push({ at: a.at, text: `Week ${wk} result corrected${ctx.isMember ? ` by ${nameOf(a)}` : ""}`, href: `/l/${slug}/matchup/${m.id}` });
      else if (a.action === "scores.saved" && m && ctx.isMember) items.push({ at: a.at, text: `${nameOf(a)} entered scores for week ${wk}`, href: `/l/${slug}/matchup/${m.id}` });
      else if (a.action === "schedule.generated") items.push({ at: a.at, text: "Schedule published", href: `/l/${slug}/schedule` });
      else if (a.action === "week.rescheduled") items.push({ at: a.at, text: "A week was rescheduled", href: seasonSlug ? `/l/${slug}/schedule` : undefined });
      else if (a.action === "rules.changed") items.push({ at: a.at, text: "League rules updated", href: `/l/${slug}/rules` });
      else if (a.action === "season.champion_decided") items.push({ at: a.at, text: "A champion was crowned", href: `/l/${slug}/history` });
    }
    for (const n of db.announcements.filter((x) => x.leagueId === ctx.league.id)) items.push({ at: n.createdAt, text: `Announcement: ${n.title}`, href: `/l/${slug}/news#${n.id}` });
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  });
}

/** Link suitable for sharing. Unlisted leagues get their access token embedded — only handed to members. */
export function shareHref(ctx: LeagueCtx, path: string): { path: string; note: string } {
  const l = ctx.league;
  if (l.visibility === "public") return { path, note: "Anyone with the link can view." };
  if (l.visibility === "unlisted") return ctx.isMember ? { path: `/l/${l.slug}/enter?t=${l.shareToken}&next=${encodeURIComponent(path)}`, note: "Anyone with this link can view (unlisted league)." } : { path, note: "" };
  return { path, note: "Private league: only members can open this link." };
}

import { buildSeasonModel } from "@/domain/engine";
import type { SeasonModel } from "@/domain/engine";
import { seasonData } from "./access";

/** Models for every season of the league, oldest first. The current season's cached model is reused. */
export function allModels(ctx: LeagueCtx): SeasonModel[] {
  const store = getStore();
  const seasons = [...ctx.seasons].sort((a, b) => a.year - b.year || a.createdAt.localeCompare(b.createdAt));
  return store.read((db) => seasons.map((s) => (ctx.season && s.id === ctx.season.id && ctx.model ? ctx.model : buildSeasonModel(seasonData(db, ctx.league.id, s.id)))));
}
