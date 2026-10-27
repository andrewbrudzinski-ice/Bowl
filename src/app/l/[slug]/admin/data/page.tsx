import { importBundleAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ImportWizard } from "@/components/import-wizard";
import { Alert, Card, CardHead, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { IMPORT_TEMPLATES } from "@/server/services/data";

export const metadata = { title: "Import & export" };

export default async function DataPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug, undefined, "data.export");
  const canImport = ctx.can("data.import");
  const seasons = ctx.seasons;
  const kinds = ["bowlers", "teams", "rosters", "schedule", "scores", "results"] as const;
  const labels: Record<string, string> = { bowlers: "Bowlers", teams: "Teams", rosters: "Rosters", schedule: "Schedule", scores: "Game scores (with handicaps & rule version)", results: "Matchup results" };
  return (
    <div className="grid gap-4">
      <PageHeader title="Import & export" eyebrow={ctx.league.name} sub="Your data is yours. Export everything at any time, and restore it here or in another environment." />
      <Card>
        <CardHead title="Export CSV" />
        <div className="grid gap-3 p-4">
          <p className="help">Score exports include the average and handicap actually used for each game, the rule version and finalization time — enough to audit any result.</p>
          {seasons.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2"><span className="w-32 text-[13px] font-semibold">{s.name}</span>{kinds.filter((k) => k !== "bowlers" && k !== "teams").map((k) => <a key={k} className="btn btn-sm" href={`/l/${slug}/export/${k}?season=${s.id}`}>{k === "scores" ? "Scores" : k === "results" ? "Results" : k === "rosters" ? "Rosters" : "Schedule"}</a>)}</div>
          ))}
          <div className="flex flex-wrap items-center gap-2"><span className="w-32 text-[13px] font-semibold">League-wide</span><a className="btn btn-sm" href={`/l/${slug}/export/bowlers`}>Bowlers</a><a className="btn btn-sm" href={`/l/${slug}/export/teams`}>Teams</a></div>
          <div className="border-t border-line pt-3"><a className="btn btn-primary btn-sm" href={`/l/${slug}/export/bundle`}>Download full league backup (JSON)</a><p className="help mt-1">Seasons, rule versions, teams, rosters, schedules, raw scores, results, announcements and the audit log. Member accounts, emails and private links are not included.</p></div>
        </div>
      </Card>
      {canImport ? (
        <>
          <Card><CardHead title="Import CSV" /><div className="p-4"><ImportWizard slug={slug} seasons={seasons.map((s) => ({ id: s.id, name: s.name }))} info={Object.fromEntries(Object.entries(IMPORT_TEMPLATES).map(([k, v]) => [k, { description: v.description, needsSeason: v.needsSeason }])) as never} /></div></Card>
          <Card><CardHead title="Restore from a full backup" /><div className="p-4"><Alert tone="info">Restoring creates a <b>new league</b> owned by you — it never overwrites an existing one. Use it to move a league to another environment or recover from a backup.</Alert><div className="mt-3"><ActionForm action={importBundleAction} submit="Restore as a new league" className="grid gap-3 sm:max-w-md"><div className="field"><label htmlFor="bf">Backup file (.json)</label><input id="bf" name="file" type="file" accept="application/json,.json" className="input !h-auto py-1.5" required /></div><div className="field"><label htmlFor="bn">New league name (optional)</label><input id="bn" name="name" className="input" /></div></ActionForm></div></div></Card>
        </>
      ) : <Alert tone="info">Only owners and commissioners can import data.</Alert>}
    </div>
  );
}
