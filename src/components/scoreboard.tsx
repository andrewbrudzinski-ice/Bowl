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
        <span className="block truncate text-[15px] font-semibold tracking-tight">{p.name}</span>
        {record ? (
          <span className="muted block truncate text-[12.5px] num">
            {recordText(record)}
            {rank ? ` · ${ordinal(rank)}` : ""}
          </span>
        ) : null}
      </span>
    </>
  );
  return link ? (
    <Link href={p.href} className="flex min-w-0 items-center gap-3 hover:underline">
      {inner}
    </Link>
  ) : (
    <span className="flex min-w-0 items-center gap-3">{inner}</span>
  );
}

function sideTotals(r: MatchupResult, side: SideLine) {
  return r.basis === "handicap" ? side.adjustedSeries : side.scratchSeries;
}

/**
 * Sports-style scoreboard: each side shows its series total, the games behind it and the points earned. Winners are marked with a
 * "Won" label, stronger weight and a check on the games they took — never color alone. Unofficial scores are shown but visibly
 * labelled provisional.
 */
export function Scoreboard({ r, a, b, recA, recB, href, compact = false, dateLabel }: { r: MatchupResult; a: Participant; b?: Participant; recA?: RecordLine; recB?: RecordLine; href?: string; compact?: boolean; dateLabel?: string }) {
  const status = resultStatus(r);
  const bb = r.b;
  const showHdcp = r.basis === "handicap";
  const winA = status.final && r.winner === "A";
  const winB = status.final && r.winner === "B";
  const tie = status.final && r.winner === "tie";
  const outcome = (side: "A" | "B") => {
    if (!status.final || r.isBye || r.forfeitBy) return null;
    if (tie) return <Badge title="Tied">Tied</Badge>;
    return r.winner === side ? <Badge tone="win" title="Winner">Won</Badge> : <Badge tone="loss" title="Loss">Lost</Badge>;
  };
  const rows: { side: "A" | "B"; p: Participant; line: SideLine; rec?: RecordLine; win: boolean }[] = [{ side: "A", p: a, line: r.a, rec: recA, win: winA }];
  if (bb && b) rows.push({ side: "B", p: b, line: bb, rec: recB, win: winB });
  const gameWinner = (g: number) => (r.games[g]?.status === "scored" || r.games[g]?.status === "forfeit" ? r.games[g].winner : null);
  return (
    <article className="card overflow-hidden" aria-label={`${a.name}${b ? ` versus ${b.name}` : " bye"}`}>
      <header className="flex items-center justify-between gap-3 px-5 pt-4">
        <span className="eyebrow">{dateLabel ?? `Week ${r.weekNumber}`}{r.matchup.playoffRound ? ` · Playoff round ${r.matchup.playoffRound}` : ""}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </header>
      {r.isBye ? (
        <div className="flex items-center justify-between gap-3 px-5 py-5">
          <ParticipantName p={a} record={recA} />
          <span className="muted text-[13px]">Bye week{r.a.points ? ` · ${fmtPts(r.a.points)} pts` : ""}</span>
        </div>
      ) : (
        <ul className="px-5">
          {rows.map(({ side, p, line, rec, win }) => {
            const seriesWon = r.seriesWinner === side && status.final;
            return (
              <li key={side} className="scoreboard-row border-b border-line py-5 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <ParticipantName p={p} record={rec} size={compact ? 32 : 36} />
                  <div className="shrink-0 text-right">
                    <div className={`score text-[28px] leading-none ${seriesWon || !status.final ? "text-fg" : "text-muted"}`} aria-label={`Series ${sideTotals(r, line) || "no score"}`}>{sideTotals(r, line) || "–"}</div>
                    {showHdcp ? <div className="faint num mt-1.5 text-[11px]">{line.scratchSeries}+{line.handicapSeries}</div> : null}
                    <div className="mt-2 flex items-center justify-end gap-2">
                      {outcome(side)}
                      <span className={`num text-[13.5px] font-bold ${win ? "text-fg" : "text-muted"}`}>{status.final || line.points ? `${fmtPts(line.points)} pt${line.points === 1 ? "" : "s"}` : "–"}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: `repeat(${Math.min(r.games.length, 5)}, minmax(0, 1fr))` }}>
                  {r.games.map((g, i) => {
                    const sg = line.games[i];
                    const won = gameWinner(i) === side;
                    const val = sg.basis;
                    return (
                      <div key={g.game} className="rounded-xl bg-raised px-2 py-2.5 text-center" aria-label={`Game ${g.game}: ${val == null ? "no score" : val}${won ? ", won game" : ""}`}>
                        <div className="faint text-[10.5px] font-semibold leading-none">G{g.game}</div>
                        <div className={`score mt-1.5 text-[17px] leading-none ${won ? "text-fg" : "text-muted !font-semibold"}`}>
                          {val ?? "–"}
                          {won ? <Check size={11} aria-hidden className="ml-0.5 inline align-super text-[var(--accent-text)]" /> : null}
                        </div>
                        {showHdcp && sg.scratch != null ? <div className="faint num mt-1 text-[10px] leading-none">{sg.scratch}+{(sg.adjusted ?? 0) - sg.scratch}</div> : null}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-[color-mix(in_srgb,var(--color-raised)_55%,transparent)] px-5 py-3.5 text-[13px]">
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
