import Link from "next/link";
import { postNewsAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Card, CardHead, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { ANNOUNCEMENT_CATEGORIES } from "@/server/services/content";

export const metadata = { title: "Post news" };

export default async function NewsAdmin({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "announcements.post");
  const edit = sp.edit ? await getStore().read((db) => db.announcements.find((a) => a.id === sp.edit && a.leagueId === ctx.league.id) ?? null) : null;
  return (
    <div className="grid gap-4">
      <PageHeader title={edit ? "Edit announcement" : "Post an announcement"} eyebrow={ctx.league.name} sub="Members are notified once per announcement — editing it later doesn't send another notification. All posts are kept in the news archive." actions={<Link href={`/l/${slug}/news`} className="btn btn-sm">View archive</Link>} />
      <Card><CardHead title={edit ? "Edit" : "New announcement"} />
        <div className="p-4"><ActionForm key={edit?.id ?? "new"} action={postNewsAction.bind(null, slug, edit?.id ?? null)} submit={edit ? "Save changes" : "Post announcement"} reset={!edit} className="grid gap-3">
          <div className="field"><label htmlFor="n-t">Title</label><input id="n-t" name="title" required maxLength={120} defaultValue={edit?.title} className="input" /></div>
          <div className="field"><label htmlFor="n-c">Type</label><select id="n-c" name="category" defaultValue={edit?.category ?? "general"} className="select !w-56">{ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="field"><label htmlFor="n-b">Message</label><textarea id="n-b" name="body" required maxLength={5000} defaultValue={edit?.body} className="textarea !min-h-40" /></div>
          <label className="check"><input type="checkbox" name="pinned" defaultChecked={edit?.pinned} />Pin to the top of the homepage and archive</label>
        </ActionForm></div>
      </Card>
    </div>
  );
}
