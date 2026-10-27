import Link from "next/link";
import type { ReactNode } from "react";
import { getLeagueCtx } from "@/server/context";
import { AdminTabs } from "@/components/admin-tabs";

export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug, undefined, "league.view_admin");
  const base = `/l/${slug}/admin`;
  const items = [
    { href: base, label: "Overview", show: true },
    { href: `${base}/scores`, label: "Score entry", show: ctx.can("scores.enter") },
    { href: `${base}/roster`, label: "Teams & roster", show: ctx.can("roster.manage") },
    { href: `${base}/schedule`, label: "Schedule", show: ctx.can("schedule.manage") },
    { href: `${base}/news`, label: "News", show: ctx.can("announcements.post") },
    { href: `${base}/settings`, label: "Settings", show: ctx.can("settings.general") || ctx.can("settings.rules") },
    { href: `${base}/members`, label: "Members", show: ctx.can("members.invite_basic") },
    { href: `${base}/seasons`, label: "Seasons", show: ctx.can("season.manage") },
    { href: `${base}/data`, label: "Import / export", show: ctx.can("data.export") },
    { href: `${base}/audit`, label: "Audit log", show: ctx.can("audit.view") },
  ].filter((i) => i.show);
  return (
    <div>
      <div className="mb-1 flex items-center gap-2"><span className="badge badge-accent">COMMISSIONER</span><Link href={`/l/${slug}`} className="muted text-xs hover:text-fg">← Back to league</Link></div>
      <AdminTabs items={items} base={base} />
      {children}
    </div>
  );
}
