import Link from "next/link";
import { Activity, CalendarClock, Crown, Flame, Megaphone, Medal, Trophy } from "lucide-react";
import { computeAwards, type AwardResult } from "@/domain/awards";
import { fmt1 } from "@/domain/math";
import { generateInsights } from "@/domain/narrative";
import { computePlayoffRace, remainingPotential, type StandingRow } from "@/domain/standings";
import { bowlerSeasonStats, topWithTies } from "@/domain/stats";
import { Scoreboard } from "@/components/scoreboard";
import { StandingsTable } from "@/components/standings-table";
import { Avatar, Badge, Card, CardHead, EmptyState, Stat } from "@/components/ui";
import type { LeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { activityFeed, currentWeek, formatDate, formatDateTime, participant, recordsEntering, standingsRows } from "@/server/views";
import { ANNOUNCEMENT_CATEGORIES } from "@/server/services/content";

export const MODULE_SPAN: Record<string, "wide" | "half"> = {
  standings: "wide", matchups: "wide", results: "wide", news: "half", bowler_of_week: "half", leaders: "half", records: "wide", insights: "half", activity: "half",
};

function commissionerAwards(ctx: LeagueCtx) {
  return getStore().read((db) =>
    db.commissionerAwards.filter((a) => a.leagueId === ctx.league.id && a.seasonId === ctx.season?.id).map((a) => ({ id: a.id, title: a.title, recipientKind: a.recipientKind, recipientId: a.recipientId, note: a.note, week: a.week }))
  );
}

export function StandingsModule({ ctx }: { ctx: LeagueCtx }) {
  const rows = standingsRows(ctx);
  const m = ctx.model!;
  const race = ctx.cfg.playoffs.enabled ? computePlayoffRace(rows, ctx.cfg, (id) => remainingPotential(m, id, ctx.cfg)) : null;
  const played = rows.some((r) => r.played > 0);
  return (
    <Card>
      <CardHead title="Standings" icon={<Trophy size={14} />} right={<Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/standings`}>Full table →</Link>} />
      {rows.length === 0 ? (
        <EmptyState title="No teams yet">Add teams and bowlers, then generate a schedule from the Commissioner area.</EmptyState>
      ) : !played ? (
        <EmptyState title="Standings begin after the first finalized week">Official standings only count finalized results.</EmptyState>
      ) : (
        <>
          <StandingsTable ctx={ctx} rows={rows} race={race} compact limit={8} qualifiers={ctx.cfg.playoffs.enabled ? ctx.cfg.playoffs.qualifiers : undefined} />
          {ctx.cfg.playoffs.enabled ? <p className="muted border-t border-line px-3 py-2 text-xs">Top {ctx.cfg.playoffs.qualifiers} qualify for the playoffs (line shown below the last playoff spot). Clinched/out is only shown when mathematically certain.</p> : null}
        </>
      )}
    </Card>
  );
}

export function MatchupsModule({ ctx }: { ctx: LeagueCtx }) {
  const m = ctx.model!;
  const wk = currentWeek(ctx);
  const week = m.weekByNumber.get(wk);
  const results = m.results.filter((r) => r.weekNumber === wk && !r.official && !r.isBye);
  const rec = recordsEntering(ctx, wk);
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  return (
    <Card>
      <CardHead title={week ? `Up next · Week ${wk}${week.date ? ` · ${formatDate(week.date, { weekday: "short", month: "short", day: "numeric" })}` : ""}` : "Up next"} icon={<CalendarClock size={14} />} right={<Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/schedule`}>Schedule →</Link>} />
      {results.length === 0 ? (
        <EmptyState title="No upcoming matchups">{m.results.length ? "Every scheduled matchup has been finalized." : ctx.can("schedule.manage") ? "Generate a schedule in Commissioner → Schedule." : "The commissioner hasn't published a schedule yet."}</EmptyState>
      ) : (
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {results.map((r) => (
            <Scoreboard key={r.matchup.id} r={r} a={participant(ctx, r.a.participantId, kind)} b={participant(ctx, r.b!.participantId, kind)} recA={rec.get(r.a.participantId)} recB={rec.get(r.b!.participantId)} href={`/l/${ctx.league.slug}/matchup/${r.matchup.id}`} compact />
          ))}
        </div>
      )}
    </Card>
  );
}

