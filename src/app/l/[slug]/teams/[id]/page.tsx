import Link from "next/link";
import { notFound } from "next/navigation";
import { fmt1, fmtPts } from "@/domain/math";
import { computeRivalries } from "@/domain/rivalry";
import { computeStandings, standingsProgression } from "@/domain/standings";
import { bowlerSeasonStats, collectTeamNights } from "@/domain/stats";
import { Trend } from "@/components/charts";
import { ShareBar } from "@/components/share-bar";
import { Avatar, Card, CardHead, EmptyState, FormChips, KV, Stat, TeamMark } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { allModels, shareHref } from "@/server/views";
import { seasonParam } from "@/components/links";

export const metadata = { title: "Team" };

export default async function TeamPage({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) notFound();
  const m = ctx.model;
  const team = m.teamById.get(id);
  if (!team) notFound();
  const sq = seasonParam(ctx);
  const { rows } = computeStandings(m, { scope: "team" });
  const row = rows.find((r) => r.id === id);
  const prog = standingsProgression(m, "team");
  const stats = bowlerSeasonStats(m);
  const roster = m.data.roster.filter((r) => r.teamId === id).sort((a, b) => a.fromWeek - b.fromWeek);
  const nights = collectTeamNights(m).filter((t) => t.teamId === id);
  const models = await allModels(ctx);
  const rivals = computeRivalries(models, "team", id, ctx.season.id);
  const share = shareHref(ctx, `/l/${slug}/teams/${id}${sq ? `?season=${sq}` : ""}`);
  const results = m.results.filter((r) => r.matchup.kind === "team" && (r.a.participantId === id || r.b?.participantId === id));
  const chart = prog.weeks.map((w) => ({ week: w.week, Points: w.points[id] ?? null, Rank: w.ranks[id] ?? null }));
  const bestSeries = nights.length ? Math.max(...nights.map((n) => n.scratchSeries)) : null;
  const bestGame = nights.length ? Math.max(...nights.flatMap((n) => n.gameScratch)) : null;
  const history = models.map((mm) => { const rr = computeStandings(mm, { scope: "team" }).rows.find((x) => x.id === id); return rr && rr.played ? { season: mm.data.season, row: rr, champion: mm.data.season.championId === id } : null; }).filter(Boolean) as { season: (typeof models)[number]["data"]["season"]; row: NonNullable<typeof row>; champion: boolean }[];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4"><TeamMark name={team.name} color={team.color} logo={team.logo} size={56} /><div><div className="eyebrow">{ctx.season.name}</div><h1 className="h-page">{team.name}</h1>{!team.active ? <span className="badge badge-warn">INACTIVE</span> : null}</div></div>
        <ShareBar path={share.path} title={team.name} note={share.note} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-6">
        <Stat label="Rank" value={row?.played ? `#${row.rank}` : "—"} />
        <Stat label="Record" value={row ? `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}` : "0-0"} />
        <Stat label="Points" value={row ? fmtPts(row.points) : 0} />
        <Stat label="Game average" value={fmt1(row?.average)} sub="team game, standings basis" />
        <Stat label="Team high game" value={bestGame ?? "—"} sub="scratch" />
        <Stat label="Team high series" value={bestSeries ?? "—"} sub="scratch" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Roster" />
          {roster.length === 0 ? <EmptyState title="No bowlers on this team" /> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Bowler</th><th scope="col">Avg</th><th scope="col">Hdcp</th><th scope="col" className="!text-left">Weeks</th></tr></thead>
              <tbody>{roster.map((e) => { const b = m.bowlerById.get(e.bowlerId)!; const s = stats.find((x) => x.bowlerId === e.bowlerId); return <tr key={e.id}><td className="!pl-3"><Link href={`/l/${slug}/bowlers/${b.id}${sq ? `?season=${sq}` : ""}`} className="flex items-center gap-2 hover:underline"><Avatar name={b.name} color={b.avatarColor} url={b.avatarUrl} size={24} /><span className="font-semibold">{b.name}</span>{e.isSub ? <span className="badge">SUB</span> : null}</Link></td><td className="num">{fmt1(s?.average)}</td><td className="num">{e.toWeek == null ? (s?.currentHandicap ?? "—") : "—"}</td><td className="l muted">{e.fromWeek}–{e.toWeek ?? "now"}</td></tr>; })}</tbody></table></div>
          )}
          <p className="faint border-t border-line px-3.5 py-2 text-[11px]">Bowlers who moved teams appear with the weeks they bowled here; their earlier results stay with their earlier team.</p>
        </Card>
        <Card>
          <CardHead title="Points & rank by week" />
          <div className="p-3">{chart.length ? <Trend data={chart} series={[{ key: "Points", label: "Points", color: "#38bdf8" }, { key: "Rank", label: "Rank (1 = first)", color: "#f97316", dashed: true }]} summary={`${team.name} cumulative points and rank after each week.`} /> : <EmptyState title="No results yet" />}</div>
        </Card>
      </div>
      <Card>
        <CardHead title="Results" right={row ? <FormChips form={row.form} /> : null} />
        {results.length === 0 ? <EmptyState title="Nothing scheduled yet" /> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Wk</th><th scope="col" className="!text-left">Opponent</th><th scope="col" className="!text-left">Result</th><th scope="col">Series</th><th scope="col">Pts</th></tr></thead>
            <tbody>{results.map((r) => { const me = r.a.participantId === id ? r.a : r.b!; const opp = r.a.participantId === id ? r.b : r.a; const out = !r.official ? "—" : r.winner === "tie" ? "T" : r.winner === me.side ? "W" : "L"; return <tr key={r.matchup.id}><td className="!pl-3">{r.weekNumber}</td><td className="l">{opp ? <Link className="hover:underline" href={`/l/${slug}/teams/${opp.participantId}${sq ? `?season=${sq}` : ""}`}>{m.teamById.get(opp.participantId)?.name}</Link> : "Bye"}</td><td className="l"><Link className="hover:underline" href={`/l/${slug}/matchup/${r.matchup.id}`}>{r.isBye ? "Bye" : r.official ? `${out} · ${r.matchup.state === "corrected" ? "corrected" : "final"}` : "Not final"}</Link></td><td className="num">{r.official && !r.isBye ? `${me.basisSeries}–${opp?.basisSeries}` : "—"}</td><td className="num">{r.official ? fmtPts(me.points) : "—"}</td></tr>; })}</tbody></table></div>
        )}
      </Card>
      <Card>
        <CardHead title="Rivalries" right={<span className="muted text-xs">Official results only</span>} />
        {rivals.length === 0 ? <EmptyState title="No head-to-head history yet">Nothing is shown until teams have met in finalized matchups.</EmptyState> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Opponent</th><th scope="col">All-time</th><th scope="col">This season</th><th scope="col">Last five</th><th scope="col">Avg series (us / them)</th><th scope="col">High game</th><th scope="col">High series</th><th scope="col">Largest win</th><th scope="col">Closest</th></tr></thead>
            <tbody>{rivals.map((r) => <tr key={r.opponentId}><td className="!pl-3"><Link className="font-semibold hover:underline" href={`/l/${slug}/teams/${r.opponentId}`}>{m.teamById.get(r.opponentId)?.name ?? "Former team"}</Link></td><td className="num">{r.allTime.w}-{r.allTime.l}{r.allTime.t ? `-${r.allTime.t}` : ""}</td><td className="num">{r.currentSeason.w}-{r.currentSeason.l}{r.currentSeason.t ? `-${r.currentSeason.t}` : ""}</td><td><FormChips form={r.lastFive.map((x) => x.outcome)} /></td><td className="num">{fmt1(r.avgSeries)} / {fmt1(r.avgOpponentSeries)}</td><td className="num">{r.highGame ?? "—"}</td><td className="num">{r.highSeries ?? "—"}</td><td className="num">{r.largestWin ? <Link className="hover:underline" href={`/l/${slug}/matchup/${r.largestWin.matchupId}`}>{r.largestWin.margin}</Link> : "—"}</td><td className="num">{r.closestFinish ? <Link className="hover:underline" href={`/l/${slug}/matchup/${r.closestFinish.matchupId}`}>{r.closestFinish.margin}</Link> : "—"}</td></tr>)}</tbody></table></div>
        )}
        {rivals.some((r) => r.bySeason.length > 1) ? <details className="border-t border-line px-3.5 py-2 text-[13px]"><summary className="muted cursor-pointer">Results by season</summary><ul className="mt-2 grid gap-1">{rivals.filter((r) => r.bySeason.length > 1).map((r) => <li key={r.opponentId}><b>{m.teamById.get(r.opponentId)?.name}</b>: {r.bySeason.map((s) => `${s.seasonName} ${s.w}-${s.l}${s.t ? `-${s.t}` : ""}`).join(" · ")}</li>)}</ul></details> : null}
      </Card>
      <Card>
        <CardHead title="Team history" />
        {history.length === 0 ? <EmptyState title="No finished seasons" /> : <dl className="px-3.5 py-1">{history.map((h) => <KV key={h.season.id} k={h.season.name}>{`#${h.row.rank} · ${h.row.wins}-${h.row.losses} · ${fmtPts(h.row.points)} pts`}{h.champion ? " 🏆 Champion" : ""}</KV>)}</dl>}
      </Card>
    </div>
  );
}
