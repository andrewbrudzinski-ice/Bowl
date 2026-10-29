import Link from "next/link";
import { Fragment } from "react";
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
  const phoneHide = compact ? "hidden sm:table-cell" : undefined;
  const cols = 3 + (compact ? 1 : 7) + (race ? 1 : 0);
  return (
    <div className="tbl-wrap">
      <table className={`tbl tbl-sticky`}>
        <caption className="sr-only">League standings</caption>
        <thead>
          <tr>
            <th scope="col">{kind === "team" ? "Team" : "Bowler"}</th>
            <th scope="col" title="Wins–losses">{showTies ? "W-L-T" : "W-L"}</th>
            <th scope="col" title="League points">Pts</th>
            {!compact ? <th scope="col" title="Win percentage">Win%</th> : null}
            {!compact ? <th scope="col" title="Average game score on the standings basis">Avg</th> : null}
            {!compact ? <th scope="col" title="Total pins on the standings basis">Pins</th> : null}
            <th scope="col" title="Last five results" className={phoneHide}>Form</th>
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
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <Link href={p.href} className="flex min-w-[140px] items-center gap-3 hover:underline" title={r.reason ?? undefined}>
                      <span className={`rank num ${qualifiers != null && i < qualifiers ? "!text-[var(--accent-text)]" : ""}`} aria-label={`Rank ${r.rank}`}>{r.rank}</span>
                      <TeamMark name={p.name} color={p.color} logo={p.logo} size={30} />
                      <span className="truncate font-semibold tracking-tight">{p.name}</span>
                    </Link>
                  </td>
                  <td className="num text-muted">{r.wins}-{r.losses}{showTies ? `-${r.ties}` : ""}</td>
                  <td className="score text-[16px]">{fmtPts(r.points)}</td>
                  {!compact ? <td className="num">{r.played ? (r.winPct * 100).toFixed(0) + "%" : "—"}</td> : null}
                  {!compact ? <td className="num">{fmt1(r.average)}</td> : null}
                  {!compact ? <td className="num">{r.totalPins ? r.totalPins.toLocaleString() : "—"}</td> : null}
                  <td className={phoneHide}><FormChips form={r.form} /></td>
                  {!compact ? <td className="num">{r.streak.type ? `${r.streak.type}${r.streak.count}` : "—"}</td> : null}
                  {!compact ? <td className="num">{r.remaining}</td> : null}
                  {!compact ? <td className="num">{r.pointsBehind ? fmtPts(r.pointsBehind) : "—"}</td> : null}
                  {race ? <td title={pr?.detail}>{pr ? statusBadge(pr.status) : null}</td> : null}
                </tr>
                {cut ? (
                  <tr aria-label={`Playoff line: the top ${qualifiers} qualify`}>
                    <td colSpan={cols} className="!bg-[color-mix(in_srgb,var(--accent)_9%,transparent)] !py-2 !text-left text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--accent-text)]">Playoff line · top {qualifiers} qualify</td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
