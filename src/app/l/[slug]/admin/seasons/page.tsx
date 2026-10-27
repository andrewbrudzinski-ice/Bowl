import Link from "next/link";
import { completeSeasonAction, createSeasonAction } from "@/app/actions/admin";
import { removeDemoAction } from "@/app/actions/leagues";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { Alert, Badge, Card, CardHead, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";

export const metadata = { title: "Seasons" };

export default async function SeasonsAdmin({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ created?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "season.manage");
  const latest = ctx.seasons[0];
  const nextYear = (latest?.year ?? new Date().getFullYear()) + 1;
  return (
    <div className="grid gap-4">
      <PageHeader title="Seasons" eyebrow={ctx.league.name} sub="Each season has its own rules, roster, schedule and results. Starting a new one never touches the old one." />
      {sp.created ? <Alert tone="ok" title="Season created">Review the roster and schedule, then generate or copy the schedule. <Link className="underline" href={`/l/${slug}/admin/roster?season=${sp.created}`}>Open roster</Link>.</Alert> : null}
      <Card>
        <CardHead title="All seasons" />
        <ul className="divide-y divide-line">{ctx.seasons.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[13px]">
            <span><Link className="font-semibold hover:underline" href={`/l/${slug}/history/${s.slug}`}>{s.name}</Link> <Badge tone={s.status === "active" ? "accent" : "win"}>{s.status.toUpperCase()}</Badge> <span className="muted text-xs">· rules v{s.ruleVersions[s.ruleVersions.length - 1].version} · starts {s.startDate}</span></span>
            {s.status === "active" ? <ConfirmAction action={completeSeasonAction.bind(null, slug, s.id)} confirm={`Mark ${s.name} complete? It becomes part of the archive; results stay as they are.`}>Mark complete</ConfirmAction> : null}
          </li>
        ))}</ul>
      </Card>
      <Card>
        <CardHead title="Start a new season" />
        <div className="p-4"><ActionForm action={createSeasonAction.bind(null, slug)} submit="Create season" className="grid gap-3 sm:grid-cols-2">
          <div className="field"><label htmlFor="sn">Name</label><input id="sn" name="name" required defaultValue={`${nextYear} Season`} className="input" /></div>
          <div className="field"><label htmlFor="sy">Year</label><input id="sy" name="year" type="number" defaultValue={nextYear} className="input" /></div>
          <div className="field"><label htmlFor="sd">First bowling night</label><input id="sd" name="startDate" type="date" defaultValue={`${nextYear}-01-06`} className="input" /></div>
          <div className="field"><label htmlFor="sw">Regular-season weeks</label><input id="sw" name="weeks" type="number" min={1} max={60} defaultValue={latest?.regularWeeks ?? 10} className="input" /></div>
          <div className="field sm:col-span-2"><label htmlFor="sf">Copy rules from</label><select id="sf" name="from" className="select" defaultValue={latest?.id ?? ""}><option value="">The league's default rules</option>{ctx.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select><span className="help">The new season gets its own copy of the rules; changing them later never affects the old season.</span></div>
          <label className="check"><input type="checkbox" name="copyRoster" defaultChecked />Copy the roster (entering averages = last season's final averages)</label>
          <label className="check"><input type="checkbox" name="copySchedule" />Copy the schedule structure (no scores)</label>
          <label className="check sm:col-span-2"><input type="checkbox" name="completePrevious" defaultChecked />Mark the copied-from season complete</label>
        </ActionForm></div>
      </Card>
      {ctx.league.isDemo && ctx.can("demo.reset") ? (
        <Card><CardHead title="Demo data" /><div className="grid gap-2 p-4"><Alert tone="warn" title="This is a demo league">Everything in it is simulated. Removing it deletes the whole league — start your own from the home page.</Alert><form action={removeDemoAction.bind(null, ctx.league.id)}><button className="btn btn-danger" type="submit">Remove demo league</button></form></div></Card>
      ) : null}
    </div>
  );
}
