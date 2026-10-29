import Link from "next/link";
import { firstEligibleWeek } from "@/domain/rulechange";
import { fmt1 } from "@/domain/math";
import { bowlerSeasonStats } from "@/domain/stats";
import { addBowlerAction, addTeamAction, bowlerStatusAction, changeTeamAction, removeRosterAction, rosterAddAction, setAverageAction, subAction, updateTeamAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { Avatar, Badge, Card, CardHead, EmptyState, PageHeader, TeamMark } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";

export const metadata = { title: "Teams & roster" };

export default async function RosterAdmin({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug, undefined, "roster.manage");
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="Create a season first" /></Card>;
  const m = ctx.model;
  const season = ctx.season;
  const stats = bowlerSeasonStats(m);
  const eligible = firstEligibleWeek(m.data);
  const teams = m.data.teams.filter((t) => t.active);
  const onRoster = new Set(m.data.roster.map((r) => r.bowlerId));
  const free = m.data.bowlers.filter((b) => !onRoster.has(b.id) && b.active);
  const individual = ctx.cfg.format === "individual";
  const entries = m.data.roster.filter((r) => r.toWeek == null);
  return (
    <div className="grid gap-6 md:gap-8">
      <PageHeader title="Teams & roster" eyebrow={season.name} sub="Bowlers are people; the roster is who bowls for whom this season. Moving a bowler never changes past results." />
      <div className="grid gap-4 lg:grid-cols-2">
        {!individual ? (
          <Card>
            <CardHead title="Teams" />
            <ul className="divide-y divide-line">
              {m.data.teams.map((t) => (
                <li key={t.id} className="px-5 py-2.5">
                  <details>
                    <summary className="flex cursor-pointer items-center gap-2"><TeamMark name={t.name} color={t.color} logo={t.logo} size={24} /><span className="font-semibold">{t.name}</span>{!t.active ? <Badge tone="warn">INACTIVE</Badge> : null}<span className="faint ml-auto text-[13px]">Edit</span></summary>
                    <div className="mt-2"><ActionForm action={updateTeamAction.bind(null, slug, t.id)} submit="Save team" className="grid gap-2 sm:grid-cols-2">
                      <div className="field"><label htmlFor={`tn-${t.id}`}>Name</label><input id={`tn-${t.id}`} name="name" defaultValue={t.name} className="input" /></div>
                      <div className="field"><label htmlFor={`ts-${t.id}`}>Short name</label><input id={`ts-${t.id}`} name="shortName" defaultValue={t.shortName} className="input" maxLength={5} /></div>
                      <div className="field"><label htmlFor={`tc-${t.id}`}>Color</label><input id={`tc-${t.id}`} name="color" type="color" defaultValue={t.color} className="h-9 w-16 rounded border border-line-strong bg-bg p-0.5" /></div>
                      <div className="field"><label htmlFor={`tl-${t.id}`}>Logo letter</label><input id={`tl-${t.id}`} name="logo" defaultValue={t.logo} className="input" maxLength={3} /></div>
                      <label className="check sm:col-span-2"><input type="checkbox" name="active" defaultChecked={t.active} />Active (inactive teams keep their history)</label>
                    </ActionForm></div>
                  </details>
                </li>
              ))}
              {m.data.teams.length === 0 ? <li><EmptyState title="No teams yet" /></li> : null}
            </ul>
            <div className="border-t border-line p-5"><ActionForm action={addTeamAction.bind(null, slug)} submit="Add team" className="flex flex-wrap items-end gap-2" reset><div className="field"><label htmlFor="tname">New team name</label><input id="tname" name="name" required maxLength={40} className="input !w-52" /></div></ActionForm></div>
          </Card>
        ) : null}
        <Card>
          <CardHead title="Add a bowler" />
          <div className="p-5"><ActionForm action={addBowlerAction.bind(null, slug, season.id)} submit="Add bowler to this season" reset className="grid gap-3 sm:grid-cols-2">
            <div className="field"><label htmlFor="bname">Name</label><input id="bname" name="name" required maxLength={60} className="input" /></div>
            <div className="field"><label htmlFor="bnick">Nickname (optional)</label><input id="bnick" name="nickname" maxLength={30} className="input" /></div>
            {!individual ? <div className="field"><label htmlFor="bteam">Team</label><select id="bteam" name="team" className="select"><option value="">No team (substitute pool)</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div> : null}
            <div className="field"><label htmlFor="bavg">Entering average</label><input id="bavg" name="entering" type="number" min={0} max={300} className="input" aria-describedby="bavg-h" /><span id="bavg-h" className="help">Used for handicap until enough games are bowled. Leave blank for brand-new bowlers — your new-bowler rule applies.</span></div>
            <div className="field"><label htmlFor="bphoto">Photo link (optional, https)</label><input id="bphoto" name="avatarUrl" type="url" className="input" placeholder="https://…" /></div>
            <label className="check self-end"><input type="checkbox" name="isSub" />Substitute only</label>
          </ActionForm></div>
          {free.length ? <div className="border-t border-line p-5"><div className="eyebrow mb-2">Existing bowlers not on this season's roster</div><ActionForm action={rosterAddAction.bind(null, slug, season.id)} submit="Add to roster" className="flex flex-wrap items-end gap-2"><div className="field"><label htmlFor="rb">Bowler</label><select id="rb" name="bowler" className="select !w-48">{free.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>{!individual ? <div className="field"><label htmlFor="rt">Team</label><select id="rt" name="team" className="select !w-40"><option value="">None</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div> : null}<div className="field"><label htmlFor="ra">Entering avg</label><input id="ra" name="entering" type="number" className="input !w-24" /></div></ActionForm></div> : null}
        </Card>
      </div>

      <Card>
        <CardHead title={`${season.name} roster`} right={<span className="muted">Changes take effect from week {eligible}+</span>} />
        {entries.length === 0 ? <EmptyState title="Nobody is on the roster yet">Add bowlers above, or import a roster CSV from Import / export.</EmptyState> : (
          <ul className="divide-y divide-line">
            {entries.map((e) => {
              const b = m.bowlerById.get(e.bowlerId)!;
              const s = stats.find((x) => x.bowlerId === e.bowlerId);
              const t = e.teamId ? m.teamById.get(e.teamId) : null;
              return (
                <li key={e.id} className="px-5 py-2.5">
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                      <Avatar name={b.name} color={b.avatarColor} url={b.avatarUrl} size={28} />
                      <span className="font-semibold">{b.name}</span>
                      <span className="muted text-[13px]">{t?.name ?? (e.isSub ? "Substitute" : "No team")}</span>
                      {e.isSub ? <Badge>SUB</Badge> : null}{!b.active ? <Badge tone="warn">INACTIVE</Badge> : null}
                      <span className="num muted ml-auto text-[13px]">ent {e.enteringAverage ?? "—"} · avg {fmt1(s?.average)} · {s?.games ?? 0} gms</span>
                    </summary>
                    <div className="mt-3 grid gap-4 pl-9 md:grid-cols-3">
                      <div className="md:col-span-3"><Link href={`/l/${slug}/bowlers/${b.id}`} className="text-[13px] font-semibold text-[var(--accent-text)] underline underline-offset-4">View {b.name}'s profile</Link></div>
                      {!individual ? <ActionForm action={changeTeamAction.bind(null, slug, season.id)} submit="Change team" className="grid gap-2"><input type="hidden" name="bowler" value={b.id} /><div className="field"><label htmlFor={`ct-${e.id}`}>Move to</label><select id={`ct-${e.id}`} name="team" className="select" defaultValue={e.teamId ?? ""}><option value="">No team</option>{teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div><div className="field"><label htmlFor={`cw-${e.id}`}>Starting week</label><input id={`cw-${e.id}`} name="week" type="number" min={eligible} defaultValue={eligible} className="input" /></div></ActionForm> : null}
                      <ActionForm action={setAverageAction.bind(null, slug, season.id)} submit="Save average" className="grid gap-2"><input type="hidden" name="bowler" value={b.id} /><div className="field"><label htmlFor={`ea-${e.id}`}>Entering average</label><input id={`ea-${e.id}`} name="entering" type="number" min={0} max={300} defaultValue={e.enteringAverage ?? ""} className="input" /></div><span className="help">Finalized weeks keep their locked handicaps.</span></ActionForm>
                      <div className="flex flex-wrap content-start gap-2">
                        {!individual ? <ConfirmAction action={subAction.bind(null, slug, season.id, b.id, !e.isSub)}>{e.isSub ? "Make regular" : "Make substitute"}</ConfirmAction> : null}
                        <ConfirmAction action={bowlerStatusAction.bind(null, slug, b.id, !b.active)} confirm={b.active ? `Deactivate ${b.name}? Their history and stats are kept; they just won't be added to new lineups.` : undefined}>{b.active ? "Deactivate" : "Reactivate"}</ConfirmAction>
                        <ConfirmAction className="btn btn-danger btn-sm" action={removeRosterAction.bind(null, slug, season.id, b.id)} confirm={`Remove ${b.name} from this season's roster? Only possible if they have no recorded scores.`}>Remove from season</ConfirmAction>
                      </div>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
