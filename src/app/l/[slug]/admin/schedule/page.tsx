import Link from "next/link";
import { addMatchupAction, generateScheduleAction, moveMatchupAction, playoffBracketAction, updateWeekAction, deleteMatchupAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { Alert, Badge, Card, CardHead, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { participantsForSchedule, previewSchedule } from "@/server/services/season";
import { formatDate, participant } from "@/server/views";
import { isOfficial } from "@/domain/types";

export const metadata = { title: "Schedule" };

export default async function ScheduleAdmin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug, undefined, "schedule.manage");
  if (!ctx.model || !ctx.season || !ctx.actor) return <Card><EmptyState title="Create a season first" /></Card>;
  const m = ctx.model;
  const season = ctx.season;
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const store = getStore();
  const { ids } = await store.read((db) => participantsForSchedule(db, ctx.league.id, season.id));
  const preview = ids.length >= 2 ? await previewSchedule(store, ctx.actor, ctx.league.id, season.id) : null;
  const weeks = [...m.data.weeks].sort((a, b) => a.number - b.number);
  const names = ids.map((id) => participant(ctx, id, kind).name);
  const options = (kind === "team" ? m.data.teams.filter((t) => t.active) : m.data.bowlers.filter((b) => b.active)).map((x) => ({ id: x.id, name: x.name }));
  const regularDone = m.results.filter((r) => (m.weekByNumber.get(r.weekNumber)?.phase ?? "regular") === "regular" && !r.isBye).every((r) => r.official) && m.results.length > 0;
  const hasPlayoffMatchups = m.data.matchups.some((x) => x.weekNumber > season.regularWeeks);
  return (
    <div className="grid gap-4">
      <PageHeader title="Schedule" eyebrow={season.name} sub="Generate a round robin, or add and move matchups by hand. Finalized weeks are never touched." />
      <Card>
        <CardHead title="Generate schedule" />
        <div className="grid gap-3 p-3.5">
          {ids.length < 2 ? <Alert tone="warn">Add at least two {kind === "team" ? "teams with bowlers on this season's roster" : "bowlers to this season's roster"} first.</Alert> : (
            <>
              <p className="text-[13px]"><b>{ids.length}</b> {kind === "team" ? "teams" : "bowlers"} will be scheduled over <b>{preview ? season.regularWeeks - preview.from + 1 : season.regularWeeks}</b> regular-season week(s) starting week <b>{preview?.from ?? 1}</b>: <span className="muted">{names.join(", ")}</span></p>
              {preview?.warnings.map((w, i) => <Alert key={i} tone="warn">{w}</Alert>)}
              {preview && preview.warnings.length === 0 ? <Alert tone="ok">Balanced: every pair meets the same number of times{ids.length % 2 ? "" : ", no byes"}.</Alert> : null}
              <ActionForm action={generateScheduleAction.bind(null, slug, season.id)} submit={m.data.matchups.length ? "Replace unplayed matchups with a new schedule" : "Generate schedule"} className="flex flex-wrap items-end gap-3">
                <div className="field"><label htmlFor="from">Start at week</label><input id="from" name="from" type="number" min={1} max={season.regularWeeks} defaultValue={preview?.from ?? 1} className="input !w-24" /></div>
                <span className="help max-w-md">Replaces only matchups with no scores. It refuses if any week from here on has drafts or results.</span>
              </ActionForm>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHead title="Add a matchup" />
        <div className="p-3.5"><ActionForm action={addMatchupAction.bind(null, slug, season.id)} submit="Add matchup" reset className="flex flex-wrap items-end gap-2">
          <div className="field"><label htmlFor="mw">Week</label><select id="mw" name="week" className="select !w-24">{weeks.map((w) => <option key={w.number} value={w.number}>{w.number}</option>)}</select></div>
          <div className="field"><label htmlFor="ma">{kind === "team" ? "Team" : "Bowler"} A</label><select id="ma" name="a" className="select !w-44">{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
          <div className="field"><label htmlFor="mb">Opponent</label><select id="mb" name="b" className="select !w-44"><option value="">Bye</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        </ActionForm></div>
      </Card>

      {ctx.cfg.playoffs.enabled ? (
        <Card>
          <CardHead title="Playoffs" />
          <div className="flex flex-wrap items-center gap-3 p-3.5 text-[13px]">
            <span className="muted">Top {ctx.cfg.playoffs.qualifiers} seed a single-elimination bracket. Later rounds are created automatically as rounds finish.</span>
            {hasPlayoffMatchups ? <Badge tone="info">BRACKET CREATED</Badge> : <ConfirmAction className="btn btn-primary btn-sm" action={playoffBracketAction.bind(null, slug, season.id, !regularDone)} confirm={regularDone ? "Create the playoff bracket from the final standings?" : "Regular-season matchups are still unfinalized. Seed the bracket from the CURRENT standings anyway?"}>Generate bracket</ConfirmAction>}
          </div>
        </Card>
      ) : null}

      <div className="grid gap-3">
        {weeks.map((w) => {
          const rs = m.results.filter((r) => r.weekNumber === w.number);
          return (
            <Card key={w.id}>
              <CardHead title={`${w.phase === "playoff" ? "Playoffs" : "Week"} ${w.number} · ${formatDate(w.date, { weekday: "short", month: "short", day: "numeric" })}`} right={<><Badge tone={w.status === "completed" ? "win" : w.status === "postponed" ? "warn" : "neutral"}>{w.status.replace("_", " ").toUpperCase()}</Badge><Link className="text-[var(--accent)]" href={`/l/${slug}/admin/scores?week=${w.number}`}>Scores →</Link></>} />
              <details className="border-b border-line"><summary className="muted cursor-pointer px-3.5 py-2 text-xs hover:text-fg">Reschedule or change status</summary>
                <div className="px-3.5 pb-3"><ActionForm action={updateWeekAction.bind(null, slug, season.id, w.number)} submit="Save week" className="flex flex-wrap items-end gap-2"><div className="field"><label htmlFor={`d${w.number}`}>Date</label><input id={`d${w.number}`} name="date" type="date" defaultValue={w.date} className="input !w-40" /></div><div className="field"><label htmlFor={`s${w.number}`}>Status</label><select id={`s${w.number}`} name="status" defaultValue={w.status} className="select !w-40"><option value="scheduled">Scheduled</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="postponed">Postponed</option></select></div></ActionForm></div>
              </details>
              {rs.length === 0 ? <p className="muted px-3.5 py-3 text-[13px]">No matchups.</p> : (
                <ul className="divide-y divide-line">{rs.map((r) => (
                  <li key={r.matchup.id} className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2 text-[13px]">
                    <span><Link className="font-semibold hover:underline" href={`/l/${slug}/matchup/${r.matchup.id}`}>{participant(ctx, r.a.participantId, kind).name}{r.b ? ` vs ${participant(ctx, r.b.participantId, kind).name}` : " — bye"}</Link> {r.official && !r.isBye ? <Badge tone="win">FINAL</Badge> : r.matchup.state !== "scheduled" ? <Badge tone="warn">{r.matchup.state.replace("_", " ").toUpperCase()}</Badge> : null}</span>
                    {!isOfficial(r.matchup.state) || r.isBye ? (
                      <span className="flex items-center gap-2">
                        {!r.isBye ? <ActionForm action={moveMatchupAction.bind(null, slug, r.matchup.id)} submit="Move" submitClass="btn btn-sm" className="flex items-center gap-1.5"><label className="sr-only" htmlFor={`mv${r.matchup.id}`}>Move to week</label><select id={`mv${r.matchup.id}`} name="week" className="select !h-8 !w-20 text-xs" defaultValue={w.number}>{weeks.map((x) => <option key={x.number} value={x.number}>{x.number}</option>)}</select></ActionForm> : null}
                        <ConfirmAction className="btn btn-danger btn-sm" action={deleteMatchupAction.bind(null, slug, r.matchup.id)} confirm="Remove this matchup from the schedule?">Remove</ConfirmAction>
                      </span>
                    ) : <span className="faint text-xs">Finalized — reopen to change</span>}
                  </li>
                ))}</ul>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
