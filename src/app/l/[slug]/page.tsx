import Link from "next/link";
import { notFound } from "next/navigation";
import { MODULES, MODULE_SPAN } from "@/components/home/modules";
import { Alert, Card, EmptyState } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { currentWeek, formatDate } from "@/server/views";
import { ClipboardList, Plus } from "lucide-react";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug);
  return { title: ctx.league.name };
}

export default async function LeagueHome({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug } = await params;
  const { season } = await searchParams;
  const ctx = await getLeagueCtx(slug, season);
  const { league } = ctx;
  if (!ctx.season || !ctx.model) {
    return (
      <Card>
        <EmptyState title="This league has no season yet" action={ctx.can("season.manage") ? <Link href={`/l/${slug}/admin/seasons`} className="btn btn-primary">Create a season</Link> : undefined}>
          Seasons hold the schedule, rosters, scores and the rules in force.
        </EmptyState>
      </Card>
    );
  }
  const m = ctx.model;
  const wk = currentWeek(ctx);
  const totalWeeks = m.data.weeks.length;
  const regular = ctx.season.regularWeeks;
  const done = m.data.weeks.filter((w) => w.status === "completed").length;
  const hasTeams = m.data.teams.length > 0;
  const hasRoster = m.data.roster.length > 0;
  const hasSchedule = m.data.matchups.length > 0;
  const setupStep = !hasTeams ? "teams" : !hasRoster ? "roster" : !hasSchedule ? "schedule" : null;
  const enabled = league.homepage.filter((x) => x.enabled && MODULES[x.id]);

  return (
    <div className="grid gap-4">
      <section className="card relative overflow-hidden p-4 md:p-5" aria-label="League overview">
        <div className="absolute inset-y-0 left-0 w-1 bg-[var(--accent)]" aria-hidden />
        <div className="flex flex-wrap items-center justify-between gap-4 pl-2">
          <div className="flex min-w-0 items-center gap-4">
            <span className="inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[var(--accent)] text-xl font-black text-[var(--accent-ink)]" aria-hidden>{league.logoText}</span>
            <div className="min-w-0">
              <div className="eyebrow">{ctx.season.name}{ctx.season.status === "completed" ? " · Completed" : ""}</div>
              <h1 className="h-page truncate text-[26px]">{league.name}</h1>
              {league.description ? <p className="muted mt-0.5 line-clamp-2 max-w-xl text-[13px]">{league.description}</p> : null}
            </div>
          </div>
          <dl className="flex gap-6">
            <div><dt className="eyebrow">{ctx.season.status === "completed" ? "Final week" : "Current week"}</dt><dd className="score text-[26px] leading-tight">{wk}<span className="muted text-sm font-medium"> / {regular}{totalWeeks > regular ? "+" + (totalWeeks - regular) : ""}</span></dd></div>
            <div><dt className="eyebrow">Next bowling</dt><dd className="score text-[26px] leading-tight">{formatDate(m.weekByNumber.get(wk)?.date) || "—"}</dd></div>
          </dl>
        </div>
        <div className="mt-4 pl-2">
          <div className="mb-1 flex justify-between text-xs"><span className="muted">Season progress</span><span className="num muted">{done} of {totalWeeks} weeks complete</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-raised" role="progressbar" aria-valuemin={0} aria-valuemax={totalWeeks} aria-valuenow={done} aria-label="Season progress">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${totalWeeks ? (done / totalWeeks) * 100 : 0}%` }} />
          </div>
        </div>
        {ctx.can("scores.enter") ? (
          <div className="mt-4 flex flex-wrap gap-2 pl-2">
            <Link href={`/l/${slug}/admin/scores?week=${wk}`} className="btn btn-primary btn-sm"><ClipboardList size={14} />Enter week {wk} scores</Link>
            <Link href={`/l/${slug}/admin`} className="btn btn-sm">Commissioner overview</Link>
          </div>
        ) : null}
      </section>

      {setupStep && ctx.can("roster.manage") ? (
        <Alert tone="info" title="Finish setting up your league">
          {setupStep === "teams" && <>Start by adding your teams and bowlers in <Link className="underline" href={`/l/${slug}/admin/roster`}>Commissioner → Teams & roster</Link>.</>}
          {setupStep === "roster" && <>Teams exist but nobody is on this season's roster. Add bowlers to teams (with entering averages) in <Link className="underline" href={`/l/${slug}/admin/roster`}>Teams & roster</Link>.</>}
          {setupStep === "schedule" && <>Rosters are ready. Generate the season schedule in <Link className="underline" href={`/l/${slug}/admin/schedule`}>Commissioner → Schedule</Link>.</>}
        </Alert>
      ) : null}

      {enabled.length === 0 ? (
        <Card><EmptyState title="No homepage modules are enabled" action={ctx.can("settings.general") ? <Link href={`/l/${slug}/admin/settings?section=appearance`} className="btn"><Plus size={14} />Choose modules</Link> : undefined} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {enabled.map((mod) => {
            const Mod = MODULES[mod.id];
            const out = <Mod ctx={ctx} />;
            return (
              <div key={mod.id} className={MODULE_SPAN[mod.id] === "wide" ? "lg:col-span-2" : ""}>
                {out}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