export function ResultsModule({ ctx }: { ctx: LeagueCtx }) {
  const m = ctx.model!;
  const wk = m.lastOfficialWeek;
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const results = m.results.filter((r) => r.weekNumber === wk && r.official && !r.isBye);
  const rec = recordsEntering(ctx, wk);
  return (
    <Card>
      <CardHead title={wk ? `Latest results · Week ${wk}` : "Latest results"} icon={<Medal size={14} />} right={wk ? <Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/season/${ctx.season!.slug}/week/${wk}`}>Week recap →</Link> : null} />
      {results.length === 0 ? (
        <EmptyState title="No finalized results yet">Scores appear here once the commissioner finalizes a week.</EmptyState>
      ) : (
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {results.map((r) => (
            <Scoreboard key={r.matchup.id} r={r} a={participant(ctx, r.a.participantId, kind)} b={participant(ctx, r.b!.participantId, kind)} recA={rec.get(r.a.participantId)} recB={rec.get(r.b!.participantId)} href={`/l/${ctx.league.slug}/matchup/${r.matchup.id}`} compact />
          ))}
        </div>
      )}
    </Card>
  );
}

export async function NewsModule({ ctx }: { ctx: LeagueCtx }) {
  const items = await getStore().read((db) =>
    db.announcements.filter((a) => a.leagueId === ctx.league.id).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
  );
  return (
    <Card>
      <CardHead title="League news" icon={<Megaphone size={14} />} right={<Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/news`}>Archive →</Link>} />
      {items.length === 0 ? (
        <EmptyState title="No announcements yet">{ctx.can("announcements.post") ? "Post dates, schedule changes and recaps from Commissioner → News." : "Commissioner announcements will show up here."}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="px-3.5 py-3">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                {a.pinned ? <Badge tone="accent">PINNED</Badge> : null}
                <Badge>{ANNOUNCEMENT_CATEGORIES.find((c) => c.id === a.category)?.label}</Badge>
                <span className="faint text-xs">{formatDateTime(a.createdAt)} · {a.createdByName}</span>
              </div>
              <Link href={`/l/${ctx.league.slug}/news#${a.id}`} className="font-semibold hover:underline">{a.title}</Link>
              <p className="muted mt-0.5 line-clamp-2 text-[13px]">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

async function awardsFor(ctx: LeagueCtx, week: number | undefined): Promise<AwardResult[]> {
  return computeAwards(ctx.model!, ctx.league.awards, { week, commissioner: await commissionerAwards(ctx) });
}

export async function BowlerOfWeekModule({ ctx }: { ctx: LeagueCtx }) {
  const wk = ctx.model!.lastOfficialWeek;
  const award = wk ? (await awardsFor(ctx, wk)).find((a) => a.id === "bowler_of_week") : undefined;
  const disabled = ctx.league.awards.bowler_of_week?.enabled === false;
  if (disabled) return null;
  return (
    <Card>
      <CardHead title={`Bowler of the Week${wk ? ` · Week ${wk}` : ""}`} icon={<Crown size={14} />} />
      {!award ? (
        <EmptyState title="Not awarded yet">Needs a finalized week and bowlers with an average to measure against.</EmptyState>
      ) : (
        <div className="flex flex-col gap-3 p-3.5">
          {award.winners.map((w) => {
            const b = ctx.model!.bowlerById.get(w.id);
            return (
              <div key={w.id} className="flex items-center gap-3">
                <Avatar name={w.name} color={b?.avatarColor ?? "#64748b"} url={b?.avatarUrl} size={44} />
                <div className="min-w-0">
                  <Link href={`/l/${ctx.league.slug}/bowlers/${w.id}`} className="block truncate text-[15px] font-bold hover:underline">{w.name}</Link>
                  <div className="muted text-xs">{w.detail}</div>
                </div>
              </div>
            );
          })}
          <p className="faint text-[11px]">{award.qualification}</p>
        </div>
      )}
    </Card>
  );
}

export function LeadersModule({ ctx }: { ctx: LeagueCtx }) {
  const stats = bowlerSeasonStats(ctx.model!);
  const min = ctx.cfg.eligibility.minGamesForAwards;
  const avgLeaders = stats.filter((s) => s.games >= Math.max(1, min) && s.average != null).sort((a, b) => b.average! - a.average!).slice(0, 5);
  const hg = topWithTies(stats, (s) => s.highGame?.scratch ?? null);
  const hs = topWithTies(stats, (s) => s.highSeries?.scratch ?? null);
  return (
    <Card>
      <CardHead title="Scoring leaders" icon={<Flame size={14} />} right={<Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/stats`}>All stats →</Link>} />
      {avgLeaders.length === 0 ? (
        <EmptyState title="Leaders appear after a few games">Bowlers need at least {min} games to be ranked by average.</EmptyState>
      ) : (
        <>
          <table className="tbl">
            <caption className="sr-only">Top averages</caption>
            <thead><tr><th scope="col">Average</th><th scope="col">Avg</th><th scope="col">High G</th><th scope="col">High S</th></tr></thead>
            <tbody>
              {avgLeaders.map((s, i) => (
                <tr key={s.bowlerId}>
                  <td><Link href={`/l/${ctx.league.slug}/bowlers/${s.bowlerId}`} className="flex items-center gap-2 hover:underline"><span className="rank">{i + 1}</span><span className="truncate font-semibold">{s.name}</span></Link></td>
                  <td className="score">{fmt1(s.average)}</td>
                  <td className="num">{s.highGame?.scratch ?? "—"}</td>
                  <td className="num">{s.highSeries?.scratch ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="muted grid gap-0.5 border-t border-line px-3.5 py-2 text-xs">
            {hg ? <div>High game: <b className="text-fg num">{hg.value}</b> — {hg.holders.map((h) => h.name).join(", ")}</div> : null}
            {hs ? <div>High series: <b className="text-fg num">{hs.value}</b> — {hs.holders.map((h) => h.name).join(", ")}</div> : null}
          </div>
        </>
      )}
    </Card>
  );
}

export async function RecordsModule({ ctx }: { ctx: LeagueCtx }) {
  const m = ctx.model!;
  const awards = await awardsFor(ctx, undefined);
  const get = (id: string) => awards.find((a) => a.id === id);
  const official = m.results.filter((r) => r.official && !r.isBye && !r.forfeitBy && r.complete);
  const biggest = topWithTies(official.filter((r) => r.winner && r.winner !== "tie"), (r) => r.margin);
  const bigName = biggest ? biggest.holders.map((r) => participant(ctx, r.winner === "A" ? r.a.participantId : r.b!.participantId, ctx.cfg.format === "individual" ? "individual" : "team").name).join(", ") : null;
  const hg = get("high_game");
  const hs = get("high_series");
  const closest = get("closest_matchup");
  const improved = get("most_improved");
  const stats = bowlerSeasonStats(m);
  const allGames = stats.reduce((t, s) => t + s.games, 0);
  const leagueAvg = allGames ? stats.reduce((t, s) => t + s.pins, 0) / allGames : null;
  const tiles: { label: string; value: string; sub: string; href?: string }[] = [];
  if (hg) tiles.push({ label: "Highest game", value: String(hg.winners.length ? hg.summary.replace(/^.*: /, "") : ""), sub: hg.winners.map((w) => w.name).join(", ") });
  if (hs) tiles.push({ label: "Highest series", value: hs.summary.replace(/^.*: /, ""), sub: hs.winners.map((w) => w.name).join(", ") });
  if (biggest && biggest.value > 0) tiles.push({ label: "Biggest weekly win", value: `${biggest.value} ${biggest.value === 1 ? "pin" : "pins"}`, sub: bigName ?? "", href: `/l/${ctx.league.slug}/matchup/${biggest.holders[0].matchup.id}` });
  if (closest) tiles.push({ label: "Closest matchup", value: closest.summary.replace(/^.*: /, "").replace(/^1 pins$/, "1 pin"), sub: closest.winners[0].name, href: closest.winners[0].matchupId ? `/l/${ctx.league.slug}/matchup/${closest.winners[0].matchupId}` : undefined });
  if (improved) tiles.push({ label: "Most improved", value: improved.winners[0].detail.split(":")[0], sub: improved.winners.map((w) => w.name).join(", ") });
  if (leagueAvg != null) tiles.push({ label: "League scoring average", value: fmt1(leagueAvg), sub: `${allGames} games bowled` });
  return (
    <Card>
      <CardHead title="Season highlights" icon={<Trophy size={14} />} right={<Link className="text-[var(--accent)]" href={`/l/${ctx.league.slug}/stats?tab=records`}>Record book →</Link>} />
      {tiles.length === 0 ? (
        <EmptyState title="Highlights appear as results come in">Highest game, biggest win and closest matchup are calculated from finalized scores only.</EmptyState>
      ) : (
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-3">
          {tiles.map((t) => (<Stat key={t.label} label={t.label} value={t.value} sub={t.sub} href={t.href} />))}
        </div>
      )}
    </Card>
  );
}

export function InsightsModule({ ctx }: { ctx: LeagueCtx }) {
  const insights = generateInsights(ctx.model!).slice(0, 5);
  return (
    <Card>
      <CardHead title="Statistical insights" icon={<Flame size={14} />} />
      {insights.length === 0 ? (
        <EmptyState title="Nothing notable yet">Insights like streaks and average trends appear once enough results are in. Each shows the numbers behind it.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {insights.map((i) => (
            <li key={i.id} className="px-3.5 py-2.5">
              <div className="text-[13px] font-medium">{i.text}</div>
              <details className="mt-0.5"><summary className="faint cursor-pointer text-[11px] hover:text-muted">How we know</summary><ul className="muted mt-1 list-disc pl-4 text-xs">{i.support.map((s, k) => (<li key={k} className="num">{s}</li>))}</ul></details>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export async function ActivityModule({ ctx }: { ctx: LeagueCtx }) {
  const items = await activityFeed(ctx, 8);
  return (
    <Card>
      <CardHead title="Recent activity" icon={<Activity size={14} />} />
      {items.length === 0 ? (
        <EmptyState title="No activity yet">Scores entered, results finalized and announcements will appear here.</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((i, k) => (
            <li key={k} className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px]">
              {i.href ? <Link href={i.href} className="hover:underline">{i.text}</Link> : <span>{i.text}</span>}
              <span className="faint shrink-0 text-xs">{formatDateTime(i.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export const MODULES: Record<string, (p: { ctx: LeagueCtx }) => React.ReactNode> = {
  standings: StandingsModule, matchups: MatchupsModule, results: ResultsModule, news: NewsModule, bowler_of_week: BowlerOfWeekModule,
  leaders: LeadersModule, records: RecordsModule, insights: InsightsModule, activity: ActivityModule,
};

export type { StandingRow };
