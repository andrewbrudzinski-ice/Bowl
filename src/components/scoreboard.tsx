import Link from "next/link";
import { Check } from "lucide-react";
import type { MatchupResult, SideLine } from "@/domain/scoring";
import { resultStatus, type Participant, type RecordLine, recordText } from "@/server/views";
import { Badge, TeamMark } from "./ui";
import { fmtPts } from "@/domain/math";
import { ordinal } from "@/domain/narrative";

export function ParticipantName({ p, record, rank, size = 28, link = true }: { p: Participant; record?: RecordLine; rank?: number; size?: number; link?: boolean }) {
  const inner = (
    <>
      <TeamMark name={p.name} color={p.color} logo={p.logo} size={size} />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[14px] font-semibold">{p.name}</span>
        {record ? (
          <span className="muted block truncate text-[11px] num">
            {recordText(record)}
            {rank ? ` · ${ordinal(rank)}` : ""}
          </span>
        ) : null}
      </span>
    </>
  );
  return link ? (
    <Link href={p.href} className="flex min-w-0 items-center gap-2 hover:underline">
      {inner}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-2">{inner}</span>
  );
}

function sideTotals(r: MatchupResult, side: SideLine) {
  return r.basis === "handicap" ? side.adjustedSeries : side.scratchSeries;
}

/**
 * Sports-style scoreboard. Winners are marked with a label ("W"), bold weight, underline and a check — never color alone.
 * Unofficial scores are shown but visibly labelled provisional.
 */
export function Scoreboard({ r, a, b, recA, recB, href, compact = false, dateLabel }: { r: MatchupResult; a: Participant; b?: Participant; recA?: RecordLine; recB?: RecordLine; href?: string; compact?: boolean; dateLabel?: string }) {
  const status = resultStatus(r);
  const bb = r.b;
  const showHdcp = r.basis === "handicap";
  const winA = status.final && r.winner === "A";
  const winB = status.final && r.winner === "B";
  const tie = status.final && r.winner === "tie";
  const label = (side: "A" | "B") => {
    if (!status.final || r.isBye || r.forfeitBy) return null;
    if (tie) return <Badge title="Tied">T</Badge>;
    const w = r.winner === side;
    return w ? <Badge tone="win" title="Winner">W</Badge> : <Badge tone="loss" title="Loss">L</Badge>;
  };
  const rows: { side: "A" | "B"; p: Participant; line: SideLine; rec?: RecordLine; win: boolean }[] = [{ side: "A", p: a, line: r.a, rec: recA, win: winA }];
  if (bb && b) rows.push({ side: "B", p: b, line: bb, rec: recB, win: winB });
  const gameWinner = (g: number) => (r.games[g]?.status === "scored" || r.games[g]?.status === "forfeit" ? r.games[g].winner : null);
  const dimmed = !status.final;
  return (
    <article className="card overflow-hidden" aria-label={`${a.name}${b ? ` versus ${b.name}` : " bye"}`}>
      <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <span className="eyebrow">{dateLabel ?? `Week ${r.weekNumber}`}{r.matchup.playoffRound ? ` · Playoff round ${r.matchup.playoffRound}` : ""}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>
      {r.isBye ? (
        <div className="flex items-center justify-between px-3 py-3">
          <ParticipantName p={a} record={recA} />
          <span className="muted text-xs">Bye week{r.a.points ? ` · ${fmtPts(r.a.points)} pts` : ""}</span>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl" style={{ tableLayout: "auto" }}>
            <caption className="sr-only">Game-by-game scores</caption>
            <thead>
              <tr>
                <th scope="col">Participant</th>
                {r.games.map((g) => (
                  <th key={g.game} scope="col">G{g.game}</th>
                ))}
                <th scope="col">Series</th>
                <th scope="col">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ side, p, line, rec, win }) => (
                <tr key={side} className="scoreboard-row" style={dimmed ? { opacity: 0.88 } : undefined}>
                  <td className="relative" style={{ minWidth: compact ? 130 : 170 }}>
                    {win ? <span className="win-bar" aria-hidden /> : null}
                    <div className="flex items-center gap-2 pl-1">
                      <ParticipantName p={p} record={rec} size={compact ? 24 : 28} />
                      <span className="ml-auto">{label(side)}</span>
                    </div>
                  </td>
                  {r.games.map((g, i) => {
                    const sg = line.games[i];
                    const won = gameWinner(i) === side;
                    const val = sg.basis;
                    return (
                      <td key={g.game}>
                        <div className={`score text-[18px] leading-none ${won ? "underline decoration-2 underline-offset-4" : "text-[color:var(--color-muted)] !font-semibold"}`} aria-label={val == null ? "no score" : `${val}${won ? ", won game" : ""}`}>
                          {val ?? "–"}
                          {won ? <Check size={11} aria-hidden className="ml-0.5 inline align-super text-[var(--accent-text)]" /> : null}
                        </div>
                        {showHdcp && sg.scratch != null ? <div className="faint num text-[10px]">{sg.scratch}+{(sg.adjusted ?? 0) - sg.scratch}</div> : null}
                      </td>
                    );
                  })}
                  <td>
                    <div className={`score text-[18px] leading-none ${r.seriesWinner === side && status.final ? "underline decoration-2 underline-offset-4" : "text-[color:var(--color-muted)] !font-semibold"}`}>{sideTotals(r, line) || "–"}</div>
                    {showHdcp ? <div className="faint num text-[10px]">{line.scratchSeries}+{line.handicapSeries}</div> : null}
                  </td>
                  <td>
                    <div className={`score text-[18px] leading-none ${win ? "text-fg" : "text-muted"}`}>{status.final || line.points ? fmtPts(line.points) : "–"}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-xs">
        <span className="muted">
          {r.isBye
            ? ""
            : !status.final
              ? r.complete
                ? "Provisional — not counted in official standings."
                : `Missing ${r.missing.length} score${r.missing.length === 1 ? "" : "s"}; no result yet.`
              : r.forfeitBy
                ? "Forfeit: maximum points awarded to the opponent."
                : tie
                  ? "Matchup tied."
                  : r.margin != null
                    ? `${r.winner === "A" ? a.name : b?.name} by ${r.margin} ${r.basis === "handicap" ? "adjusted " : ""}pin${r.margin === 1 ? "" : "s"}`
                    : ""}
        </span>
        {href ? (
          <Link href={href} className="font-semibold text-[var(--accent-text)] hover:underline">
            {status.final ? "Full recap →" : "Matchup details →"}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
