import Link from "next/link";
import { markReadAction } from "@/app/actions/auth";
import { Badge, Card, EmptyState } from "@/components/ui";
import { requireActor } from "@/server/session";
import { getStore } from "@/server/db";
import { listNotifications } from "@/server/services/content";
import { formatDateTime } from "@/server/views";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const actor = await requireActor("/notifications");
  const items = await listNotifications(getStore(), actor.id);
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <div className="wrap max-w-3xl py-8">
      <div className="mb-4 flex items-center justify-between"><div><Link href="/" className="muted text-[13px] hover:text-fg">← Home</Link><h1 className="h-page mt-2">Notifications</h1></div>{unread ? <form action={markReadAction}><button className="btn btn-sm" type="submit">Mark all read</button></form> : null}</div>
      <Card>
        {items.length === 0 ? <EmptyState title="You're all caught up">League news, results and invitations will appear here. Choose what you get in <Link className="underline" href="/account">Account settings</Link>.</EmptyState> : (
          <ul className="divide-y divide-line">{items.map((n) => (
            <li key={n.id}><Link href={n.href} className="card-link block px-4 py-3"><div className="flex items-center gap-2"><span className="text-[14px] font-semibold">{n.title}</span>{!n.readAt ? <Badge tone="accent">NEW</Badge> : null}</div><div className="muted text-[13px]">{n.body}</div><div className="faint mt-0.5 text-xs">{n.leagueName} · {formatDateTime(n.createdAt)}</div></Link></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
