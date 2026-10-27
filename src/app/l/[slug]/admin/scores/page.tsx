import Link from "next/link";
import { ScoreEntry, type EntryData } from "@/components/score-entry";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { currentWeek, formatDate } from "@/server/views";

export const metadata = { title: "Score entry" };

export default async function ScoresPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ week?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "scores.enter");
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number);
  const wk = Number(sp.week) || currentWeek(ctx);
  const week = m.weekByNumber.get(wk);
  const results = m.results.filter((r) => r.weekNumber === wk);
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const cfg = m.configForWeek(wk);

  // Handicaps as they apply this week; finalized matchups show the locked snapshot instead.
  const pool: EntryData["pool"] = {};
  for (const r of m.data.roster.filter((x) => x.fromWeek <= wk && (x.toWeek == null || x.toWeek >= wk))) {
    const h = m.handicapAt(r.bowlerId, wk);
    pool[r.bowlerId] = { name: m.bowlerById.get(r.bowlerId)?.name ?? "?", average: h.average.average, handicap: h.breakdown.handicap, note: h.average.note, isSub: r.isSub };
  }
  for (const r of results) for (const side of [r.a, r.b]) for (const l of side?.lineup ?? []) {
    pool[l.bowlerId] = { name: m.bowlerById.get(l.bowlerId)?.name ?? "?", average: l.average, handicap: l.handicap, note: l.note, isSub: l.isSub };
  }
  const inWeek = new Set(results.flatMap((r) => [...r.matchup.lineupA, ...r.matchup.lineupB]));
  const subsAll = m.data.roster.filter((x) => x.fromWeek <= wk && (x.toWeek == null || x.toWeek >= wk) && m.bowlerById.get(x.bowlerId)?.active !== false && !inWeek.has(x.bowlerId))
    .map((x) => ({ id: x.bowlerId, name: m.bowlerById.get(x.bowlerId)?.name ?? "?", team: x.isSub ? "sub" : x.teamId ? (m.teamById.get(x.teamId)?.name ?? null) : null }));
  const nm = (id: string) => (kind === "team" ? m.teamById.get(id) : m.bowlerById.get(id));
  const col = (id: string) => { const x = nm(id) as { color?: string; avatarColor?: string } | undefined; return x?.color ?? x?.avatarColor ?? "#64748b"; };
  const data: EntryData = {
    slug, seasonId: ctx.season.id, week: wk, dateLabel: formatDate(week?.date, { weekday: "short", month: "short", day: "numeric" }), cfg,
    pool, canFinalize: ctx.can("results.finalize"), canCorrect: ctx.can("results.correct"),
    matchups: results.filter((r) => !r.isBye).map((r) => ({
      id: r.matchup.id, revision: r.matchup.revision, state: r.matchup.state, kind: r.matchup.kind, forfeitBy: r.matchup.forfeitBy,
      a: { id: r.a.participantId, name: (nm(r.a.participantId) as { name: string } | undefined)?.name ?? "?", color: col(r.a.participantId) },
      b: r.b ? { id: r.b.participantId, name: (nm(r.b.participantId) as { name: string } | undefined)?.name ?? "?", color: col(r.b.participantId) } : null,
      lineupA: r.matchup.lineupA, lineupB: r.matchup.lineupB,
      scores: m.data.scores.filter((s) => s.matchupId === r.matchup.id).map((s) => ({ bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.scratch, kind: s.kind })),
      official: r.official, href: `/l/${slug}/matchup/${r.matchup.id}`, subs: subsAll, bowlersPerTeam: cfg.bowlersPerTeam,
    })),
  };
  return (
    <div>
      <PageHeader title="Score entry" eyebrow={ctx.season.name} sub="Enter every matchup for the night on one screen. Handicaps and results calculate as you type; nothing counts until you finalize." />
      <nav className="pill-nav mb-4" aria-label="Choose week">
        {weeks.map((w) => { const rs = m.results.filter((r) => r.weekNumber === w.number && !r.isBye); const done = rs.length > 0 && rs.every((r) => r.official); return <Link key={w.number} href={`/l/${slug}/admin/scores?week=${w.number}`} className="tab" aria-current={w.number === wk ? "page" : undefined}>{w.phase === "playoff" ? `P${w.number - ctx.season!.regularWeeks}` : w.number}{done ? " ✓" : ""}</Link>; })}
      </nav>
      {!week ? <Card><EmptyState title="That week doesn't exist" /></Card> : data.matchups.length === 0 ? (
        <Card><EmptyState title={`No matchups in week ${wk}`} action={ctx.can("schedule.manage") ? <Link className="btn btn-primary" href={`/l/${slug}/admin/schedule`}>Open schedule</Link> : undefined}>{week.status === "postponed" ? <><Badge tone="warn">POSTPONED</Badge> </> : null}Create the schedule first, then come back to enter scores.</EmptyState></Card>
      ) : <ScoreEntry key={`${wk}`} data={data} />}
    </div>
  );
}
