import Link from "next/link";
import { fmt1 } from "@/domain/math";
import { bowlerSeasonStats } from "@/domain/stats";
import { seasonParam } from "@/components/links";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";

export const metadata = { title: "Bowlers" };

export default async function Bowlers({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; q?: string; all?: string; sort?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const sq = seasonParam(ctx);
  const stats = bowlerSeasonStats(m);
  const q = (sp.q ?? "").trim().toLowerCase();
  const sort = sp.sort ?? "avg";
  const inSeason = new Set(m.data.roster.map((r) => r.bowlerId));
  let rows = stats.filter((s) => inSeason.has(s.bowlerId) && (sp.all === "1" || m.bowlerById.get(s.bowlerId)?.active !== false) && (!q || s.name.toLowerCase().includes(q)));
  rows = rows.sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "hg" ? (b.highGame?.scratch ?? 0) - (a.highGame?.scratch ?? 0) : sort === "games" ? b.games - a.games : (b.average ?? -1) - (a.average ?? -1));
  const showHdcp = ctx.cfg.handicap.enabled;
  const teamName = (id: string | null) => (id ? m.teamById.get(id)?.name : null);
  const link = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sq ? { season: sq } : {}), ...(sp.q ? { q: sp.q } : {}), ...(sp.all ? { all: sp.all } : {}), ...(sp.sort ? { sort: sp.sort } : {}), ...extra });
    return `/l/${slug}/bowlers?${p.toString()}`;
  };
  return (
    <div>
      <PageHeader title="Bowlers" eyebrow={ctx.season.name} sub="Season averages and handicaps, calculated from finalized scores." actions={ctx.can("roster.manage") ? <Link href={`/l/${slug}/admin/roster`} className="btn btn-sm">Manage roster</Link> : undefined} />
      <form className="mb-3 flex flex-wrap items-end gap-2" role="search">
        {sq ? <input type="hidden" name="season" value={sq} /> : null}
        <div className="field"><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name" className="input !w-48" /></div>
        <div className="field"><label htmlFor="sort">Sort by</label><select id="sort" name="sort" defaultValue={sort} className="select !w-36"><option value="avg">Average</option><option value="name">Name</option><option value="hg">High game</option><option value="games">Games</option></select></div>
        <label className="check pb-2"><input type="checkbox" name="all" value="1" defaultChecked={sp.all === "1"} />Include inactive</label>
        <button className="btn btn-sm mb-0.5" type="submit">Apply</button>
      </form>
      <Card>
        {rows.length === 0 ? <EmptyState title={q ? "No bowlers match that search" : "No bowlers on this season's roster"} action={!q && ctx.can("roster.manage") ? <Link href={`/l/${slug}/admin/roster`} className="btn btn-primary">Add bowlers</Link> : undefined} /> : (
          <div className="tbl-wrap">
            <table className="tbl tbl-sticky">
              <caption className="sr-only">Bowlers</caption>
              <thead><tr><th scope="col" className="!pl-3"><Link href={link({ sort: "name" })}>Bowler</Link></th><th scope="col" className="!text-left">Team</th><th scope="col"><Link href={link({ sort: "avg" })}>Avg</Link></th><th scope="col" title="Entering average">Ent</th>{showHdcp ? <th scope="col" title="Handicap for the next week">Hdcp</th> : null}<th scope="col"><Link href={link({ sort: "games" })}>Gms</Link></th><th scope="col">Pins</th><th scope="col"><Link href={link({ sort: "hg" })}>High G</Link></th><th scope="col">High S</th>{ctx.cfg.format !== "team" ? <th scope="col">W-L</th> : null}</tr></thead>
              <tbody>
                {rows.map((s) => {
                  const b = m.bowlerById.get(s.bowlerId)!;
                  return (
                    <tr key={s.bowlerId}>
                      <td className="!pl-3"><Link href={`/l/${slug}/bowlers/${s.bowlerId}${sq ? `?season=${sq}` : ""}`} className="flex min-w-[170px] items-center gap-2 hover:underline"><Avatar name={b.name} color={b.avatarColor} url={b.avatarUrl} size={26} /><span className="truncate font-semibold">{b.name}</span>{s.isSub ? <span className="badge">SUB</span> : null}{!b.active ? <span className="badge badge-warn">INACTIVE</span> : null}</Link></td>
                      <td className="l muted">{teamName(s.teamId) ?? "—"}</td>
                      <td className="score">{fmt1(s.average)}</td>
                      <td className="num muted">{s.enteringAverage ?? "—"}</td>
                      {showHdcp ? <td className="num">{s.currentHandicap ?? "—"}</td> : null}
                      <td className="num">{s.games}</td><td className="num">{s.pins ? s.pins.toLocaleString() : "—"}</td>
                      <td className="num">{s.highGame?.scratch ?? "—"}</td><td className="num">{s.highSeries?.scratch ?? "—"}</td>
                      {ctx.cfg.format !== "team" ? <td className="num">{s.record ? `${s.record.wins}-${s.record.losses}${s.record.ties ? `-${s.record.ties}` : ""}` : "—"}</td> : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
