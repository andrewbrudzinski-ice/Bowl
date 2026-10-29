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
    <div className="grid gap-8">
      <section className="relative overflow-hidden rounded-[28px] border border-line bg-[linear-gradient(135deg,var(--tint),var(--color-surface)_70%)] p-6 shadow-[var(--shadow-md)] md:p-9" aria-label="League overview">
        <svg aria-hidden className="pointer-events-none absolute -right-12 -top-8 h-72 w-72 text-[var(--accent)] opacity-30 [mask-image:linear-gradient(90deg,transparent,#000_55%)]" viewBox="0 0 260 200" fill="none" stroke="currentColor" strokeWidth="1">
          <path d="M100 0 L160 0 L260 200 M100 0 L0 200 M130 0 L130 200 M115 0 L72 200 M145 0 L188 200" />
        </svg>
        <div className="relative flex flex-wrap items-start justify-between gap-x-10 gap-y-7">
          <div className="flex min-w-0 max-w-2xl items-start gap-5">
            <span className="metal inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[var(--accent)] text-lg font-extrabold text-[var(--accent-ink)] md:h-16 md:w-16 md:text-xl" aria-hidden>{league.logoText}</span>
            <div className="min-w-0">
              <div className="eyebrow !text-[var(--accent-text)]">{ctx.season.name}{ctx.season.status === "completed" ? " · Completed" : ""}</div>
              <h1 className="h-page mt-1.5 text-[30px] leading-[1.08] md:text-[40px]">{league.name}</h1>
              {league.description ? <p className="muted mt-2.5 line-clamp-2 text-[15px]">{league.description}</p> : null}
            </div>
          </div>
          <dl className="flex gap-9">
            <div><dt className="faint text-[12px] font-semibold">{ctx.season.status === "completed" ? "Final week" : "Current week"}</dt><dd className="score mt-0.5 text-[30px] leading-tight">{wk}<span className="muted text-[15px] font-semibold"> / {regular}{totalWeeks > regular ? "+" + (totalWeeks - regular) : ""}</span></dd></div>
            <div><dt className="faint text-[12px] font-semibold">Next bowling</dt><dd className="score mt-0.5 text-[30px] leading-tight">{formatDate(m.weekByNumber.get(wk)?.date) || "—"}</dd></div>
          </dl>
        </div>
        <div className="relative mt-8">
          <div className="mb-2.5 flex justify-between text-[13px]"><span className="muted">Season progress</span><span className="num muted">{done} of {totalWeeks} weeks complete</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-fg)_10%,transparent)]" role="progressbar" aria-valuemin={0} aria-valuemax={totalWeeks} aria-valuenow={done} aria-label="Season progress">
            <div className="metal-x h-full rounded-full" style={{ width: `${totalWeeks ? (done / totalWeeks) * 100 : 0}%` }} />
          </div>
        </div>
        {ctx.can("scores.enter") ? (
          <div className="relative mt-7 flex flex-wrap gap-3">
            <Link href={`/l/${slug}/admin/scores?week=${wk}`} className="btn btn-primary"><ClipboardList size={16} />Enter week {wk} scores</Link>
            <Link href={`/l/${slug}/admin`} className="btn">Commissioner overview</Link>
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
        <div className="grid gap-8 lg:grid-cols-2">
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
