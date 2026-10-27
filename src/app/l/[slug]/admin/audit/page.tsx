import Link from "next/link";
import { Badge, Card, CardHead, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { formatDateTime } from "@/server/views";

export const metadata = { title: "Audit log" };

const GROUPS: [string, string][] = [["", "All"], ["result", "Results"], ["scores", "Scores"], ["rules", "Rules"], ["roster", "Rosters"], ["team", "Teams"], ["matchup", "Schedule"], ["week", "Dates"], ["schedule", "Schedule"], ["member", "Members"], ["season", "Seasons"], ["data", "Imports"], ["league", "League"]];

export default async function Audit({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ type?: string; page?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, undefined, "audit.view");
  const page = Math.max(1, Number(sp.page) || 1);
  const per = 40;
  const all = getStore().read((db) => db.audit.filter((a) => a.leagueId === ctx.league.id && (!sp.type || a.action.startsWith(sp.type))).sort((a, b) => b.at.localeCompare(a.at)));
  const rows = all.slice((page - 1) * per, page * per);
  return (
    <div>
      <PageHeader title="Audit log" eyebrow={ctx.league.name} sub="Every important change: who made it, when, and what it was before and after. The log is append-only — nobody can edit or delete entries." />
      <nav className="pill-nav mb-3" aria-label="Filter">{[...new Map(GROUPS).entries()].map(([k, l]) => <Link key={k || "all"} className="tab" href={`/l/${slug}/admin/audit${k ? `?type=${k}` : ""}`} aria-current={(sp.type ?? "") === k ? "page" : undefined}>{l}</Link>)}</nav>
      <Card>
        <CardHead title={`${all.length} entries`} />
        {rows.length === 0 ? <EmptyState title="Nothing recorded" /> : (
          <ul className="divide-y divide-line">{rows.map((a) => (
            <li key={a.id} className="px-3.5 py-2.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2"><Badge>{a.action}</Badge><span className="font-semibold">{a.userName}</span><span className="faint text-xs">{formatDateTime(a.at)}</span></div>
              {a.note ? <div className="muted mt-0.5">“{a.note}”</div> : null}
              {a.before != null || a.after != null ? (
                <details className="mt-1"><summary className="faint cursor-pointer text-xs hover:text-muted">Before / after</summary>
                  <div className="mt-1 grid gap-2 md:grid-cols-2"><pre className="max-h-56 overflow-auto rounded bg-bg p-2 text-[11px] leading-snug">{JSON.stringify(a.before, null, 1)}</pre><pre className="max-h-56 overflow-auto rounded bg-bg p-2 text-[11px] leading-snug">{JSON.stringify(a.after, null, 1)}</pre></div>
                </details>
              ) : null}
            </li>
          ))}</ul>
        )}
        {all.length > per ? <div className="flex justify-between border-t border-line px-3.5 py-2 text-[13px]">{page > 1 ? <Link className="btn btn-sm" href={`/l/${slug}/admin/audit?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), page: String(page - 1) })}`}>← Newer</Link> : <span />}{page * per < all.length ? <Link className="btn btn-sm" href={`/l/${slug}/admin/audit?${new URLSearchParams({ ...(sp.type ? { type: sp.type } : {}), page: String(page + 1) })}`}>Older →</Link> : null}</div> : null}
      </Card>
    </div>
  );
}
