import Link from "next/link";
import { calculateHandicap } from "@/domain/handicap";
import { fmt1, fmtPts } from "@/domain/math";
import type { MatchupResult, SideLine } from "@/domain/scoring";
import type { LeagueCtx } from "@/server/context";
import { Avatar } from "./ui";

/** Per-bowler scorecard for one side: average, handicap with its calculation, scratch games, series. */
export function BowlerCard({ ctx, r, side, name }: { ctx: LeagueCtx; r: MatchupResult; side: SideLine; name: string }) {
  const m = ctx.model!;
  const cfg = m.configForWeek(r.weekNumber);
  const ver = r.matchup.ruleVersion != null ? ctx.season!.ruleVersions.find((v) => v.version === r.matchup.ruleVersion) : null;
  const hc = (ver?.config ?? cfg).handicap;
  const showH = r.basis === "handicap" || hc.enabled;
  return (
    <div className="card overflow-hidden">
      <div className="card-head"><h3 className="text-[13px] font-bold">{name}</h3><span className="muted text-xs">{showH ? "Scratch · handicap · adjusted" : "Scratch"}</span></div>
      <div className="tbl-wrap">
        <table className="tbl tbl-sticky">
          <caption className="sr-only">{name} bowler scores</caption>
          <thead><tr><th scope="col" className="!pl-3">Bowler</th><th scope="col" title="Average used for the handicap">Avg</th>{showH ? <th scope="col" title="Handicap per game">Hdcp</th> : null}{r.games.map((g) => <th key={g.game} scope="col">G{g.game}</th>)}<th scope="col">Series</th>{showH ? <th scope="col" title="Scratch series plus handicap for each game">Adj</th> : null}</tr></thead>
          <tbody>
            {side.lineup.map((l) => {
              const b = m.bowlerById.get(l.bowlerId);
              const frozen = r.official && !!r.matchup.handicapSnapshot;
              const base = hc.baseMode === "fixed" ? hc.baseValue : null;
              const bd = base != null && l.average != null ? calculateHandicap({ average: l.average, base }, hc) : null;
              return (
                <tr key={l.bowlerId}>
                  <td className="!pl-3"><Link href={`/l/${ctx.league.slug}/bowlers/${l.bowlerId}`} className="flex min-w-[140px] items-center gap-2 hover:underline"><Avatar name={b?.name ?? "?"} color={b?.avatarColor ?? "#64748b"} url={b?.avatarUrl} size={22} /><span className="truncate font-semibold">{b?.name ?? "Unknown"}</span>{l.isSub ? <span className="badge">SUB</span> : null}{l.absent ? <span className="badge badge-warn">ABSENT</span> : null}</Link></td>
                  <td className="num">{l.average != null ? Math.round(l.average * 10) / 10 : "—"}</td>
                  {showH ? (
                    <td className="num">
                      <details className="inline-block text-right">
                        <summary className="cursor-pointer underline decoration-dotted underline-offset-2" aria-label={`Handicap ${l.handicap}, show calculation`}>{l.handicap}</summary>
                        <div className="card absolute right-2 z-10 mt-1 w-64 p-2.5 text-left text-xs shadow-xl">
                          <div className="font-semibold">How {l.handicap} was calculated</div>
                          {bd ? <ul className="muted mt-1 list-disc pl-4">{bd.steps.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="muted mt-1">{l.note}</p>}
                          <p className="faint mt-1">{frozen ? `Locked at finalization (rules v${r.matchup.ruleVersion}).` : "Based on averages entering this week; locks when the result is finalized."}</p>
                        </div>
                      </details>
                    </td>
                  ) : null}
                  {l.games.map((g) => <td key={g.game} className="score">{g.scratch ?? "–"}{g.blind ? <sup title="Blind score" className="faint"> b</sup> : null}</td>)}
                  <td className="score">{l.gamesScored ? l.scratchSeries : "–"}</td>
                  {showH ? <td className="score">{l.gamesScored ? l.adjustedSeries : "–"}</td> : null}
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="!pl-3 font-semibold">Team</td><td /><>{showH ? <td className="num">{side.lineup.reduce((t, l) => t + l.handicap, 0)}</td> : null}</>
              {side.games.map((g) => <td key={g.game} className="score">{g.scratch ?? "–"}</td>)}
              <td className="score">{side.scratchSeries || "–"}</td>{showH ? <td className="score">{side.adjustedSeries || "–"}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** "How the result was decided": every game, the series and bonus points with the pins behind them. */
export function Breakdown({ r, nameA, nameB }: { r: MatchupResult; nameA: string; nameB: string }) {
  if (!r.b) return null;
  const unit = r.basis === "handicap" ? "adjusted pins" : "scratch pins";
  const who = (w: "A" | "B" | "tie" | null) => (w === "A" ? nameA : w === "B" ? nameB : w === "tie" ? "Tie" : "—");
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <caption className="sr-only">How the matchup was decided</caption>
        <thead><tr><th scope="col" className="!pl-3">Contest</th><th scope="col">{nameA}</th><th scope="col">{nameB}</th><th scope="col" className="!text-left">Winner</th></tr></thead>
        <tbody>
          {r.games.map((g, i) => {
            const a = r.a.games[i]; const b = r.b!.games[i];
            return (
              <tr key={g.game}>
                <td className="!pl-3">Game {g.game}</td>
                <td className="num">{a.basis ?? "–"}</td><td className="num">{b.basis ?? "–"}</td>
                <td className="l">{g.status === "incomplete" ? <span className="muted">Incomplete</span> : g.status === "forfeit" ? `${who(g.winner)} (forfeit)` : <>{who(g.winner)}{g.margin != null ? <span className="muted"> by {g.margin}</span> : null}</>}</td>
              </tr>
            );
          })}
          <tr>
            <td className="!pl-3 font-semibold">Series ({unit})</td>
            <td className="score">{r.a.basisSeries || "–"}</td><td className="score">{r.b.basisSeries || "–"}</td>
            <td className="l">{who(r.seriesWinner)}{r.margin != null && r.seriesWinner && r.seriesWinner !== "tie" ? <span className="muted"> by {r.margin}</span> : null}</td>
          </tr>
          <tr>
            <td className="!pl-3 font-semibold">Points</td>
            <td className="score">{fmtPts(r.a.points)}</td><td className="score">{fmtPts(r.b.points)}</td>
            <td className="l muted">{fmtPts(r.a.gamePoints)} + {fmtPts(r.a.seriesPoints)}{r.a.bonusPoints ? ` + ${fmtPts(r.a.bonusPoints)}` : ""} vs {fmtPts(r.b.gamePoints)} + {fmtPts(r.b.seriesPoints)}{r.b.bonusPoints ? ` + ${fmtPts(r.b.bonusPoints)}` : ""} <span className="faint">(games + series{r.a.bonusPoints || r.b.bonusPoints ? " + bonus" : ""})</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function avgLine(avg: number | null) {
  return avg == null ? "—" : fmt1(avg);
}
