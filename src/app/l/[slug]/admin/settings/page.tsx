import Link from "next/link";
import { generalAction, rotateTokenAction, visibilityAction, commissionerAwardAction, removeCommissionerAwardAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { RulesEditor } from "@/components/rules-editor";
import { AwardsEditor, HomepageEditor } from "@/components/settings-editors";
import { Alert, Badge, Card, CardHead, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { AWARD_DEFS, defaultAwardsConfig } from "@/domain/awards";
import { firstEligibleWeek } from "@/domain/rulechange";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { HOMEPAGE_MODULES } from "@/server/services/leagues";

export const metadata = { title: "League settings" };

export default async function Settings({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ section?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug);
  const section = sp.section ?? (ctx.can("settings.general") ? "general" : "rules");
  if (!ctx.can("settings.general") && !ctx.can("settings.rules")) return <Card><EmptyState title="You don't have access to settings" /></Card>;
  const base = `/l/${slug}/admin/settings`;
  const tabs = [
    { key: "general", label: "General", show: ctx.can("settings.general") }, { key: "rules", label: "Rules", show: ctx.can("settings.rules") },
    { key: "appearance", label: "Homepage", show: ctx.can("settings.general") }, { key: "awards", label: "Awards", show: ctx.can("awards.manage") },
    { key: "visibility", label: "Visibility & access", show: ctx.can("settings.general") },
  ].filter((t) => t.show).map((t) => ({ key: t.key, label: t.label, href: `${base}?section=${t.key}` }));
  const l = ctx.league;
  const m = ctx.model;
  const store = getStore();
  const commissionerAwards = ctx.season ? store.read((db) => db.commissionerAwards.filter((a) => a.leagueId === l.id && a.seasonId === ctx.season!.id)) : [];
  const names: Record<string, string> = {};
  if (m) { for (const b of m.data.bowlers) names[b.id] = b.name; for (const t of m.data.teams) names[t.id] = t.name; }
  const origin = process.env.APP_URL ?? "";
  return (
    <div>
      <PageHeader title="League settings" eyebrow={l.name} />
      <Tabs items={tabs} current={section} />
      {section === "general" && ctx.can("settings.general") ? (
        <Card><CardHead title="General" /><div className="p-4"><ActionForm action={generalAction.bind(null, slug)} submit="Save changes" className="grid gap-3 sm:grid-cols-2">
          <div className="field sm:col-span-2"><label htmlFor="g-name">League name</label><input id="g-name" name="name" defaultValue={l.name} className="input" required maxLength={60} /></div>
          <div className="field sm:col-span-2"><label htmlFor="g-desc">Description</label><textarea id="g-desc" name="description" defaultValue={l.description} className="textarea" maxLength={300} /></div>
          <div className="field"><label htmlFor="g-logo">Logo letters</label><input id="g-logo" name="logoText" defaultValue={l.logoText} className="input" maxLength={3} /></div>
          <div className="field"><label htmlFor="g-acc">Accent color</label><input id="g-acc" name="accent" type="color" defaultValue={l.accent} className="h-9 w-20 rounded border border-line-strong bg-bg p-0.5" /></div>
        </ActionForm></div></Card>
      ) : null}
      {section === "rules" && ctx.can("settings.rules") ? (
        ctx.season && m ? (
          <div className="grid gap-4">
            <Alert tone="info" title={`Editing rules for ${ctx.season.name} (version ${ctx.season.ruleVersions[ctx.season.ruleVersions.length - 1].version})`}>Every change is previewed first and recorded in the audit log. Past seasons keep the rules they were played under. <Link className="underline" href={`/l/${slug}/rules`}>See the rules page</Link>.</Alert>
            <RulesEditor slug={slug} seasonId={ctx.season.id} seasonName={ctx.season.name} current={ctx.cfg} leagueDefault={l.defaultConfig} hasScores={m.data.scores.length > 0} eligibleWeek={firstEligibleWeek(m.data)} totalWeeks={m.data.weeks.length} names={names} canApplyHistorical={ctx.can("settings.rules")} />
          </div>
        ) : <Card><EmptyState title="Create a season to edit its rules" /></Card>
      ) : null}
      {section === "appearance" && ctx.can("settings.general") ? <Card><CardHead title="Homepage modules" /><div className="p-4"><HomepageEditor slug={slug} modules={l.homepage} labels={Object.fromEntries(HOMEPAGE_MODULES.map((x) => [x.id, { label: x.label, description: x.description }]))} /></div></Card> : null}
      {section === "awards" && ctx.can("awards.manage") ? (
        <div className="grid gap-4">
          <Card><CardHead title="Statistical awards" /><div className="p-4"><AwardsEditor slug={slug} defs={AWARD_DEFS} value={{ ...defaultAwardsConfig(), ...l.awards }} /></div></Card>
          {ctx.season && m ? (
            <Card><CardHead title="Commissioner awards" right={<Badge tone="info">SUBJECTIVE</Badge>} />
              <div className="p-4"><ActionForm action={commissionerAwardAction.bind(null, slug, ctx.season.id)} submit="Give award" reset className="grid gap-3 sm:grid-cols-2">
                <div className="field"><label htmlFor="ca-t">Award name</label><input id="ca-t" name="title" required maxLength={80} className="input" placeholder="Sportsmanship Award" /></div>
                <div className="field"><label htmlFor="ca-r">Recipient</label><select id="ca-r" name="recipient" className="select">{m.data.bowlers.filter((b) => m.data.roster.some((r) => r.bowlerId === b.id)).map((b) => <option key={b.id} value={`bowler:${b.id}`}>{b.name}</option>)}{m.data.teams.filter((t) => t.active).map((t) => <option key={t.id} value={`team:${t.id}`}>Team: {t.name}</option>)}</select></div>
                <div className="field"><label htmlFor="ca-w">Week (optional)</label><input id="ca-w" name="week" type="number" min={1} className="input" /></div>
                <div className="field sm:col-span-2"><label htmlFor="ca-n">Why</label><input id="ca-n" name="note" maxLength={300} className="input" /></div>
              </ActionForm></div>
              {commissionerAwards.length ? <ul className="divide-y divide-line border-t border-line">{commissionerAwards.map((a) => <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-[13px]"><span><b>{a.title}</b> → {names[a.recipientId] ?? "?"}{a.week ? ` (week ${a.week})` : ""}<span className="muted"> · {a.note}</span></span><ConfirmAction className="btn btn-ghost btn-sm" action={removeCommissionerAwardAction.bind(null, slug, a.id)} confirm="Remove this award?">Remove</ConfirmAction></li>)}</ul> : null}
            </Card>
          ) : null}
        </div>
      ) : null}
      {section === "visibility" && ctx.can("settings.general") ? (
        <div className="grid gap-4">
          <Card><CardHead title="Who can see this league" right={<Badge tone="accent">{l.visibility.toUpperCase()}</Badge>} />
            <div className="grid gap-3 p-4">
              {ctx.can("settings.visibility") ? (
                <ActionForm action={visibilityAction.bind(null, slug)} submit="Update visibility">
                  {([["private", "Private", "Only invited members."], ["unlisted", "Unlisted", "Anyone with the private link can view standings and results."], ["public", "Public", "Anyone can view standings and results; the league appears in public lists."]] as const).map(([v, t, d]) => <label key={v} className="card flex cursor-pointer items-start gap-3 p-3 has-[:checked]:border-[var(--accent)]"><input type="radio" name="visibility" value={v} defaultChecked={l.visibility === v} className="mt-1 accent-[var(--accent)]" /><span><span className="font-semibold">{t}</span><span className="help block">{d}</span></span></label>)}
                </ActionForm>
              ) : <Alert tone="info">Only the league owner can change visibility.</Alert>}
              <p className="help">Admin tools, the audit log, member emails and private notes are never shown to non-members, whatever the visibility. Changing visibility also replaces the private link.</p>
            </div>
          </Card>
          {l.visibility === "unlisted" && ctx.can("settings.visibility") ? <Card><CardHead title="Private link" /><div className="grid gap-2 p-4"><code className="num break-all rounded bg-bg p-2 text-xs">{`${origin}/l/${slug}/enter?t=${l.shareToken}`}</code><ActionForm action={rotateTokenAction.bind(null, slug)} submit="Generate a new link (revokes the old one)" submitClass="btn btn-danger btn-sm"><span className="help">Anyone holding the old link loses access.</span></ActionForm></div></Card> : null}
          <Card><CardHead title="Members & permissions" /><p className="p-4 text-[13px]">Invite people, assign roles and revoke access in <Link className="underline" href={`/l/${slug}/admin/members`}>Members</Link>.</p></Card>
        </div>
      ) : null}
    </div>
  );
}
