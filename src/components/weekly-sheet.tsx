import type { ReactNode } from "react";
import { fmt1, fmtPts } from "@/domain/math";
import type { MatchupResult, SideLine } from "@/domain/scoring";
import type { SheetBowlerRow, SheetMatch, SheetSide, WeeklySheet } from "@/domain/sheet";
import type { LeagueCtx } from "@/server/context";
import { formatDate, resultStatus } from "@/server/views";
import { Badge } from "./ui";
import { StandingsTable } from "./standings-table";

const MINUS = "−";
const dash = <span className="faint" aria-label="none">—</span>;

/** A signed change: "+4.0", "−2.5", or a quiet zero. The sign is always written out, so it never depends on colour. */
function Change({ n, decimals = 0, tone = false }: { n: number | null; decimals?: number; tone?: boolean }) {
  if (n == null) return dash;
  if (n === 0) return <span className="faint">0</span>;
  const text = `${n > 0 ? "+" : MINUS}${Math.abs(n).toFixed(decimals)}`;
  return <span className={tone ? (n > 0 ? "text-win" : "text-loss") : undefined}>{text}</span>;
}

function Section({ id, title, aside, children, className = "" }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`sheet-section ${className}`}>
      <div className="sheet-section-head">
        <h2 id={id}>{title}</h2>
        {aside ? <div className="sheet-aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

// ---- last week ----

/** The result of one finished matchup: each side's bowlers game by game, then the side's totals and points. */
function ResultTable({ r, ctx, names }: { r: MatchupResult; ctx: LeagueCtx; names: Map<string, string> }) {
  const hdcp = r.basis === "handicap";
  const games = r.gamesPerSession;
  const showPts = !r.settingWeek;
  const status = resultStatus(r);
  const sideName = (s: SideLine) => (r.matchup.kind === "team" ? ctx.model!.teamById.get(s.participantId)?.name : names.get(s.participantId)) ?? "Unknown";
  const anyBlind = [r.a, r.b!].some((s) => s.lineup.some((l) => l.games.some((g) => g.blind)));
  const cols = 2 + (hdcp ? 1 : 0) + games + 1 + (showPts ? 1 : 0);
  // In an extra comparison only side A bowled for points: side B is another pair's scores, taken from their own match.
  const block = (s: SideLine, own: boolean) => {
    const won = r.winner === s.side;
    return (
      <tbody key={s.side}>
        <tr className="sheet-side">
          <th scope="rowgroup" colSpan={cols}>
            {sideName(s)}
            {!own ? <span className="faint font-normal"> · scores from their own match</span> : null}
          </th>
        </tr>
        {s.lineup.map((l) => (
          <tr key={l.bowlerId}>
            <td className="l">{names.get(l.bowlerId) ?? "Unknown"}{l.isSub ? <span className="faint"> (sub)</span> : null}</td>
            <td className="faint">{l.average != null ? Math.round(l.average) : "—"}</td>
            {hdcp ? <td className="faint">{l.handicap}</td> : null}
            {l.games.map((g) => (
              <td key={g.game}>{g.kind === "absent" && !g.blind ? "abs" : (g.scratch ?? "–")}{g.blind ? <sup title="Blind score for an absent bowler"> b</sup> : null}</td>
            ))}
            <td className="font-semibold">{l.scratchSeries || "–"}</td>
            {showPts ? <td /> : null}
          </tr>
        ))}
        <tr className="sheet-total">
          <td className="l">{hdcp ? "Total with handicap" : "Team total"}</td>
          <td />
          {hdcp ? <td /> : null}
          {s.games.map((g) => <td key={g.game}>{g.basis ?? "–"}</td>)}
          <td>{s.basisSeries || "–"}</td>
          {showPts ? <td>{!own ? dash : <>{fmtPts(s.points)}{won ? <span className="sheet-win"> W</span> : r.winner === "tie" ? <span className="faint"> T</span> : null}</>}</td> : null}
        </tr>
      </tbody>
    );
  };
  return (
    <div className="sheet-match">
      <h3 className="sheet-match-head">
        <span>{sideName(r.a)} <span className="faint font-normal">vs</span> {sideName(r.b!)}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          {r.guest ? <Badge tone="info">EXTRA COMPARISON</Badge> : null}
          {r.forfeitBy ? <Badge tone="warn">FORFEIT</Badge> : null}
          {status.label === "FINAL · CORRECTED" ? <Badge>CORRECTED</Badge> : null}
        </span>
      </h3>
      <div className="sheet-scroll" tabIndex={0} role="region" aria-label={`${sideName(r.a)} versus ${sideName(r.b!)} scores`}>
        <table className="sheet-tbl">
          <caption className="sr-only">{sideName(r.a)} versus {sideName(r.b!)}, week {r.weekNumber}</caption>
          <thead>
            <tr>
              <th scope="col">Bowler</th><th scope="col" title="Average going into the night">Avg</th>
              {hdcp ? <th scope="col" title="Handicap for the night">Hdcp</th> : null}
              {Array.from({ length: games }, (_, i) => <th key={i} scope="col">G{i + 1}</th>)}
              <th scope="col" title="Bowler's scratch series">Ser</th>
              {showPts ? <th scope="col" title="League points earned">Pts</th> : null}
            </tr>
          </thead>
          {block(r.a, true)}
          {block(r.b!, !r.guest)}
        </table>
      </div>
      {anyBlind ? <p className="sheet-note"><sup>b</sup> blind score for an absent bowler. It counts for the team but not toward the bowler&apos;s average.</p> : null}
    </div>
  );
}

// ---- this week ----

function Lineup({ side }: { side: SheetSide }) {
  return (
    <div className="min-w-0">
      <div className="sheet-side-name">
        {side.name}
        {side.record ? <span className="faint font-normal"> · {side.rank ? `${side.rank}${ordinal(side.rank)}, ` : ""}{side.record}</span> : null}
      </div>
      <ul className="sheet-lineup">
        {side.lineup.map((b) => (
          <li key={b.bowlerId}>
            <span className="truncate">{b.name}{b.isSub ? <span className="faint"> (sub)</span> : null}</span>
            <span className="num faint">{b.average != null ? Math.round(b.average) : "—"}{b.handicap ? <> · <b className="text-fg">{b.handicap}</b></> : null}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));

function MatchCard({ m }: { m: SheetMatch }) {
  if (m.kind === "bye") {
    return (
      <div className="sheet-match p-3">
        <div className="sheet-side-name">Sitting out</div>
        <p className="text-[13px]">{m.a.lineup.map((b) => b.name).join(", ") || m.a.name}</p>
      </div>
    );
  }
  return (
    <div className="sheet-match p-3">
      {m.kind === "extra" ? <div className="mb-1.5"><Badge tone="info">EXTRA COMPARISON</Badge> <span className="faint text-[12px]">{m.a.name} bowl for points against {m.b!.name}&apos;s scores</span></div> : null}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Lineup side={m.a} />
        <Lineup side={m.b!} />
      </div>
    </div>
  );
}

// ---- averages and handicaps ----

function AveragesTable({ rows, handicapOn, teams }: { rows: SheetBowlerRow[]; handicapOn: boolean; teams: boolean }) {
  return (
    <div className="sheet-scroll" tabIndex={0} role="region" aria-label="Averages and handicaps">
      <table className="sheet-tbl sheet-avg">
        <caption className="sr-only">Every bowler&apos;s average and handicap going into the week</caption>
        <thead>
          <tr>
            <th scope="col">Bowler</th>
            {teams ? <th scope="col" className="!text-left">Team</th> : null}
            <th scope="col" title="Games bowled so far this season">Gms</th>
            <th scope="col" title="Average the handicap is worked from">Avg</th>
            <th scope="col" title="Change in average since last week">+/−</th>
            {handicapOn ? <th scope="col" title="Handicap for this week">Hdcp</th> : null}
            {handicapOn ? <th scope="col" title="Change in handicap since last week">+/−</th> : null}
            <th scope="col" title="High game this season">High G</th>
            <th scope="col" title="High series this season">High S</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.bowlerId}>
              <td className="l font-semibold">{b.name}{b.isSub ? <span className="faint font-normal"> (sub)</span> : null}</td>
              {teams ? <td className="l faint">{b.teamName ?? "—"}</td> : null}
              <td>{b.games || dash}</td>
              <td className="font-semibold">{fmt1(b.average)}</td>
              <td><Change n={b.averageChange} decimals={1} tone /></td>
              {handicapOn ? <td className="font-semibold">{b.handicap}</td> : null}
              {handicapOn ? <td><Change n={b.handicapChange} /></td> : null}
              <td>{b.highGame ?? dash}</td>
              <td>{b.highSeries ?? dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- the sheet ----

export function WeeklySheetView({ ctx, sheet, seasonQ }: { ctx: LeagueCtx; sheet: WeeklySheet; seasonQ: string | null }) {
  const m = ctx.model!;
  const { previous: prev } = sheet;
  const names = new Map<string, string>([...m.bowlerById].map(([id, b]) => [id, b.name]));
  const long = { weekday: "long", month: "long", day: "numeric", year: "numeric" } as const;
  const short = { weekday: "short", month: "short", day: "numeric" } as const;
  const showStandings = sheet.week > 1;
  const settingFollows = prev?.settingWeek && !sheet.standings;
  return (
    <article className="sheet" aria-labelledby="sheet-title">
      <header className="sheet-head">
        <span className="sheet-logo" aria-hidden>{ctx.league.logoText}</span>
        <div className="min-w-0">
          <div className="eyebrow">{ctx.league.name} · {ctx.season!.name}{sheet.phase === "playoff" ? " · Playoffs" : ""}</div>
          <h1 id="sheet-title" className="h-page">Week {sheet.week} sheet</h1>
          <p className="muted text-[14px]">{formatDate(sheet.date, long)}{sheet.label ? ` · ${sheet.label}` : ""}</p>
        </div>
        {sheet.settingWeek ? <Badge tone="info">HANDICAP WEEK</Badge> : null}
      </header>

      {sheet.settingWeek ? (
        <p className="sheet-callout"><b>Handicap week.</b> Everyone bowls scratch tonight, with no handicap. Scores count toward averages and handicaps only, not the standings.</p>
      ) : null}

      <Section id="sh-last" title={prev ? `Last week · Week ${prev.week}` : "Last week"} aside={prev ? <>{formatDate(prev.date, short)}{prev.settingWeek ? <> · <Badge tone="info">HANDICAP WEEK</Badge></> : null}</> : undefined}>
        {!prev ? <p className="muted text-[14px]">No results yet. This is the first night of the season.</p> : (
          <>
            {prev.settingWeek ? <p className="sheet-note">Handicap week: bowled scratch, no points or winners. These scores set everyone&apos;s starting handicap.</p> : null}
            <div className="sheet-grid">
              {prev.results.filter((r) => !r.isBye).map((r) => <ResultTable key={r.matchup.id} r={r} ctx={ctx} names={names} />)}
            </div>
            {prev.results.some((r) => r.isBye) ? <p className="sheet-note">Sat out: {prev.results.filter((r) => r.isBye).map((r) => r.a.lineup.map((l) => names.get(l.bowlerId)).join(", ") || ctx.model!.teamById.get(r.a.participantId)?.name).join("; ")}</p> : null}
            {prev.notFinal ? <p className="sheet-note">{prev.notFinal} matchup{prev.notFinal === 1 ? " isn't" : "s aren't"} final yet and {prev.notFinal === 1 ? "is" : "are"} left off.</p> : null}
            {prev.highGame.length || prev.topSeries.length || prev.headlines.length ? (
              <div className="sheet-highlights">
                {prev.highGame.length ? <p><b>High game:</b> {prev.highGame.map((h) => `${h.name} ${h.score}`).join(", ")}</p> : null}
                {prev.topSeries.length ? <p><b>High series:</b> {prev.topSeries.map((s) => `${s.name} ${s.score}`).join(", ")}</p> : null}
                {prev.headlines.map((h, i) => <p key={i}>{h}</p>)}
              </div>
            ) : null}
          </>
        )}
      </Section>

      {showStandings ? (
        <Section id="sh-standings" title={`Standings entering week ${sheet.week}`}>
          {sheet.standings ? (
            <div className="card sheet-standings"><StandingsTable ctx={ctx} rows={sheet.standings} compact seasonQ={seasonQ} kind={sheet.standingsFor === "bowler" ? "individual" : "team"} qualifiers={ctx.cfg.playoffs.enabled ? ctx.cfg.playoffs.qualifiers : undefined} /></div>
          ) : <p className="muted text-[14px]">{settingFollows ? "Standings start after the handicap weeks. Nothing has counted yet." : "No standings yet."}</p>}
        </Section>
      ) : null}

      <Section id="sh-this" title={`This week · Week ${sheet.week} matchups`} aside={sheet.handicapOn ? "Average · handicap" : "Average"}>
        {sheet.matchups.length === 0 ? (
          <p className="muted text-[14px]">{sheet.partners ? "Partners and matchups are drawn at the start of the night." : "No matchups are scheduled for this week yet."}</p>
        ) : (
          <div className="sheet-grid">{sheet.matchups.map((x) => <MatchCard key={x.matchupId} m={x} />)}</div>
        )}
      </Section>

      <Section id="sh-avg" title="Averages & handicaps" aside={sheet.handicapOn ? `Going into week ${sheet.week}` : `Going into week ${sheet.week} · no handicap this week`} className="sheet-flow">
        {sheet.bowlers.length === 0 ? <p className="muted text-[14px]">Nobody is on this season&apos;s roster yet.</p> : <AveragesTable rows={sheet.bowlers} handicapOn={sheet.handicapOn} teams={!sheet.partners && sheet.bowlers.some((b) => b.teamName)} />}
        <p className="sheet-note">Averages and handicaps come from finalized scores through week {prev?.week ?? 0}. +/− is the change since the week before.</p>
      </Section>

      {sheet.upcoming.length ? (
        <Section id="sh-next" title="Coming up">
          <ul className="sheet-upcoming">
            {sheet.upcoming.map((u) => (
              <li key={u.week}>
                <b>{u.phase === "playoff" ? u.label || `Playoffs · Week ${u.week}` : `Week ${u.week}`}</b> · {formatDate(u.date, short)}
                {u.postponed ? <> · <Badge tone="warn">POSTPONED</Badge></> : null}
                <span className="muted">
                  {" · "}
                  {u.matches.length ? u.matches.map((x) => (x.b ? `${x.a} vs ${x.b}${x.extra ? " (extra)" : ""}` : x.a)).join(" · ") : sheet.partners ? "Partners are drawn at the start of the night." : "Matchups not scheduled yet."}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </article>
  );
}
