import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { auditConsistency } from "@/domain/validate";
import { Alert, Badge, Card, CardHead, EmptyState, PageHeader, Stat } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { currentWeek, formatDateTime, participant } from "@/server/views";

export const metadata = { title: "Commissioner" };

export default async function AdminHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ welcome?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "league.view_admin");
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" action={ctx.can("season.manage") ? <Link className="btn btn-primary" href={`/l/${slug}/admin/seasons`}>Create a season</Link> : undefined} /></Card>;
  const m = ctx.model;
  const base = `/l/${slug}/admin`;
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const wk = currentWeek(ctx);
  const nm = (r: (typeof m.results)[number]) => `${participant(ctx, r.a.participantId, kind).name} vs ${participant(ctx, r.b!.participantId, kind).name}`;
  const real = m.results.filter((r) => !r.isBye);
  const thisWeek = real.filter((r) => r.weekNumber === wk);
  const done = thisWeek.filter((r) => r.official).length;
  const missing = real.filter((r) => !r.official && r.weekNumber <= wk && (r.missing.length > 0 || r.matchup.state === "scheduled" || r.matchup.state === "in_progress") && m.weekByNumber.get(r.weekNumber)?.status !== "postponed");
  const awaiting = real.filter((r) => !r.official && r.complete && (r.matchup.state === "draft" || r.matchup.state === "ready_for_review"));
  const issues = auditConsistency(m);
  // schedule problems
  const sched: string[] = [];
  const regularWeeks = [...m.data.weeks].filter((w) => w.phase === "regular");
  const emptyWeeks = regularWeeks.filter((w) => !m.results.some((r) => r.weekNumber === w.number) && w.status !== "postponed");
  if (m.data.matchups.length === 0) sched.push("No schedule has been created yet.");
  else if (emptyWeeks.length) sched.push(`No matchups in week${emptyWeeks.length === 1 ? "" : "s"} ${emptyWeeks.map((w) => w.number).join(", ")}.`);
  const parts = kind === "team" ? m.data.teams.filter((t) => t.active && m.data.roster.some((r) => r.teamId === t.id)) : [];
  for (const w of regularWeeks.filter((x) => m.results.some((r) => r.weekNumber === x.number))) {
    const playing = new Set(m.results.filter((r) => r.weekNumber === w.number).flatMap((r) => [r.a.participantId, r.b?.participantId]));
    const idle = parts.filter((t) => !playing.has(t.id));
    if (idle.length) sched.push(`Week ${w.number}: ${idle.map((t) => t.name).join(", ")} ${idle.length === 1 ? "has" : "have"} no matchup or bye.`);
  }
  for (const w of m.data.weeks.filter((x) => x.status === "postponed")) sched.push(`Week ${w.number} is postponed — set a new date.`);
  for (const i of issues.filter((x) => x.code === "duplicate_matchup")) sched.push(i.message);
  const unassigned = m.data.roster.filter((r) => r.toWeek == null && !r.isSub && !r.teamId && kind === "team");
  if (unassigned.length) sched.push(`${unassigned.length} bowler${unassigned.length === 1 ? " has" : "s have"} no team.`);
  const { corrections, rosterChanges, importProblems } = await getStore().read((db) => ({
    corrections: db.audit.filter((a) => a.leagueId === ctx.league.id && (a.action === "result.corrected" || a.action === "result.reopened" || a.action === "rules.changed")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
    rosterChanges: db.audit.filter((a) => a.leagueId === ctx.league.id && a.seasonId === ctx.season!.id && a.action.startsWith("roster.")).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5),
    importProblems: db.importLog.filter((i) => i.leagueId === ctx.league.id && !i.ok).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3),
  }));

  let next: { title: string; body: string; href: string; cta: string } | null = null;
  if (!m.data.teams.length) next = { title: "Add your teams and bowlers", body: "Everything else builds on the roster.", href: `${base}/roster`, cta: "Open roster" };
  else if (!m.data.roster.length) next = { title: "Put bowlers on this season's roster", body: "Add each bowler with an entering average so handicaps work from week one.", href: `${base}/roster`, cta: "Add to roster" };
  else if (!m.data.matchups.length) next = { title: "Build the schedule", body: "Generate a round robin or add matchups by hand.", href: `${base}/schedule`, cta: "Open schedule" };
  else if (awaiting.length) next = { title: `${awaiting.length} result${awaiting.length === 1 ? " is" : "s are"} waiting to be finalized`, body: "Review the totals, preview the standings impact, then finalize.", href: `${base}/scores?week=${awaiting[0].weekNumber}`, cta: "Review & finalize" };
  else if (missing.length) next = { title: `Enter scores for week ${missing[0].weekNumber}`, body: `${missing.length} matchup${missing.length === 1 ? "" : "s"} still need scores.`, href: `${base}/scores?week=${missing[0].weekNumber}`, cta: "Enter scores" };
  else if (ctx.season.status === "active" && real.length && real.every((r) => r.official)) next = { title: "Every scheduled matchup is final", body: ctx.cfg.playoffs.enabled ? "Generate the playoff bracket, or complete the season." : "Complete the season to archive it and start the next one.", href: `${base}/seasons`, cta: "Season options" };

  return (
    <div className="grid gap-4">
      <PageHeader title="Commissioner overview" eyebrow={ctx.season.name} />
      {sp.welcome ? <Alert tone="ok" title="League created">Next: add teams and bowlers, then build the schedule. You can change any rule later in Settings — changes are previewed before they apply.</Alert> : null}
      {next ? (
        <div className="card flex flex-wrap items-center justify-between gap-3 border-[var(--accent)] p-4">
          <div><div className="eyebrow text-[var(--accent)]">Next step</div><div className="text-[16px] font-bold">{next.title}</div><div className="muted text-[13px]">{next.body}</div></div>
          <Link href={next.href} className="btn btn-primary">{next.cta}<ArrowRight size={15} aria-hidden /></Link>
        </div>
      ) : <Alert tone="ok" title="Nothing needs your attention">All caught up for week {wk}.</Alert>}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat label={`Week ${wk} complete`} value={`${done}/${thisWeek.length}`} sub="matchups finalized" href={`${base}/scores?week=${wk}`} />
        <Stat label="Missing scores" value={missing.length} sub="matchups" />
        <Stat label="Awaiting finalization" value={awaiting.length} sub="complete, not final" />
        <Stat label="Data issues" value={issues.filter((i) => i.severity === "error").length + importProblems.length} sub="consistency + imports" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Matchups with missing scores" />
          {missing.length === 0 ? <EmptyState title="No missing scores" icon={<CheckCircle2 size={20} />} /> : <ul className="divide-y divide-line">{missing.slice(0, 8).map((r) => <li key={r.matchup.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]"><span>Wk {r.weekNumber} · {nm(r)}</span><Link className="text-[var(--accent)]" href={`${base}/scores?week=${r.weekNumber}`}>{r.missing.length ? `${r.missing.length} missing` : "Not started"} →</Link></li>)}</ul>}
        </Card>
        <Card>
          <CardHead title="Awaiting finalization" />
          {awaiting.length === 0 ? <EmptyState title="Nothing to finalize" icon={<CheckCircle2 size={20} />} /> : <ul className="divide-y divide-line">{awaiting.map((r) => <li key={r.matchup.id} className="flex items-center justify-between gap-3 px-3.5 py-2 text-[13px]"><span>Wk {r.weekNumber} · {nm(r)} <Badge tone={r.matchup.state === "ready_for_review" ? "warn" : "neutral"}>{r.matchup.state === "ready_for_review" ? "READY" : "DRAFT"}</Badge></span><Link className="text-[var(--accent)]" href={`${base}/scores?week=${r.weekNumber}`}>Review →</Link></li>)}</ul>}
        </Card>
        <Card>
          <CardHead title="Schedule issues" />
          {sched.length === 0 ? <EmptyState title="Schedule looks healthy" icon={<CheckCircle2 size={20} />} /> : <ul className="divide-y divide-line">{sched.slice(0, 8).map((s, i) => <li key={i} className="flex gap-2 px-3.5 py-2 text-[13px]"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-warn" aria-hidden />{s}</li>)}</ul>}
          {sched.length ? <div className="border-t border-line px-3.5 py-2"><Link className="text-[13px] text-[var(--accent)]" href={`${base}/schedule`}>Open schedule →</Link></div> : null}
        </Card>
        <Card>
          <CardHead title="Recent corrections & rule changes" right={ctx.can("audit.view") ? <Link className="text-[var(--accent)]" href={`${base}/audit`}>Audit log →</Link> : null} />
          {corrections.length === 0 ? <EmptyState title="None yet" /> : <ul className="divide-y divide-line">{corrections.map((a) => <li key={a.id} className="px-3.5 py-2 text-[13px]"><b>{a.action === "result.corrected" ? "Result corrected" : a.action === "result.reopened" ? "Result reopened" : "Rules changed"}</b> <span className="muted">· {a.userName} · {formatDateTime(a.at)}</span>{a.note ? <div className="muted text-xs">“{a.note}”</div> : null}</li>)}</ul>}
        </Card>
        <Card>
          <CardHead title="Recent roster changes" />
          {rosterChanges.length === 0 ? <EmptyState title="No roster changes this season" /> : <ul className="divide-y divide-line">{rosterChanges.map((a) => <li key={a.id} className="px-3.5 py-2 text-[13px]">{a.action.replace("roster.", "").replace(/_/g, " ")} <span className="muted">· {a.userName} · {formatDateTime(a.at)}{a.note ? ` · ${a.note}` : ""}</span></li>)}</ul>}
        </Card>
        <Card>
          <CardHead title="Data import problems" right={ctx.can("data.import") ? <Link className="text-[var(--accent)]" href={`${base}/data`}>Import →</Link> : null} />
          {importProblems.length === 0 && issues.length === 0 ? <EmptyState title="No problems" icon={<CheckCircle2 size={20} />} /> : <ul className="divide-y divide-line">{issues.map((i, k) => <li key={`c${k}`} className="px-3.5 py-2 text-[13px]"><Badge tone={i.severity === "error" ? "loss" : "warn"}>{i.severity.toUpperCase()}</Badge> {i.message}</li>)}{importProblems.map((p) => <li key={p.id} className="px-3.5 py-2 text-[13px]"><b>Failed {p.kind} import</b> <span className="muted">· {formatDateTime(p.at)}</span><ul className="muted list-disc pl-4 text-xs">{p.errors.slice(0, 3).map((e, k) => <li key={k}>{e}</li>)}</ul></li>)}</ul>}
        </Card>
      </div>
    </div>
  );
}
