import Link from "next/link";
import { fmt1, fmtPts } from "@/domain/math";
import { computeStandings } from "@/domain/standings";
import { seasonParam } from "@/components/links";
import { Card, EmptyState, FormChips, PageHeader, TeamMark } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";

export const metadata = { title: "Teams" };

export default async function Teams({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const sq = seasonParam(ctx);
  const { rows } = computeStandings(m, { scope: "team" });
  const teams = m.data.teams.filter((t) => t.active || m.data.roster.some((r) => r.teamId === t.id));
  const row = new Map(rows.map((r) => [r.id, r]));
  return (
    <div>
      <PageHeader title="Teams" eyebrow={ctx.season.name} actions={ctx.can("roster.manage") ? <Link href={`/l/${slug}/admin/roster`} className="btn btn-sm">Manage teams</Link> : undefined} />
      {teams.length === 0 ? <Card><EmptyState title="No teams yet" action={ctx.can("roster.manage") ? <Link className="btn btn-primary" href={`/l/${slug}/admin/roster`}>Add teams</Link> : undefined} /></Card> : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[...teams].sort((a, b) => (row.get(a.id)?.rank ?? 99) - (row.get(b.id)?.rank ?? 99)).map((t) => {
            const r = row.get(t.id);
            const roster = m.data.roster.filter((x) => x.teamId === t.id && x.toWeek == null).map((x) => m.bowlerById.get(x.bowlerId)?.name).filter(Boolean);
            return (
              <li key={t.id} className="card card-link relative p-3.5">
                <Link href={`/l/${slug}/teams/${t.id}${sq ? `?season=${sq}` : ""}`} className="after:absolute after:inset-0">
                  <div className="flex items-center gap-3"><TeamMark name={t.name} color={t.color} logo={t.logo} size={40} /><div className="min-w-0"><div className="truncate text-[15px] font-bold">{t.name}</div><div className="muted num text-xs">{r && r.played ? `#${r.rank} · ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""} · ${fmtPts(r.points)} pts` : "No results yet"}</div></div></div>
                  <div className="muted mt-2 line-clamp-2 text-xs">{roster.join(", ") || "No bowlers assigned"}</div>
                  <div className="mt-2 flex items-center justify-between"><FormChips form={r?.form ?? []} /><span className="muted num text-xs">Avg {fmt1(r?.average)}</span></div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
