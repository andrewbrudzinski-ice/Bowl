import { archiveLeagueAction, inviteAction, leaveAction, linkBowlerAction, memberStatusAction, revokeInviteAction, setRoleAction, transferAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { ConfirmAction } from "@/components/confirm-action";
import { Alert, Badge, Card, CardHead, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, assignableRoles } from "@/server/permissions";
import { listInvitations, listMembers } from "@/server/services/leagues";
import { formatDateTime } from "@/server/views";

export const metadata = { title: "Members" };

export default async function Members({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ error?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "members.invite_basic");
  const store = getStore();
  const members = await listMembers(store, ctx.actor!, ctx.league.id);
  const invites = await listInvitations(store, ctx.actor!, ctx.league.id);
  const can = ctx.can("members.manage");
  const mine = ctx.role!;
  const grantable = assignableRoles(mine);
  const bowlers = ctx.model?.data.bowlers ?? [];
  const active = members.filter((m) => m.status === "active");
  const inactive = members.filter((m) => m.status !== "active");
  return (
    <div className="grid gap-4">
      <PageHeader title="Members & access" eyebrow={ctx.league.name} sub="Roles control what each person can do. Permissions are enforced on the server, not just hidden in the interface." />
      {sp.error ? <Alert tone="error">{sp.error}</Alert> : null}
      <Card>
        <CardHead title="Invite someone" />
        <div className="p-4"><ActionForm action={inviteAction.bind(null, slug)} submit="Create invitation" reset className="grid gap-3 sm:grid-cols-4">
          <div className="field sm:col-span-2"><label htmlFor="iv-e">Email (optional)</label><input id="iv-e" name="email" type="email" className="input" placeholder="friend@example.com" /><span className="help">Leave blank for a shareable link anyone can use once. With an email, only that address can accept.</span></div>
          <div className="field"><label htmlFor="iv-r">Role</label><select id="iv-r" name="role" className="select" defaultValue="bowler">{grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div>
          <div className="field"><label htmlFor="iv-t">Expires in</label><select id="iv-t" name="ttl" className="select" defaultValue="7"><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></div>
        </ActionForm></div>
        {invites.length ? <ul className="divide-y divide-line border-t border-line">{invites.slice(0, 10).map((i) => { const state = i.revokedAt ? "revoked" : i.acceptedAt ? "used" : i.expiresAt < new Date().toISOString() ? "expired" : "pending"; return <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-[13px]"><span>{ROLE_LABELS[i.role]} · {i.email ?? "link"} <Badge tone={state === "pending" ? "accent" : state === "used" ? "win" : "neutral"}>{state.toUpperCase()}</Badge> <span className="faint text-xs">{formatDateTime(i.createdAt)}</span></span>{state === "pending" ? <ConfirmAction className="btn btn-ghost btn-sm" action={revokeInviteAction.bind(null, slug, i.id)} confirm="Revoke this invitation?">Revoke</ConfirmAction> : null}</li>; })}</ul> : null}
      </Card>

      <Card>
        <CardHead title={`Members (${active.length})`} />
        <ul className="divide-y divide-line">
          {active.map((m) => {
            const isSelf = m.userId === ctx.actor!.id;
            const editable = can && !isSelf && m.role !== "owner" && grantable.includes(m.role);
            return (
              <li key={m.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="font-semibold">{m.name}{isSelf ? <span className="muted"> (you)</span> : null}</div><div className="muted text-xs">{ctx.can("members.manage") ? m.email : ""} · joined {formatDateTime(m.joinedAt)}</div></div>
                  <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_LABELS[m.role].toUpperCase()}</Badge>
                </div>
                {editable ? (
                  <div className="mt-2 flex flex-wrap items-end gap-3">
                    <ActionForm action={setRoleAction.bind(null, slug, m.userId)} submit="Change role" submitClass="btn btn-sm" className="flex items-end gap-2"><div className="field"><label htmlFor={`r-${m.id}`} className="sr-only">Role</label><select id={`r-${m.id}`} name="role" defaultValue={m.role} className="select !h-8 !w-52 text-xs">{grantable.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select></div></ActionForm>
                    {bowlers.length ? <ActionForm action={linkBowlerAction.bind(null, slug, m.userId)} submit="Link" submitClass="btn btn-sm" className="flex items-end gap-2"><div className="field"><label htmlFor={`b-${m.id}`} className="sr-only">Linked bowler</label><select id={`b-${m.id}`} name="bowler" defaultValue={m.bowlerId ?? ""} className="select !h-8 !w-44 text-xs"><option value="">No bowler linked</option>{bowlers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div></ActionForm> : null}
                    <ConfirmAction className="btn btn-danger btn-sm" action={memberStatusAction.bind(null, slug, m.userId, "deactivated")} confirm={`Revoke ${m.name}'s access? Their scores and history are kept.`}>Revoke access</ConfirmAction>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      {inactive.length ? <Card><CardHead title="Former members" /><ul className="divide-y divide-line">{inactive.map((m) => <li key={m.id} className="flex items-center justify-between gap-2 px-4 py-2 text-[13px]"><span>{m.name} <span className="muted">· {m.status}</span></span>{can ? <ConfirmAction action={memberStatusAction.bind(null, slug, m.userId, "active")}>Restore access</ConfirmAction> : null}</li>)}</ul></Card> : null}

      <Card>
        <CardHead title="What each role can do" />
        <ul className="divide-y divide-line">{ROLES.map((r) => <li key={r} className="px-4 py-2 text-[13px]"><b>{ROLE_LABELS[r]}</b> <span className="muted">— {ROLE_DESCRIPTIONS[r]}</span></li>)}</ul>
      </Card>

      <Card>
        <CardHead title="Ownership & leaving" />
        <div className="grid gap-4 p-4">
          {ctx.can("ownership.transfer") ? (
            <ActionForm action={transferAction.bind(null, slug)} submit="Transfer ownership" submitClass="btn btn-danger" className="grid gap-2 sm:max-w-md">
              <div className="field"><label htmlFor="to">New owner</label><select id="to" name="to" className="select">{active.filter((m) => m.userId !== ctx.actor!.id).map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select></div>
              <div className="field"><label htmlFor="cf">Type the league name to confirm</label><input id="cf" name="confirm" className="input" autoComplete="off" /></div>
              <span className="help">You'll become a commissioner. Only the new owner can transfer it back.</span>
            </ActionForm>
          ) : null}
          <form action={leaveAction.bind(null, slug)}><button className="btn btn-danger btn-sm" type="submit">Leave this league</button><span className="help ml-2">Owners must transfer ownership first.</span></form>
          {ctx.can("league.delete") ? <ActionForm action={archiveLeagueAction.bind(null, slug)} submit="Archive league" submitClass="btn btn-danger" className="grid gap-2 border-t border-line pt-3 sm:max-w-md"><div className="field"><label htmlFor="ar">Archive this league (hides it from everyone; data is retained)</label><input id="ar" name="confirm" className="input" placeholder="Type the league name" autoComplete="off" /></div></ActionForm> : null}
          <p className="faint text-xs">Locked out of every administrator account? The site operator can restore an owner with <code>npm run recover-owner -- {slug} you@example.com</code> (see the handoff docs).</p>
        </div>
      </Card>
    </div>
  );
}
