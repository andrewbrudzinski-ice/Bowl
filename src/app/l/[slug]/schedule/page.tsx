import Link from "next/link";
import { Scoreboard } from "@/components/scoreboard";
import { Badge, Card, CardHead, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { currentWeek, formatDate, participant, recordsEntering } from "@/server/views";
import { seasonParam } from "@/components/links";

export const metadata = { title: "Schedule" };

export default async function Schedule({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const cur = currentWeek(ctx);
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number);
  const sq = seasonParam(ctx);
  return (
    <div>
      <PageHeader title="Schedule & matchups" eyebrow={ctx.season.name} sub="Every week of the season. Tap a week for its full recap, or a matchup for the box score." actions={ctx.can("schedule.manage") ? <Link href={`/l/${slug}/admin/schedule`} className="btn btn-sm">Edit schedule</Link> : undefined} />
      {m.data.matchups.length === 0 ? (
        <Card><EmptyState title="No schedule yet" action={ctx.can("schedule.manage") ? <Link className="btn btn-primary" href={`/l/${slug}/admin/schedule`}>Build the schedule</Link> : undefined}>{ctx.can("schedule.manage") ? "Add teams and rosters, then generate a round robin or enter matchups by hand." : "The commissioner hasn't published the schedule yet."}</EmptyState></Card>
      ) : (
        <div className="grid gap-6 md:gap-8">
          {weeks.map((w) => {
            const rs = m.results.filter((r) => r.weekNumber === w.number);
            const rec = recordsEntering(ctx, w.number);
            const done = rs.filter((r) => !r.isBye).length > 0 && rs.filter((r) => !r.isBye).every((r) => r.official);
            return (
              <section key={w.id} id={`week-${w.number}`} aria-labelledby={`h${w.number}`}>
                <div className="mb-4 flex flex-wrap items-center gap-3">
                  <h2 id={`h${w.number}`} className="text-[15px] font-bold"><Link href={`/l/${slug}/season/${ctx.season!.slug}/week/${w.number}`} className="hover:underline">{w.phase === "playoff" ? `Playoffs · ${w.label.replace(/^Playoffs · /, "")}` : `Week ${w.number}`}</Link></h2>
                  <span className="muted text-[13px]">{formatDate(w.date, { weekday: "short", month: "short", day: "numeric" })}</span>
                  {w.number === cur && ctx.season!.status === "active" ? <Badge tone="accent">THIS WEEK</Badge> : null}
                  {done ? <Badge tone="win">COMPLETE</Badge> : null}
                  {w.status === "postponed" ? <Badge tone="warn">POSTPONED</Badge> : null}
                </div>
                {rs.length === 0 ? <p className="muted text-[13px]">No matchups scheduled{w.phase === "playoff" ? " yet — the bracket is set when the previous round finishes." : "."}</p> : (
                  <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {rs.map((r) => <Scoreboard key={r.matchup.id} r={r} a={participant(ctx, r.a.participantId, kind, sq)} b={r.b ? participant(ctx, r.b.participantId, kind, sq) : undefined} recA={rec.get(r.a.participantId)} recB={r.b ? rec.get(r.b.participantId) : undefined} href={`/l/${slug}/matchup/${r.matchup.id}`} compact />)}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
