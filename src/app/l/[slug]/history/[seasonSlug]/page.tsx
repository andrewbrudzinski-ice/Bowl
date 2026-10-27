import Link from "next/link";
import { notFound } from "next/navigation";
import { Trophy } from "lucide-react";
import { championOf } from "@/domain/awards";
import { buildRecordBook } from "@/domain/records";
import { computePlayoffRace, computeStandings, remainingPotential } from "@/domain/standings";
import { bowlerSeasonStats } from "@/domain/stats";
import { fmt1 } from "@/domain/math";
import { StandingsTable } from "@/components/standings-table";
import { Badge, Card, CardHead, EmptyState, KV, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";

export const metadata = { title: "Season" };

export default async function SeasonHistory({ params }: { params: Promise<{ slug: string; seasonSlug: string }> }) {
  const { slug, seasonSlug } = await params;
  const ctx = await getLeagueCtx(slug, seasonSlug);
  if (!ctx.model || !ctx.season || ctx.season.slug !== seasonSlug) notFound();
  const m = ctx.model;
  const champ = championOf(m);
  const scope = ctx.cfg.format === "individual" ? "bowler" : "team";
  const { rows } = computeStandings(m, { scope });
  const race = null as ReturnType<typeof computePlayoffRace>;
  void remainingPotential;
  const stats = bowlerSeasonStats(m).filter((s) => s.games > 0).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const records = buildRecordBook([m]).filter((r) => r.category !== "career");
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number);
  const playoffs = m.results.filter((r) => m.weekByNumber.get(r.weekNumber)?.phase === "playoff" && !r.isBye);
  return (
    <div className="grid gap-4">
      <PageHeader title={ctx.season.name} eyebrow="Season archive" sub={`Rules, rosters and results exactly as they were — version ${ctx.season.ruleVersions[ctx.season.ruleVersions.length - 1].version} of the rules is shown on the rules page.`} actions={<><Link href={`/l/${slug}/rules?season=${seasonSlug}`} className="btn btn-sm">Season rules</Link><Link href={`/l/${slug}/schedule?season=${seasonSlug}`} className="btn btn-sm">Schedule & results</Link></>} />
      {champ ? <Card><div className="flex items-center gap-3 p-4"><Trophy className="text-warn" aria-hidden /><div><div className="eyebrow">Champion</div><div className="text-[18px] font-bold">{champ.name}</div><div className="muted text-xs">{champ.how}</div></div></div></Card> : null}
      <Card><CardHead title="Final standings" right={ctx.season.status === "completed" ? <Badge tone="win">FINAL</Badge> : <Badge tone="accent">CURRENT</Badge>} />{rows.length ? <StandingsTable ctx={ctx} rows={rows} race={race} seasonQ={seasonSlug} qualifiers={ctx.cfg.playoffs.enabled ? ctx.cfg.playoffs.qualifiers : undefined} /> : <EmptyState title="No results recorded" />}</Card>
      {playoffs.length ? <Card><CardHead title="Playoff results" /><ul className="divide-y divide-line">{playoffs.map((r) => { const nm = (id: string) => (r.matchup.kind === "team" ? m.teamById.get(id)?.name : m.bowlerById.get(id)?.name) ?? "?"; return <li key={r.matchup.id} className="flex justify-between gap-3 px-3.5 py-2 text-[13px]"><Link className="hover:underline" href={`/l/${slug}/matchup/${r.matchup.id}`}>Round {r.matchup.playoffRound}: {nm(r.a.participantId)} vs {nm(r.b!.participantId)}</Link><span className="num muted">{r.official ? `${r.a.points}–${r.b!.points}` : "not played"}</span></li>; })}</ul></Card> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHead title="Individual leaders" /><div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Bowler</th><th scope="col">Avg</th><th scope="col">Gms</th><th scope="col">HG</th><th scope="col">HS</th></tr></thead><tbody>{stats.slice(0, 10).map((s, i) => <tr key={s.bowlerId}><td className="!pl-3"><Link className="font-semibold hover:underline" href={`/l/${slug}/bowlers/${s.bowlerId}?season=${seasonSlug}`}>{i + 1}. {s.name}</Link></td><td className="score">{fmt1(s.average)}</td><td className="num">{s.games}</td><td className="num">{s.highGame?.scratch ?? "—"}</td><td className="num">{s.highSeries?.scratch ?? "—"}</td></tr>)}</tbody></table></div></Card>
        <Card><CardHead title="Season records" />{records.length === 0 ? <EmptyState title="No records" /> : <dl className="px-3.5 py-1">{records.slice(0, 8).map((r) => <KV key={r.key} k={r.title}>{r.value} · {r.holders.map((h) => h.holderName).join(", ")}</KV>)}</dl>}</Card>
      </div>
      <Card><CardHead title="Weekly results" /><div className="pill-nav p-3">{weeks.map((w) => <Link key={w.number} className="tab !px-2.5" href={`/l/${slug}/season/${seasonSlug}/week/${w.number}`}>Wk {w.number}</Link>)}</div></Card>
      <Card><CardHead title="Historical rosters" /><ul className="divide-y divide-line">{m.data.teams.filter((t) => m.data.roster.some((r) => r.teamId === t.id)).map((t) => <li key={t.id} className="px-3.5 py-2 text-[13px]"><b>{t.name}</b><span className="muted"> — {m.data.roster.filter((r) => r.teamId === t.id).map((r) => `${m.bowlerById.get(r.bowlerId)?.name} (wk ${r.fromWeek}–${r.toWeek ?? "end"})`).join(", ")}</span></li>)}</ul></Card>
    </div>
  );
}
