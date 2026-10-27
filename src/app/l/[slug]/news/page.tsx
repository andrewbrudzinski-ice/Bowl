import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { ANNOUNCEMENT_CATEGORIES } from "@/server/services/content";
import { formatDateTime } from "@/server/views";

export const metadata = { title: "News" };

export default async function News({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ cat?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug);
  const items = getStore().read((db) => db.announcements.filter((a) => a.leagueId === ctx.league.id && (!sp.cat || a.category === sp.cat)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt)));
  return (
    <div>
      <PageHeader title="League news" sub="Announcements from the commissioner — dates, schedule changes, rules, events and recaps." actions={ctx.can("announcements.post") ? <Link href={`/l/${slug}/admin/news`} className="btn btn-primary btn-sm">Post an announcement</Link> : undefined} />
      <nav className="pill-nav mb-4" aria-label="Categories"><Link className="tab" href={`/l/${slug}/news`} aria-current={!sp.cat ? "page" : undefined}>All</Link>{ANNOUNCEMENT_CATEGORIES.map((c) => <Link key={c.id} className="tab" href={`/l/${slug}/news?cat=${c.id}`} aria-current={sp.cat === c.id ? "page" : undefined}>{c.label}</Link>)}</nav>
      {items.length === 0 ? <Card><EmptyState title="No announcements">{ctx.can("announcements.post") ? "Post one from Commissioner → News." : "Nothing has been posted yet."}</EmptyState></Card> : (
        <div className="grid gap-3">{items.map((a) => (
          <article key={a.id} id={a.id} className="card p-4 target:border-[var(--accent)]">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">{a.pinned ? <Badge tone="accent">PINNED</Badge> : null}<Badge>{ANNOUNCEMENT_CATEGORIES.find((c) => c.id === a.category)?.label}</Badge></div>
            <h2 className="text-[16px] font-bold">{a.title}</h2>
            <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed">{a.body}</p>
            <p className="faint mt-2 text-xs">Posted {formatDateTime(a.createdAt)} by {a.createdByName}{a.updatedAt !== a.createdAt ? ` · edited ${formatDateTime(a.updatedAt)} by ${a.updatedByName}` : ""}{ctx.can("announcements.post") ? <> · <Link className="underline" href={`/l/${slug}/admin/news?edit=${a.id}`}>Edit</Link></> : null}</p>
          </article>
        ))}</div>
      )}
    </div>
  );
}
