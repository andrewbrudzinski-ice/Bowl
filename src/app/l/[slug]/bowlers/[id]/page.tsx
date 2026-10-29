import Link from "next/link";
import { notFound } from "next/navigation";
import { calculateHandicap } from "@/domain/handicap";
import { fmt1, fmtPts, stdDev } from "@/domain/math";
import { generateInsights } from "@/domain/narrative";
import { buildRecordBook } from "@/domain/records";
import { computeRivalries } from "@/domain/rivalry";
import { bowlerSeasonStats } from "@/domain/stats";
import { Trend } from "@/components/charts";
import { chartColor } from "@/components/chart-colors";
import { ShareBar } from "@/components/share-bar";
import { Avatar, Badge, Card, CardHead, EmptyState, KV, Stat, Tabs } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { allModels, formatDate, participant, shareHref } from "@/server/views";
import { seasonParam } from "@/components/links";

export const metadata = { title: "Bowler" };

export default async function BowlerProfile({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ season?: string; view?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) notFound();
  const m = ctx.model;
  const bowler = m.bowlerById.get(id);
  if (!bowler) notFound();
  const career = sp.view === "career";
  const sq = seasonParam(ctx);
  const base = `/l/${slug}/bowlers/${id}`;
  const stats = bowlerSeasonStats(m).find((s) => s.bowlerId === id);
  const models = await allModels(ctx);
  const perSeason = models.map((mm) => ({ mm, st: bowlerSeasonStats(mm).find((s) => s.bowlerId === id) })).filter((x) => x.st && (x.st.games > 0 || mm_has(x.mm, id)));
  function mm_has(mm: (typeof models)[number], bid: string) { return mm.data.roster.some((r) => r.bowlerId === bid); }
  const share = shareHref(ctx, `${base}${sq ? `?season=${sq}` : ""}`);
  const entries = m.data.roster.filter((r) => r.bowlerId === id).sort((a, b) => a.fromWeek - b.fromWeek);
  const team = stats?.teamId ? m.teamById.get(stats.teamId) : null;
  const nextWeek = Math.max(1, m.lastOfficialWeek + 1);
  const hc = entries.length ? m.handicapAt(id, nextWeek) : null;
  const hcfg = m.configForWeek(nextWeek).handicap;
  const nights = stats?.nightsLog ?? [];
  const insights = generateInsights(m).filter((i) => i.subjectId === id);
  const book = buildRecordBook(models);
  const myRecords = book.filter((r) => r.holders.some((h) => h.holderId === id));
  const rivalries = ctx.cfg.format === "individual" ? computeRivalries(models, "individual", id, ctx.season.id) : [];
  const sd = stats?.stdDev;

  // charts
  const avgData = (stats?.progression ?? []).map((p) => ({ week: p.week, Average: Math.round(p.average * 10) / 10 }));
  const perfData = nights.map((n) => ({ week: n.week, Scratch: n.scratchSeries, Adjusted: n.adjustedSeries }));
  const hdcpHistory = entries.length ? Array.from({ length: nextWeek }, (_, i) => i + 1).filter((w) => w <= (m.data.weeks.length || nextWeek)).map((w) => ({ w, h: m.handicapAt(id, w) })) : [];
  const careerTotals = perSeason.reduce((t, x) => ({ games: t.games + x.st!.games, pins: t.pins + x.st!.pins, hg: Math.max(t.hg, x.st!.highGame?.scratch ?? 0), hs: Math.max(t.hs, x.st!.highSeries?.scratch ?? 0) }), { games: 0, pins: 0, hg: 0, hs: 0 });

  return (
    <div className="grid gap-6 md:gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-4">
          <Avatar name={bowler.name} color={bowler.avatarColor} url={bowler.avatarUrl} size={64} />
          <div className="min-w-0">
            <div className="eyebrow">{career ? "Career" : ctx.season.name}</div>
            <h1 className="h-page">{bowler.name}{bowler.nickname ? <span className="muted font-medium"> “{bowler.nickname}”</span> : null}</h1>
            <div className="muted mt-0.5 flex flex-wrap items-center gap-2 text-[13px]">
              {team ? <Link className="hover:underline" href={participant(ctx, team.id, "team", sq).href}>{team.name}</Link> : <span>{stats?.isSub ? "Substitute" : "No team"}</span>}
              {stats?.isSub ? <Badge>SUB</Badge> : null}
              {!bowler.active ? <Badge tone="warn">INACTIVE</Badge> : null}
              {ctx.can("roster.manage") ? <Link className="text-[var(--accent-text)]" href={`/l/${slug}/admin/roster`}>Manage</Link> : null}
            </div>
          </div>
        </div>
        <ShareBar path={share.path} title={`${bowler.name} — ${ctx.league.name}`} note={share.note} />
      </div>

      <Tabs current={career ? "career" : "season"} items={[{ key: "season", label: ctx.season.name, href: `${base}${sq ? `?season=${sq}` : ""}` }, { key: "career", label: "Career", href: `${base}?view=career` }]} />

      {career ? (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Career average" value={careerTotals.games ? fmt1(careerTotals.pins / careerTotals.games) : "—"} sub={`${careerTotals.games} games`} />
            <Stat label="Total pins" value={careerTotals.pins.toLocaleString()} sub={`${perSeason.length} season${perSeason.length === 1 ? "" : "s"}`} />
            <Stat label="High game" value={careerTotals.hg || "—"} />
            <Stat label="High series" value={careerTotals.hs || "—"} />
          </div>
          <Card>
            <CardHead title="Season by season" />
            {perSeason.length === 0 ? <EmptyState title="No career data yet" /> : (
              <div className="tbl-wrap"><table className="tbl tbl-sticky"><thead><tr><th scope="col">Season</th><th scope="col" className="!text-left">Team</th><th scope="col">Avg</th><th scope="col">Ent</th><th scope="col">Gms</th><th scope="col">High G</th><th scope="col">High S</th></tr></thead>
                <tbody>{[...perSeason].reverse().map(({ mm, st }) => {
                  const entry = mm.data.roster.filter((r) => r.bowlerId === id).sort((a, b) => b.fromWeek - a.fromWeek)[0];
                  const teams = [...new Set(mm.data.roster.filter((r) => r.bowlerId === id && r.teamId).map((r) => mm.teamById.get(r.teamId!)?.name))].join(" → ");
                  return <tr key={mm.data.season.id}><td><Link className="font-semibold hover:underline" href={`${base}?season=${mm.data.season.slug}`}>{mm.data.season.name}</Link></td><td className="l muted">{teams || (entry?.isSub ? "Sub" : "—")}</td><td className="score">{fmt1(st!.average)}</td><td className="num muted">{entry?.enteringAverage ?? "—"}</td><td className="num">{st!.games}</td><td className="num">{st!.highGame?.scratch ?? "—"}</td><td className="num">{st!.highSeries?.scratch ?? "—"}</td></tr>;
                })}</tbody></table></div>
            )}
          </Card>
          <Card>
            <CardHead title="Records held" right={<Link className="text-[var(--accent-text)]" href={`/l/${slug}/stats?tab=records`}>Record book →</Link>} />
            {myRecords.length === 0 ? <EmptyState title="No league records held" /> : <ul className="divide-y divide-line">{myRecords.map((r) => <li key={r.key} className="flex justify-between gap-3 px-5 py-2 text-[13px]"><span>{r.title}{r.holders.length > 1 ? <span className="muted"> (tied)</span> : null}</span><span className="num font-semibold">{r.holders.find((h) => h.holderId === id)?.detail}</span></li>)}</ul>}
          </Card>
        </>
      ) : !stats || !entries.length ? (
        <Card><EmptyState title="Not on this season's roster">{perSeason.length ? "Switch seasons or open the career view to see this bowler's history." : "This bowler hasn't been added to a season yet."}</EmptyState></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
            <Stat label="Season average" value={fmt1(stats.average)} sub={`${stats.games} games`} />
            <Stat label="Entering avg" value={entries[0].enteringAverage ?? "—"} />
            {ctx.cfg.handicap.enabled ? <Stat label={`Handicap · wk ${nextWeek}`} value={hc?.breakdown.handicap ?? "—"} sub="per game" /> : null}
            <Stat label="Total pins" value={stats.pins ? stats.pins.toLocaleString() : "—"} />
            <Stat label="High game" value={stats.highGame?.scratch ?? "—"} sub={stats.highGame ? `Week ${stats.highGame.week}` : undefined} href={stats.highGame ? `/l/${slug}/matchup/${stats.highGame.matchupId}` : undefined} />
            <Stat label="High series" value={stats.highSeries?.scratch ?? "—"} sub={stats.highSeries ? `Week ${stats.highSeries.week}` : undefined} href={stats.highSeries ? `/l/${slug}/matchup/${stats.highSeries.matchupId}` : undefined} />
          </div>

          {hc && ctx.cfg.handicap.enabled ? (
            <Card>
              <CardHead title={`Handicap for week ${nextWeek}`} right={<Link className="text-[var(--accent-text)]" href={`/l/${slug}/rules`}>League formula →</Link>} />
              <div className="grid gap-3 p-5 md:grid-cols-2">
                <div>
                  <div className="num text-[15px] font-semibold">{hc.breakdown.formula}</div>
                  <ul className="muted mt-2 list-disc pl-4 text-[13px]">{hc.breakdown.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
                </div>
                <dl>
                  <KV k="Average used">{hc.average.average ?? "—"}</KV>
                  <KV k="Where it comes from">{hc.average.note}</KV>
                  <KV k="Base average">{hc.base.base} <span className="faint">({hc.base.note})</span></KV>
                  <KV k="Handicap series (3 games)">{hc.breakdown.handicap * m.configForWeek(nextWeek).scoring.gamesPerSession}</KV>
                </dl>
              </div>
            </Card>
          ) : null}

          {avgData.length ? (
            <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
              <Card><CardHead title="Average progression" /><div className="p-5"><Trend data={avgData} series={[{ key: "Average", label: "Season average", color: chartColor(0) }]} summary={`${bowler.name}'s cumulative scratch average after each week.`} refLine={entries[0].enteringAverage ? { y: entries[0].enteringAverage, label: "Entering" } : undefined} yDomain={["auto", "auto"]} /></div></Card>
              <Card><CardHead title="Scratch vs handicap-adjusted series" /><div className="p-5"><Trend data={perfData} series={[{ key: "Scratch", label: "Scratch series", color: chartColor(3) }, ...(ctx.cfg.handicap.enabled ? [{ key: "Adjusted", label: "Adjusted series", color: chartColor(2), dashed: true }] : [])]} summary={`${bowler.name}'s series total each week, scratch and handicap-adjusted.`} /></div></Card>
            </div>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
            <Card>
              <CardHead title="Recent results" />
              {nights.length === 0 ? <EmptyState title="No finalized games yet" /> : (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Wk</th><th scope="col" className="!text-left">Opp</th><th scope="col">Games</th><th scope="col">Ser</th>{ctx.cfg.handicap.enabled ? <th scope="col">Adj</th> : null}<th scope="col">±Avg</th></tr></thead>
                  <tbody>{[...nights].reverse().slice(0, 8).map((n) => { const diff = n.average != null ? n.scratchSeries - n.games.length * n.average : null; return (
                    <tr key={n.matchupId}><td><Link className="hover:underline" href={`/l/${slug}/matchup/${n.matchupId}`}>{n.week}</Link></td><td className="l muted">{n.opponentId ? (ctx.cfg.format === "individual" ? m.bowlerById.get(n.opponentId)?.name : m.teamById.get(n.opponentId)?.name) : "—"}</td><td className="num">{n.games.map((g) => g.scratch).join(" · ")}</td><td className="score">{n.scratchSeries}</td>{ctx.cfg.handicap.enabled ? <td className="num">{n.adjustedSeries}</td> : null}<td className="num">{diff == null ? "—" : `${diff >= 0 ? "+" : ""}${Math.round(diff)}`}</td></tr>); })}</tbody></table></div>
              )}
            </Card>
            <Card>
              <CardHead title="Personal bests & season records" />
              <dl className="px-5 py-1">
                <KV k="High game (scratch)">{stats.highGame ? `${stats.highGame.scratch} · wk ${stats.highGame.week}` : "—"}</KV>
                <KV k="High series (scratch)">{stats.highSeries ? `${stats.highSeries.scratch} · wk ${stats.highSeries.week}` : "—"}</KV>
                {ctx.cfg.handicap.enabled ? <KV k="High game (handicap)">{stats.highGameAdj ? `${stats.highGameAdj.adjusted} · wk ${stats.highGameAdj.week}` : "—"}</KV> : null}
                {ctx.cfg.handicap.enabled ? <KV k="High series (handicap)">{stats.highSeriesAdj ? `${stats.highSeriesAdj.adjusted} · wk ${stats.highSeriesAdj.week}` : "—"}</KV> : null}
                <KV k="Consistency (std. dev.)">{sd == null ? "—" : `${sd.toFixed(1)} pins`}</KV>
                <KV k="Nights bowled">{stats.nights}</KV>
                {stats.record ? <KV k="Head-to-head record">{`${stats.record.wins}-${stats.record.losses}${stats.record.ties ? `-${stats.record.ties}` : ""}`}</KV> : <KV k="Team record">See <Link className="underline" href={team ? participant(ctx, team.id, "team", sq).href : "#"}>{team?.name ?? "team"}</Link></KV>}
                <KV k="Records held">{myRecords.length ? myRecords.map((r) => r.title).join(", ") : "None"}</KV>
              </dl>
            </Card>
          </div>

          {insights.length ? (
            <Card><CardHead title="Insights" /><ul className="divide-y divide-line">{insights.map((i) => <li key={i.id} className="px-5 py-2.5"><div className="text-[13px] font-medium">{i.text}</div><div className="muted mt-0.5 text-[13px]">{i.support.join(" · ")}</div></li>)}</ul></Card>
          ) : null}

          <div className="grid gap-6 lg:grid-cols-2 lg:gap-8">
            <Card>
              <CardHead title="Handicap history" />
              {!ctx.cfg.handicap.enabled ? <EmptyState title="Handicap isn't used in this league" /> : (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Week</th><th scope="col">Avg used</th><th scope="col">Hdcp</th><th scope="col" className="!text-left">Basis</th></tr></thead>
                  <tbody>{hdcpHistory.map(({ w, h }) => <tr key={w}><td>{w}</td><td className="num">{h.average.average ?? "—"}</td><td className="score">{h.breakdown.handicap}</td><td className="l muted max-w-[200px] truncate" title={h.average.note}>{h.average.source.replace(/_/g, " ")}</td></tr>)}</tbody></table></div>
              )}
            </Card>
            <Card>
              <CardHead title="Team history" />
              <ul className="divide-y divide-line">{entries.map((e) => <li key={e.id} className="flex justify-between gap-3 px-5 py-2 text-[13px]"><span>{e.teamId ? m.teamById.get(e.teamId)?.name : e.isSub ? "Substitute" : "No team"}</span><span className="muted num">Weeks {e.fromWeek}–{e.toWeek ?? "now"}</span></li>)}</ul>
              <p className="faint border-t border-line px-5 py-2 text-[12px]">Past results always stay with the team the bowler bowled for that week.</p>
            </Card>
          </div>

          {ctx.cfg.format === "individual" ? (
            <Card>
              <CardHead title="Rivalries" />
              {rivalries.length === 0 ? <EmptyState title="No head-to-head history yet">Rivalries appear after official matchups against the same opponent.</EmptyState> : (
                <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col">Opponent</th><th scope="col">All-time</th><th scope="col">This season</th><th scope="col">Avg series</th><th scope="col">High G</th><th scope="col">Largest win</th><th scope="col">Closest</th></tr></thead>
                  <tbody>{rivalries.slice(0, 8).map((r) => <tr key={r.opponentId}><td><Link className="font-semibold hover:underline" href={`/l/${slug}/bowlers/${r.opponentId}`}>{m.bowlerById.get(r.opponentId)?.name ?? "?"}</Link></td><td className="num">{r.allTime.w}-{r.allTime.l}{r.allTime.t ? `-${r.allTime.t}` : ""}</td><td className="num">{r.currentSeason.w}-{r.currentSeason.l}</td><td className="num">{fmt1(r.avgSeries)} / {fmt1(r.avgOpponentSeries)}</td><td className="num">{r.highGame ?? "—"}</td><td className="num">{r.largestWin?.margin ?? "—"}</td><td className="num">{r.closestFinish?.margin ?? "—"}</td></tr>)}</tbody></table></div>
              )}
            </Card>
          ) : null}
          <p className="faint text-[13px]">Last updated through week {m.lastOfficialWeek || 0}. Only finalized results are included.</p>
        </>
      )}
    </div>
  );
}
