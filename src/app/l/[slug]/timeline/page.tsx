import Link from "next/link";
import { Trophy } from "lucide-react";
import { championOf } from "@/domain/awards";
import { buildRecordBook, recordsBrokenInWeek } from "@/domain/records";
import { computeStandings } from "@/domain/standings";
import { seasonParam } from "@/components/links";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { allModels, formatDate, participant } from "@/server/views";
import { fmtPts } from "@/domain/math";

export const metadata = { title: "Season timeline" };

export default async function Timeline({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const scope = kind === "team" ? "team" : "bowler";
  const book = buildRecordBook(allModels(ctx));
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number).filter((w) => m.results.some((r) => r.weekNumber === w.number));
  const champ = championOf(m);
  const sq = seasonParam(ctx);
  let prevRows = computeStandings(m, { scope, throughWeek: 0 }).rows;
  return (
    <div>
      <PageHeader title="Season timeline" eyebrow={ctx.season.name} sub="Week by week: results, movement in the standings, records and streaks. Open any week for its full recap." />
      {weeks.length === 0 ? <Card><EmptyState title="Nothing to show yet" /></Card> : (
        <ol className="relative grid gap-4 border-l border-line pl-5">
          {weeks.map((w) => {
            const rs = m.results.filter((r) => r.weekNumber === w.number && !r.isBye);
            const done = rs.length > 0 && rs.every((r) => r.official);
            const any = rs.some((r) => r.official);
            const rows = any && w.phase === "regular" ? computeStandings(m, { scope, throughWeek: w.number }).rows : null;
            const movers = rows ? rows.map((r) => ({ r, d: (prevRows.find((p) => p.id === r.id)?.rank ?? r.rank) - r.rank })).filter((x) => Math.abs(x.d) >= 2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2) : [];
            const leaderChanged = rows && prevRows[0] && prevRows[0].played > 0 && rows[0] && rows[0].id !== prevRows[0].id && !rows[0].fullyTied;
            const streaks = rows ? rows.filter((r) => r.streak.type === "W" && r.streak.count >= 3).slice(0, 2) : [];
            const broken = any ? recordsBrokenInWeek(book, ctx.season!.id, w.number).filter((x) => x.kind === "new") : [];
            const tl = { rows, prev: prevRows };
            if (rows) prevRows = rows;
            void tl;
            return (
              <li key={w.number} className="relative">
                <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-bg bg-[var(--accent)]" aria-hidden />
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h2 className="text-[15px] font-bold"><Link className="hover:underline" href={`/l/${slug}/season/${ctx.season!.slug}/week/${w.number}`}>{w.phase === "playoff" ? `Playoffs · ${w.label.replace(/^Playoffs · /, "")}` : `Week ${w.number}`}</Link></h2>
                  <span className="muted text-xs">{formatDate(w.date, { month: "short", day: "numeric" })}</span>
                  {done ? <Badge tone="win">FINAL</Badge> : any ? <Badge tone="warn">PARTIAL</Badge> : <Badge>UPCOMING</Badge>}
                </div>
                <Card>
                  <ul className="divide-y divide-line">{rs.map((r) => { const a = participant(ctx, r.a.participantId, kind, sq); const b = participant(ctx, r.b!.participantId, kind, sq); const win = r.official ? (r.winner === "A" ? a.name : r.winner === "B" ? b.name : null) : null; return (
                    <li key={r.matchup.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px]"><Link href={`/l/${slug}/matchup/${r.matchup.id}`} className="min-w-0 truncate hover:underline"><span className={win === a.name ? "font-bold" : ""}>{a.name}</span> <span className="muted">vs</span> <span className={win === b.name ? "font-bold" : ""}>{b.name}</span></Link><span className="num muted shrink-0">{r.official ? `${fmtPts(r.a.points)}–${fmtPts(r.b!.points)}${win ? ` · ${win} won` : r.winner === "tie" ? " · tie" : ""}` : "not final"}</span></li>); })}</ul>
                  {(leaderChanged || movers.length || streaks.length || broken.length) ? (
                    <ul className="grid gap-1 border-t border-line px-3.5 py-2 text-xs">
                      {leaderChanged ? <li><b>New leader:</b> {rows![0].name} take over first place.</li> : null}
                      {movers.map(({ r, d }) => <li key={r.id} className="muted">{r.name} {d > 0 ? "climbed" : "fell"} {Math.abs(d)} places to #{r.rank}</li>)}
                      {streaks.map((r) => <li key={r.id} className="muted">{r.name} have won {r.streak.count} straight</li>)}
                      {broken.map((x, i) => <li key={i}><b>Record:</b> {x.item.title} — {x.event.holderName}, {x.event.detail}</li>)}
                    </ul>
                  ) : null}
                </Card>
              </li>
            );
          })}
          {champ ? <li className="relative"><span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-bg bg-warn" aria-hidden /><Card><div className="flex items-center gap-3 p-3.5"><Trophy className="text-warn" aria-hidden /><div><div className="eyebrow">Champion</div><div className="text-[16px] font-bold">{champ.name}</div><div className="muted text-xs">{champ.how}</div></div></div></Card></li> : null}
        </ol>
      )}
    </div>
  );
}
