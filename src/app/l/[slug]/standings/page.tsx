import Link from "next/link";
import { TIEBREAKER_LABELS } from "@/domain/config";
import { computePlayoffRace, remainingPotential, standingsProgression } from "@/domain/standings";
import { Trend } from "@/components/charts";
import { ShareBar } from "@/components/share-bar";
import { StandingsTable } from "@/components/standings-table";
import { Alert, Card, CardHead, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { participant, shareHref } from "@/server/views";
import { computeStandings } from "@/domain/standings";
import { seasonParam } from "@/components/links";

export const metadata = { title: "Standings" };
const PALETTE = ["#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f43f5e", "#facc15", "#2dd4bf", "#fb7185", "#60a5fa", "#c084fc", "#4ade80", "#fbbf24"];

export default async function Standings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; view?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const cfg = ctx.cfg;
  const both = cfg.format === "both";
  const view = both && sp.view === "bowlers" ? "bowler" : cfg.format === "individual" ? "bowler" : "team";
  const sq = seasonParam(ctx);
  const { rows } = computeStandings(m, { scope: view });
  const race = view === "team" && cfg.playoffs.enabled ? computePlayoffRace(rows, cfg, (id) => remainingPotential(m, id, cfg)) : view === "bowler" && cfg.format === "individual" && cfg.playoffs.enabled ? computePlayoffRace(rows, cfg, (id) => remainingPotential(m, id, cfg)) : null;
  const prog = standingsProgression(m, view);
  const kind = view === "team" ? "team" : "individual";
  const chart = prog.weeks.map((w) => ({ week: w.week, ...Object.fromEntries(prog.ids.map((id) => [id, w.ranks[id] ?? null])) }));
  const series = prog.ids.slice(0, 12).map((id, i) => ({ key: id, label: participant(ctx, id, kind).name, color: PALETTE[i % PALETTE.length] }));
  const share = shareHref(ctx, `/l/${slug}/standings${sq ? `?season=${sq}` : ""}`);
  const ties = rows.filter((r) => r.reason && !r.reason.startsWith("Fewer"));
  const played = rows.some((r) => r.played > 0);
  return (
    <div>
      <PageHeader title="Standings" eyebrow={ctx.season.name} sub={cfg.standings.includeProvisional ? "Provisional results are included in these standings." : "Only finalized results count toward official standings."} actions={<ShareBar path={share.path} title={`${ctx.league.name} standings`} note={share.note} />} />
      {both ? <Tabs current={view} items={[{ key: "team", label: "Teams", href: `/l/${slug}/standings${sq ? `?season=${sq}` : ""}` }, { key: "bowler", label: "Bowlers", href: `/l/${slug}/standings?view=bowlers${sq ? `&season=${sq}` : ""}` }]} /> : null}
      <div className="grid gap-4">
        <Card>
          {rows.length === 0 || !played ? <EmptyState title="Standings start after the first finalized week">Scores only count once the commissioner finalizes them.</EmptyState> : <StandingsTable ctx={ctx} rows={rows} race={race} qualifiers={cfg.playoffs.enabled ? cfg.playoffs.qualifiers : undefined} seasonQ={sq} />}
        </Card>
        {played ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead title="How teams are ranked" />
              <div className="grid gap-2 p-3.5 text-[13px]">
                <ol className="list-decimal pl-5">{cfg.standings.tiebreakers.map((t) => <li key={t}>{TIEBREAKER_LABELS[t]}</li>)}<li>Alphabetical (final deterministic fallback)</li></ol>
                {ties.length ? <div className="border-t border-line pt-2"><div className="eyebrow mb-1">Tie-breaks in effect</div><ul className="grid gap-1">{ties.map((r) => <li key={r.id}><b>{r.name}</b> <span className="muted">is below the team above: {r.reason?.toLowerCase()}</span></li>)}</ul></div> : <p className="muted">No ties need breaking right now.</p>}
                {cfg.playoffs.enabled ? (
                  <Alert tone="info">Top {cfg.playoffs.qualifiers} qualify. “Clinched” and “Out” appear only when no combination of remaining results could change the outcome{cfg.standings.tiebreakers[0] !== "points" && cfg.standings.tiebreakers[0] !== "wins" ? " — with this ranking rule (pins/averages) that can't be proven early, so only “In” and “Bubble” are shown" : ""}.</Alert>
                ) : <p className="faint text-xs">This league has no playoffs, so only regular-season standings are shown.</p>}
              </div>
            </Card>
            <Card>
              <CardHead title="Rank progression by week" />
              <div className="p-3">
                <Trend data={chart} series={series} reversed yDomain={[1, Math.max(2, rows.length)]} integerY summary={`Weekly rank for each ${view === "team" ? "team" : "bowler"}; 1 is first place.`} height={260} />
              </div>
            </Card>
          </div>
        ) : null}
        <p className="faint text-xs">Win% counts a tie as half a win. GB = points behind first place. <Link className="underline" href={`/l/${slug}/rules`}>See the full scoring rules</Link>.</p>
      </div>
    </div>
  );
}
