import Link from "next/link";
import { Trophy } from "lucide-react";
import { championOf } from "@/domain/awards";
import { fmtPts } from "@/domain/math";
import { computeStandings } from "@/domain/standings";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { allModels } from "@/server/views";

export const metadata = { title: "Past seasons" };

export default async function History({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug);
  const models = allModels(ctx).reverse();
  return (
    <div>
      <PageHeader title="Past seasons" sub="Every season keeps its own rosters, rules, results and records." />
      {models.length === 0 ? <Card><EmptyState title="No seasons yet" /></Card> : (
        <ul className="grid gap-3">
          {models.map((m) => {
            const s = m.data.season;
            const champ = championOf(m);
            const { rows } = computeStandings(m, { scope: m.configForWeek(1).format === "individual" ? "bowler" : "team" });
            return (
              <li key={s.id} className="card card-link p-4">
                <Link href={`/l/${slug}/history/${s.slug}`} className="grid gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-[16px] font-bold">{s.name}</h2><div className="flex gap-2">{s.status === "completed" ? <Badge tone="win">COMPLETED</Badge> : <Badge tone="accent">IN PROGRESS</Badge>}{s.isDemo ? <Badge tone="warn">DEMO</Badge> : null}</div></div>
                  {champ ? <div className="flex items-center gap-2 text-[14px]"><Trophy size={15} className="text-warn" aria-hidden /><b>{champ.name}</b><span className="muted text-xs">{champ.how}</span></div> : <div className="muted text-[13px]">{s.status === "completed" ? "No champion recorded." : "Champion to be decided."}</div>}
                  {rows.length ? <div className="muted num text-xs">{rows.slice(0, 3).map((r) => `${r.rank}. ${r.name} (${r.wins}-${r.losses}, ${fmtPts(r.points)} pts)`).join("  ·  ")}</div> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
