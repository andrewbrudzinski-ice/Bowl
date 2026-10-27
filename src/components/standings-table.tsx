import Link from "next/link";
import { fmt1, fmtPts } from "@/domain/math";
import type { PlayoffRow, StandingRow } from "@/domain/standings";
import type { LeagueCtx } from "@/server/context";
import { participant } from "@/server/views";
import { Badge, FormChips, TeamMark } from "./ui";

const statusBadge = (s: PlayoffRow["status"]) =>
  s === "clinched" ? <Badge tone="win" title="Mathematically guaranteed a playoff spot">CLINCHED</Badge>
  : s === "eliminated" ? <Badge tone="loss" title="Can no longer reach the playoffs">OUT</Badge>
  : s === "in" ? <Badge tone="accent" title="Currently in a playoff position">IN</Badge>
  : s === "out" ? <Badge title="Currently outside the playoff line">BUBBLE</Badge>
  : null;

export function StandingsTable({
  ctx, rows, race, compact = false, limit, qualifiers, seasonQ,
}: {
  ctx: LeagueCtx;
  rows: StandingRow[];
  race?: PlayoffRow[] | null;
  compact?: boolean;
  limit?: number;
  qualifiers?: number;
  seasonQ?: string | null;
}) {
  const kind = ctx.cfg.format === "individual" ? "individual" : "team";
  const shown = limit ? rows.slice(0, limit) : rows;
  const raceBy = new Map((race ?? []).map((r) => [r.id, r]));
  const showTies = rows.some((r) => r.ties > 0);
  return (
    <div className="tbl-wrap">
      <table className={`tbl tbl-sticky`}>
        <caption className="sr-only">League standings</caption>
        <thead>
          <tr>
            <th scope="col" className="!pl-3">{kind === "team" ? "Team" : "Bowler"}</th>
            <th scope="col" title="Wins–losses">{showTies ? "W-L-T" : "W-L"}</th>
            <th scope="col" title="League points">Pts</th>
            {!compact ? <th scope="col" title="Win percentage">Win%</th> : null}
            {!compact ? <th scope="col" title="Average game score on the standings basis">Avg</th> : null}
            {!compact ? <th scope="col" title="Total pins on the standings basis">Pins</th> : null}
            <th scope="col" title="Last five results">Form</th>
            {!compact ? <th scope="col" title="Current streak">Strk</th> : null}
            {!compact ? <th scope="col" title="Matchups remaining in the regular season">Left</th> : null}
            {!compact ? <th scope="col" title="Points behind first place">GB</th> : null}
            {race ? <th scope="col">Playoffs</th> : null}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, i) => {
            const p = participant(ctx, r.id, kind, seasonQ);
            const pr = raceBy.get(r.id);
            const cut = qualifiers != null && i === qualifiers - 1 && i < shown.length - 1;
            return (
              <tr key={r.id} style={cut ? { boxShadow: "inset 0 -2px 0 var(--accent)" } : undefined}>
                <td className="!pl-3">
                  <Link href={p.href} className="flex min-w-[150px] items-center gap-2 hover:underline" title={r.reason ?? undefined}>
                    <span className="rank num" aria-label={`Rank ${r.rank}`}>{r.rank}</span>
                    <TeamMark name={p.name} color={p.color} logo={p.logo} size={22} />
                    <span className="truncate font-semibold">{p.name}</span>
                  </Link>
                </td>
                <td className="num">{r.wins}-{r.losses}{showTies ? `-${r.ties}` : ""}</td>
                <td className="score">{fmtPts(r.points)}</td>
                {!compact ? <td className="num">{r.played ? (r.winPct * 100).toFixed(0) + "%" : "—"}</td> : null}
                {!compact ? <td className="num">{fmt1(r.average)}</td> : null}
                {!compact ? <td className="num">{r.totalPins ? r.totalPins.toLocaleString() : "—"}</td> : null}
                <td><FormChips form={r.form} /></td>
                {!compact ? <td className="num">{r.streak.type ? `${r.streak.type}${r.streak.count}` : "—"}</td> : null}
                {!compact ? <td className="num">{r.remaining}</td> : null}
                {!compact ? <td className="num">{r.pointsBehind ? fmtPts(r.pointsBehind) : "—"}</td> : null}
                {race ? <td title={pr?.detail}>{pr ? statusBadge(pr.status) : null}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
