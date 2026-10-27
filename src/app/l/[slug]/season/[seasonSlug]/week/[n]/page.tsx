import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { computeAwards } from "@/domain/awards";
import { weekRecap } from "@/domain/narrative";
import { buildRecordBook, recordsBrokenInWeek } from "@/domain/records";
import { Scoreboard } from "@/components/scoreboard";
import { ShareBar } from "@/components/share-bar";
import { StandingsTable } from "@/components/standings-table";
import { Badge, Card, CardHead, EmptyState } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { formatDate, participant, recordsEntering, shareHref, standingsRows } from "@/server/views";
import { getStore } from "@/server/db";
import { buildSeasonModel } from "@/domain/engine";
import { seasonData } from "@/server/access";

export const metadata = { title: "Week" };

export default async function WeekPage({ params }: { params: Promise<{ slug: string; seasonSlug: string; n: string }> }) {
  const { slug, seasonSlug, n } = await params;
  const ctx = await getLeagueCtx(slug, seasonSlug);
  const wk = Number(n);
  if (!ctx.season || !ctx.model || !Number.isInteger(wk)) notFound();
  const model = ctx.model;
  const week = model.weekByNumber.get(wk);
  if (!week) notFound();
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const results = model.results.filter((r) => r.weekNumber === wk);
  const rec = recordsEntering(ctx, wk);
  const recap = weekRecap(model, wk);
  const awards = computeAwards(model, ctx.league.awards, { week: wk }).filter((a) => a.scope === "week" && a.source === "statistical" && ["bowler_of_week", "high_game", "high_series", "closest_matchup", "best_team_performance", "biggest_upset"].includes(a.id));
  const official = results.some((r) => r.official && !r.isBye);
  const allDone = results.filter((r) => !r.isBye).every((r) => r.official) && results.some((r) => !r.isBye);
  const weeks = [...model.data.weeks].sort((a, b) => a.number - b.number);
  const prev = weeks.find((w) => w.number === wk - 1);
  const next = weeks.find((w) => w.number === wk + 1);
  const records = official ? await getStore().read((db) => {
    const models = ctx.seasons.map((s) => (s.id === ctx.season!.id ? model : buildSeasonModel(seasonData(db, ctx.league.id, s.id))));
    return recordsBrokenInWeek(buildRecordBook(models), ctx.season!.id, wk);
  }, { leagueId: ctx.league.id }) : [];
  const rows = official ? standingsRows(ctx, wk) : [];
  const share = shareHref(ctx, `/l/${slug}/season/${seasonSlug}/week/${wk}`);
  const sq = ctx.seasons.find((s) => s.status === "active")?.slug === seasonSlug ? null : seasonSlug;
  const label = (r: (typeof results)[number]) => participant(ctx, r.a.participantId, kind).name;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {prev ? <Link className="btn btn-sm" href={`/l/${slug}/season/${seasonSlug}/week/${prev.number}`}><ChevronLeft size={14} />Week {prev.number}</Link> : <span className="btn btn-sm" aria-disabled style={{ opacity: .4 }}><ChevronLeft size={14} />Prev</span>}
          {next ? <Link className="btn btn-sm" href={`/l/${slug}/season/${seasonSlug}/week/${next.number}`}>Week {next.number}<ChevronRight size={14} /></Link> : <span className="btn btn-sm" aria-disabled style={{ opacity: .4 }}>Next<ChevronRight size={14} /></span>}
        </div>
        <ShareBar path={share.path} title={`${ctx.league.name} — Week ${wk}`} note={share.note} />
      </div>
      <div>
        <div className="eyebrow">{ctx.season.name}{week.phase === "playoff" ? " · Playoffs" : ""}</div>
        <h1 className="h-page mt-1">Week {wk} <span className="muted font-medium">· {formatDate(week.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</span></h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge tone={week.status === "completed" ? "win" : week.status === "postponed" ? "warn" : "neutral"}>{week.status === "completed" ? "WEEK COMPLETE" : week.status === "postponed" ? "POSTPONED" : week.status === "in_progress" ? "IN PROGRESS" : "UPCOMING"}</Badge>
          {week.label ? <span className="muted text-xs">{week.label}</span> : null}
        </div>
      </div>

      <nav className="pill-nav" aria-label="Weeks">
        {weeks.map((w) => <Link key={w.number} href={`/l/${slug}/season/${seasonSlug}/week/${w.number}`} className="tab !px-2.5" aria-current={w.number === wk ? "page" : undefined}>{w.phase === "playoff" ? `P${w.number - ctx.season!.regularWeeks}` : w.number}</Link>)}
      </nav>

      {results.length === 0 ? (
        <Card><EmptyState title="No matchups scheduled this week">{ctx.can("schedule.manage") ? <>Add matchups or generate a schedule in <Link className="underline" href={`/l/${slug}/admin/schedule`}>Commissioner → Schedule</Link>.</> : "Check back after the commissioner publishes the schedule."}</EmptyState></Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {results.map((r) => <Scoreboard key={r.matchup.id} r={r} a={participant(ctx, r.a.participantId, kind, sq)} b={r.b ? participant(ctx, r.b.participantId, kind, sq) : undefined} recA={rec.get(r.a.participantId)} recB={r.b ? rec.get(r.b.participantId) : undefined} href={`/l/${slug}/matchup/${r.matchup.id}`} />)}
        </div>
      )}

      {official ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHead title="Week highlights" />
            {recap.headlines.length === 0 && awards.length === 0 ? <EmptyState title="Nothing standout" /> : (
              <ul className="grid gap-2 p-3.5 text-[13.5px]">
                {recap.headlines.map((h, i) => <li key={i} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />{h.text}</li>)}
                {records.map((x, i) => <li key={`r${i}`} className="flex gap-2"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden /><span><b>{x.kind === "new" ? "New record" : "Record tied"}:</b> {x.item.title} — {x.event.holderName}, {x.event.detail}{x.kind === "tied" ? " (matches the standing mark)" : ""}</span></li>)}
              </ul>
            )}
          </Card>
          <Card>
            <CardHead title="Week awards" right={<Link className="text-[var(--accent)]" href={`/l/${slug}/stats?tab=awards`}>All awards →</Link>} />
            {awards.length === 0 ? <EmptyState title="No awards calculated" /> : (
              <ul className="divide-y divide-line">{awards.map((a) => (
                <li key={a.id} className="px-3.5 py-2.5"><div className="eyebrow">{a.name}</div><div className="text-[13.5px] font-semibold">{a.winners.map((w) => w.name).join(", ")}</div><div className="muted text-xs">{a.winners[0].detail}</div></li>
              ))}</ul>
            )}
          </Card>
        </div>
      ) : null}

      {official ? (
        <Card>
          <CardHead title={`Standings after week ${wk}`} right={allDone ? null : <Badge tone="warn">PARTIAL WEEK</Badge>} />
          <StandingsTable ctx={ctx} rows={rows} compact seasonQ={sq} qualifiers={ctx.cfg.playoffs.enabled ? ctx.cfg.playoffs.qualifiers : undefined} />
        </Card>
      ) : null}
      {recap.topSeries.length ? <p className="faint text-xs">Top series: {recap.topSeries.map((t) => `${model.bowlerById.get(t.bowlerId)?.name} ${t.scratchSeries}`).join(", ")} · High game: {recap.highGame.map((t) => `${model.bowlerById.get(t.bowlerId)?.name} ${t.score}`).join(", ")} · {results.map(label).length} matchups</p> : null}
    </div>
  );
}
