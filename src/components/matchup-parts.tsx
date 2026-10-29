import Link from "next/link";
import { Check } from "lucide-react";
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
      <div className="card-head"><h3 className="text-[13px] font-bold">{name}</h3><span className="muted text-[13px]">{showH ? "Scratch · handicap · adjusted" : "Scratch"}</span></div>
      <div className="tbl-wrap">
        <table className="tbl tbl-sticky">
          <caption className="sr-only">{name} bowler scores</caption>
          <thead><tr><th scope="col">Bowler</th><th scope="col" title="Average used for the handicap">Avg</th>{showH ? <th scope="col" title="Handicap per game">Hdcp</th> : null}{r.games.map((g) => <th key={g.game} scope="col">G{g.game}</th>)}<th scope="col">Series</th>{showH ? <th scope="col" title="Scratch series plus handicap for each game">Adj</th> : null}</tr></thead>
          <tbody>
            {side.lineup.map((l) => {
              const b = m.bowlerById.get(l.bowlerId);
              const frozen = r.official && !!r.matchup.handicapSnapshot;
              const base = hc.baseMode === "fixed" ? hc.baseValue : null;
              const bd = base != null && l.average != null ? calculateHandicap({ average: l.average, base }, hc) : null;
              return (
                <tr key={l.bowlerId}>
                  <td><Link href={`/l/${ctx.league.slug}/bowlers/${l.bowlerId}`} className="flex min-w-[140px] items-center gap-2 hover:underline"><Avatar name={b?.name ?? "?"} color={b?.avatarColor ?? "#64748b"} url={b?.avatarUrl} size={22} /><span className="truncate font-semibold">{b?.name ?? "Unknown"}</span>{l.isSub ? <span className="badge">SUB</span> : null}{l.absent ? <span className="badge badge-warn">ABSENT</span> : null}</Link></td>
                  <td className="num">{l.average != null ? Math.round(l.average * 10) / 10 : "—"}</td>
                  {showH ? (
                    <td className="num">
                      <details className="inline-block text-right">
                        <summary className="cursor-pointer underline decoration-dotted underline-offset-2" aria-label={`Handicap ${l.handicap}, show calculation`}>{l.handicap}</summary>
                        <div className="card absolute right-2 z-10 mt-1 w-64 p-2.5 text-left text-[13px] shadow-xl">
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
              <td className="font-semibold">Team</td><td /><>{showH ? <td className="num">{side.lineup.reduce((t, l) => t + l.handicap, 0)}</td> : null}</>
              {side.games.map((g) => <td key={g.game} className="score">{g.scratch ?? "–"}</td>)}
              <td className="score">{side.scratchSeries || "–"}</td>{showH ? <td className="score">{side.adjustedSeries || "–"}</td> : null}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** "How the result was decided": every game, the series and bonus points with the pins behind them. The winning side of each contest is bold with a check, and the margin sits under the label. */
export function Breakdown({ r, nameA, nameB }: { r: MatchupResult; nameA: string; nameB: string }) {
  if (!r.b) return null;
  const unit = r.basis === "handicap" ? "adjusted pins" : "scratch pins";
  const who = (w: "A" | "B" | "tie" | null) => (w === "A" ? nameA : w === "B" ? nameB : w === "tie" ? "Tie" : null);
  const val = (v: number | string, win: boolean) => (
    <td className={win ? "score !text-fg" : "num text-muted"}>
      {v}
      {win ? <Check size={11} aria-hidden className="ml-0.5 inline align-super text-[var(--accent-text)]" /> : null}
    </td>
  );
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <caption className="sr-only">How the matchup was decided</caption>
        <thead><tr><th scope="col">Contest</th><th scope="col">{nameA}</th><th scope="col">{nameB}</th></tr></thead>
        <tbody>
          {r.games.map((g, i) => {
            const a = r.a.games[i]; const b = r.b!.games[i];
            const decided = g.status !== "incomplete" && (g.winner === "A" || g.winner === "B");
            return (
              <tr key={g.game}>
                <td>
                  <div className="font-semibold">Game {g.game}</div>
                  <div className="faint text-[12px]">{g.status === "incomplete" ? "Incomplete" : g.status === "forfeit" ? `${who(g.winner) ?? "—"} (forfeit)` : g.winner === "tie" ? "Tie" : g.margin != null ? `${who(g.winner)} by ${g.margin}` : ""}</div>
                </td>
                {val(a.basis ?? "–", decided && g.winner === "A")}
                {val(b.basis ?? "–", decided && g.winner === "B")}
              </tr>
            );
          })}
          <tr>
            <td>
              <div className="font-semibold">Series</div>
              <div className="faint text-[12px]">{unit}{r.seriesWinner && r.seriesWinner !== "tie" && r.margin != null ? ` · ${who(r.seriesWinner)} by ${r.margin}` : r.seriesWinner === "tie" ? " · tie" : ""}</div>
            </td>
            {val(r.a.basisSeries || "–", r.seriesWinner === "A")}
            {val(r.b.basisSeries || "–", r.seriesWinner === "B")}
          </tr>
          <tr>
            <td>
              <div className="font-semibold">Points</div>
              <div className="faint text-[12px]">games + series{r.a.bonusPoints || r.b.bonusPoints ? " + bonus" : ""}</div>
            </td>
            <td className="score">
              {fmtPts(r.a.points)}
              <div className="faint num text-[12px] font-medium">{fmtPts(r.a.gamePoints)} + {fmtPts(r.a.seriesPoints)}{r.a.bonusPoints ? ` + ${fmtPts(r.a.bonusPoints)}` : ""}</div>
            </td>
            <td className="score">
              {fmtPts(r.b.points)}
              <div className="faint num text-[12px] font-medium">{fmtPts(r.b.gamePoints)} + {fmtPts(r.b.seriesPoints)}{r.b.bonusPoints ? ` + ${fmtPts(r.b.bonusPoints)}` : ""}</div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function avgLine(avg: number | null) {
  return avg == null ? "—" : fmt1(avg);
}
