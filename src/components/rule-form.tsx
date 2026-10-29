"use client";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { TIEBREAKERS, TIEBREAKER_LABELS, validateConfig, type RuleConfig, type Tiebreaker } from "@/domain/config";
import { calculateHandicap, handicapBounds } from "@/domain/handicap";
import { maxMatchupPoints } from "@/domain/scoring";

export type RuleSectionId = "format" | "scoring" | "handicap" | "standings" | "playoffs" | "eligibility";

function setPath(cfg: RuleConfig, path: string, value: unknown): RuleConfig {
  const c = structuredClone(cfg) as unknown as Record<string, unknown>;
  const keys = path.split(".");
  let o = c;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = value;
  return c as unknown as RuleConfig;
}
function getPath(cfg: RuleConfig, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], cfg);
}

interface Ctl {
  cfg: RuleConfig;
  set: (path: string, value: unknown) => void;
  issues: Record<string, string>;
  disabled?: boolean;
}

function Num({ c, path, label, help, min, max, step = 1, nullable = false, suffix }: { c: Ctl; path: string; label: string; help?: string; min?: number; max?: number; step?: number; nullable?: boolean; suffix?: string }) {
  const v = getPath(c.cfg, path) as number | null;
  const id = `f-${path}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="flex items-center gap-2">
        <input id={id} type="number" inputMode="decimal" className="input" min={min} max={max} step={step} disabled={c.disabled} value={v ?? ""} aria-invalid={!!c.issues[path]} aria-describedby={help ? `${id}-h` : undefined}
          onChange={(e) => c.set(path, e.target.value === "" ? (nullable ? null : 0) : Number(e.target.value))} />
        {suffix ? <span className="muted text-[13px]">{suffix}</span> : null}
      </div>
      {help ? <span id={`${id}-h`} className="help">{help}</span> : null}
      {c.issues[path] ? <span className="text-[13px] text-loss" role="alert">{c.issues[path]}</span> : null}
    </div>
  );
}

function Sel<T extends string>({ c, path, label, help, options }: { c: Ctl; path: string; label: string; help?: string; options: [T, string][] }) {
  const id = `f-${path}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" disabled={c.disabled} value={String(getPath(c.cfg, path) ?? "")} onChange={(e) => c.set(path, e.target.value === "" ? null : e.target.value)} aria-describedby={help ? `${id}-h` : undefined}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {help ? <span id={`${id}-h`} className="help">{help}</span> : null}
      {c.issues[path] ? <span className="text-[13px] text-loss" role="alert">{c.issues[path]}</span> : null}
    </div>
  );
}

function Bool({ c, path, label, help }: { c: Ctl; path: string; label: string; help?: string }) {
  const id = `f-${path}`;
  return (
    <div className="field">
      <label className="check items-start" htmlFor={id}>
        <input id={id} type="checkbox" className="mt-0.5" disabled={c.disabled} checked={!!getPath(c.cfg, path)} onChange={(e) => c.set(path, e.target.checked)} />
        <span><span className="font-semibold text-fg">{label}</span>{help ? <span className="help block font-normal">{help}</span> : null}</span>
      </label>
    </div>
  );
}

const Group = ({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) => (
  <fieldset className="grid gap-3 rounded-[10px] border border-line p-5">
    <legend className="eyebrow px-1.5">{title}</legend>
    {note ? <p className="help -mt-1">{note}</p> : null}
    <div className="grid gap-3 sm:grid-cols-2">{children}</div>
  </fieldset>
);

export function HandicapExample({ cfg }: { cfg: RuleConfig }) {
  const [avg, setAvg] = useState(160);
  const h = cfg.handicap;
  const base = h.baseValue;
  const b = calculateHandicap({ average: avg, base }, h);
  const { min, max } = handicapBounds(h);
  const G = cfg.scoring.gamesPerSession;
  const rows = [120, 140, 160, 180, 200, 220, 240].map((a) => [a, calculateHandicap({ average: a, base }, h).handicap] as const);
  return (
    <div className="rounded-[10px] border border-line bg-raised p-5" aria-live="polite">
      <div className="eyebrow mb-2">Live example</div>
      {!h.enabled ? <p className="text-[13px]">Handicap is off: everyone bowls scratch.</p> : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <div className="field"><label htmlFor="ex-avg">A bowler averaging</label><input id="ex-avg" type="number" className="input !w-28" value={avg} min={0} max={300} onChange={(e) => setAvg(Number(e.target.value) || 0)} /></div>
            <div className="num text-[22px] font-bold leading-none">{b.handicap} <span className="muted text-[13px] font-medium">pins per game</span></div>
          </div>
          <p className="num mt-2 text-[13px]">{b.formula}</p>
          <ul className="muted mt-1 list-disc pl-4 text-[13px]">{b.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <p className="mt-2 text-[13px]">Over a {G}-game series that is <b className="num">{b.handicap * G}</b> handicap pins: a scratch series of {G * 190} becomes <b className="num">{G * 190 + b.handicap * G}</b>.</p>
          {h.baseMode !== "fixed" ? <p className="help mt-1">Base is {h.baseMode === "league_average" ? "the league average" : "the highest average"} each week; the example uses {base} until averages exist.</p> : null}
          <div className="tbl-wrap mt-3"><table className="tbl"><thead><tr><th scope="col">Average</th>{rows.map(([a]) => <th key={a} scope="col">{a}</th>)}</tr></thead><tbody><tr><td className="muted">Handicap</td>{rows.map(([a, hh]) => <td key={a} className="num">{hh}</td>)}</tr></tbody></table></div>
          <p className="help mt-1">Limits: min {min === -Infinity ? "none" : min}, max {max === Infinity ? "none" : max}.</p>
        </>
      )}
    </div>
  );
}

function Tiebreakers({ c }: { c: Ctl }) {
  const list = c.cfg.standings.tiebreakers;
  const move = (i: number, d: number) => {
    const next = [...list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    c.set("standings.tiebreakers", next);
  };
  const available = TIEBREAKERS.filter((t) => !list.includes(t));
  return (
    <div className="field sm:col-span-2">
      <span className="label" id="tb-label">Ranking order (first is most important)</span>
      <p className="help">Teams are compared on the first item; only teams level on it move to the next. Teams level on everything are listed alphabetically.</p>
      <ol aria-labelledby="tb-label" className="grid gap-1.5">
        {list.map((t, i) => (
          <li key={t} className="flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px]">
            <span className="rank">{i + 1}</span><span className="flex-1">{TIEBREAKER_LABELS[t]}</span>
            <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => move(i, -1)} disabled={c.disabled || i === 0} aria-label={`Move ${TIEBREAKER_LABELS[t]} up`}><ArrowUp size={14} /></button>
            <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => move(i, 1)} disabled={c.disabled || i === list.length - 1} aria-label={`Move ${TIEBREAKER_LABELS[t]} down`}><ArrowDown size={14} /></button>
            <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => list.length > 1 && c.set("standings.tiebreakers", list.filter((x) => x !== t))} disabled={c.disabled || list.length <= 1} aria-label={`Remove ${TIEBREAKER_LABELS[t]}`}><X size={14} /></button>
          </li>
        ))}
      </ol>
      {available.length ? (
        <label className="flex items-center gap-2 text-[13px]"><Plus size={14} aria-hidden /><span className="sr-only">Add a tie-breaker</span>
          <select className="select !w-64" value="" disabled={c.disabled} onChange={(e) => e.target.value && c.set("standings.tiebreakers", [...list, e.target.value as Tiebreaker])}>
            <option value="">Add a criterion…</option>{available.map((t) => <option key={t} value={t}>{TIEBREAKER_LABELS[t]}</option>)}
          </select>
        </label>
      ) : null}
      {c.issues["standings.tiebreakers"] ? <span className="text-[13px] text-loss">{c.issues["standings.tiebreakers"]}</span> : null}
    </div>
  );
}

/**
 * The rules editor. Renders one or more sections of a RuleConfig with plain-language help, validates live
 * (the server validates again), and never hardcodes a league's rules — everything starts from the config passed in.
 */
export function RuleForm({ value, onChange, sections, disabled, lockStructural }: { value: RuleConfig; onChange: (c: RuleConfig) => void; sections: RuleSectionId[]; disabled?: boolean; lockStructural?: boolean }) {
  const check = useMemo(() => validateConfig(value), [value]);
  const issues = useMemo(() => {
    const m: Record<string, string> = {};
    for (const i of check.issues) m[i.path] = i.message.replace(/^[\w.]+: /, "");
    return m;
  }, [check]);
  const c: Ctl = { cfg: value, set: (p, v) => onChange(setPath(value, p, v)), issues, disabled };
  const s = value.scoring;
  const show = (id: RuleSectionId) => sections.includes(id);
  const structuralNote = lockStructural ? "Locked: this can't change once scores exist. Apply it to a new season instead." : undefined;
  const cd: Ctl = lockStructural ? { ...c, disabled: true } : c;
  return (
    <div className="grid gap-6 md:gap-8">
      {show("format") ? (
        <Group title="Competition format" note="How bowlers are matched up each week.">
          <Sel c={cd} path="format" label="Format" options={[["team", "Team vs. team"], ["individual", "Bowler vs. bowler"], ["both", "Teams, plus bowler vs. bowler inside each match"]]} help={structuralNote ?? "Team: bowlers' scores are added together. Individual: one bowler against one bowler. Combined: team totals decide the team match and each bowler also faces the bowler in the same position on the other team."} />
          {value.format !== "individual" ? <Num c={cd} path="bowlersPerTeam" label="Bowlers per team" min={1} max={8} help={structuralNote ?? "Bowlers who bowl for a team each week."} /> : null}
          {value.format !== "individual" ? <Bool c={c} path="allowSubstitutes" label="Allow substitutes" help="Substitutes can fill in for absent team members." /> : null}
          <Sel c={c} path="scheduleFormat" label="Schedule type" options={[["round_robin", "Round robin"], ["double_round_robin", "Double round robin"], ["manual", "I'll build it by hand"]]} help="Used as a default when generating the schedule. Odd numbers of teams get a bye each week." />
        </Group>
      ) : null}

      {show("scoring") ? (
        <>
          <Group title="Games & results">
            <Num c={cd} path="scoring.gamesPerSession" label="Games per night" min={1} max={10} help={structuralNote ?? "Most leagues bowl three."} />
            <Sel c={c} path="scoring.basis" label="Winners are decided on" options={[["handicap", "Handicap-adjusted pins"], ["scratch", "Scratch pins"]]} help="Scratch is the pins actually knocked down. Handicap adds pins to level the field." />
            <Sel c={c} path="scoring.matchupWinnerBy" label="Overall matchup winner is" options={[["points", "Whoever earns more points"], ["series", "Whoever has the higher series total"]]} help="Controls the win/loss record in the standings." />
            <Num c={c} path="scoring.minGameScore" label="Lowest allowed game score" min={0} max={300} />
            <Num c={c} path="scoring.maxGameScore" label="Highest allowed game score" min={1} max={450} help="Standard games max out at 300." />
            <Num c={c} path="scoring.suspiciousDeviation" label="Flag scores this far from average" min={10} max={300} suffix="pins" help="Flagged scores can still be saved after you confirm them." />
          </Group>
          <Group title="Points">
            <Num c={c} path="scoring.pointsPerGame" label="Points for each game won" min={0} step={0.5} />
            <Num c={c} path="scoring.pointsPerSeries" label="Points for winning the series" min={0} step={0.5} help="The series is the total of all games." />
            <Num c={c} path="scoring.tieFraction" label="Share of the points each side gets on a tie" min={0} max={1} step={0.25} help="0.5 splits the points evenly." />
            <Num c={c} path="scoring.bonus.highGame" label="Bonus: highest single game" min={0} step={0.5} help="Optional. Awarded to the side with the best individual game." />
            <Num c={c} path="scoring.bonus.highSeries" label="Bonus: highest individual series" min={0} step={0.5} help="Optional." />
            <Num c={c} path="scoring.byePoints" label="Points for a bye week" min={0} step={0.5} />
            {value.format === "both" ? <Num c={c} path="scoring.individual.pointsPerGame" label="Individual: points per game" min={0} step={0.5} /> : null}
            {value.format === "both" ? <Num c={c} path="scoring.individual.pointsPerSeries" label="Individual: points per series" min={0} step={0.5} /> : null}
            <p className="help sm:col-span-2">With these settings a matchup is worth up to <b className="text-fg">{maxMatchupPoints(value)}</b> points.</p>
          </Group>
          <Group title="Absences, forfeits & incomplete games">
            <Sel c={c} path="scoring.absentPolicy" label="When a bowler is absent" options={[["blind", "Give a blind score"], ["none", "Score nothing"]]} />
            {s.absentPolicy === "blind" ? <Sel c={c} path="scoring.blindMode" label="Blind score is" options={[["average_minus_offset", "Their average minus a few pins"], ["fixed", "A fixed number"]]} /> : null}
            {s.absentPolicy === "blind" && s.blindMode === "average_minus_offset" ? <Num c={c} path="scoring.blindOffset" label="Pins below average" min={0} /> : null}
            {s.absentPolicy === "blind" ? <Num c={c} path="scoring.blindFixed" label={s.blindMode === "fixed" ? "Blind score" : "Blind score for bowlers with no average"} min={0} max={300} /> : null}
            <Sel c={c} path="scoring.forfeitPoints" label="When a side forfeits" options={[["max_to_opponent", "Opponent gets maximum points"], ["none", "No points are awarded"]]} />
            <Sel c={c} path="scoring.incompletePolicy" label="Missing scores" options={[["block_finalize", "Can't finalize until every score is in"], ["allow_partial", "Allow it; only complete games count"]]} />
          </Group>
        </>
      ) : null}

      {show("handicap") ? (
        <>
          <Group title="Handicap">
            <Bool c={c} path="handicap.enabled" label="Use handicaps" help="Turn off for a scratch league." />
            {value.handicap.enabled ? (
              <>
                <Num c={c} path="handicap.percentage" label="Handicap percentage" min={0} max={200} suffix="%" help="Commonly 80, 90 or 100. Higher gives weaker bowlers more help." />
                <Sel c={c} path="handicap.baseMode" label="Base average" options={[["fixed", "A fixed number"], ["league_average", "League average each week"], ["highest_average", "Highest bowler average each week"]]} help="The score everyone is handicapped up toward." />
                <Num c={c} path="handicap.baseValue" label={value.handicap.baseMode === "fixed" ? "Base average" : "Base average until averages exist"} min={0} max={300} help="Commonly 200–220." />
                <Sel c={c} path="handicap.rounding" label="Rounding" options={[["nearest", "To the nearest pin"], ["floor", "Down"], ["ceil", "Up"], ["truncate", "Toward zero"]]} />
                <Num c={c} path="handicap.minHandicap" label="Minimum handicap" nullable help="Leave empty for none. Without negative handicaps allowed, nobody goes below 0." />
                <Num c={c} path="handicap.maxHandicap" label="Maximum handicap" nullable help="Leave empty for no cap." />
                <Bool c={c} path="handicap.allowNegative" label="Allow negative handicaps" help="Bowlers above the base would lose pins. Off by default." />
              </>
            ) : null}
          </Group>
          {value.handicap.enabled ? (
            <Group title="Which average counts">
              <Sel c={c} path="handicap.averageSource" label="Handicap is based on" options={[["established", "Entering average, then the league average once established"], ["entering", "The entering average all season"]]} />
              <Num c={c} path="handicap.establishAfterGames" label="Games to establish an average" min={0} max={200} help="Until then the entering average is used." />
              <Sel c={c} path="handicap.averageMethod" label="Average is calculated as" options={[["cumulative", "Season average (all games)"], ["rolling", "Rolling (last N games)"], ["blended", "Blend of entering average and games bowled"]]} />
              {value.handicap.averageMethod === "rolling" ? <Num c={c} path="handicap.rollingGames" label="Rolling window" min={1} suffix="games" /> : null}
              {value.handicap.averageMethod === "blended" ? <Num c={c} path="handicap.blendGames" label="Entering average counts as" min={1} suffix="games" /> : null}
              <Sel c={c} path="handicap.averageRounding" label="Round the average before use" options={[["floor", "Down (most common)"], ["nearest", "To nearest"], ["none", "Don't round"]]} />
              <Num c={c} path="handicap.recalcEveryWeeks" label="Update handicaps every" min={1} max={52} suffix="week(s)" help="1 = every week, from all finalized earlier weeks." />
              <Sel c={c} path="handicap.lockMode" label="Finalized results" options={[["locked", "Lock handicaps when finalized (recommended)"], ["live", "Recompute if earlier scores change"]]} help="Locked results never change because of later corrections elsewhere." />
              <Sel c={c} path="handicap.newBowlerPolicy" label="New bowler with no average" options={[["first_games_average", "Use games bowled so far"], ["fixed_average", "Treat as a fixed average"], ["no_handicap", "No handicap until established"]]} />
              {value.handicap.newBowlerPolicy === "fixed_average" ? <Num c={c} path="handicap.newBowlerAverage" label="New bowler average" min={0} max={300} /> : null}
              {value.format !== "individual" ? <Sel c={c} path="handicap.subPolicy" label="Substitute bowlers" options={[["own_average", "Their own average"], ["fixed_average", "A fixed average"], ["no_handicap", "No handicap"]]} /> : null}
              {value.format !== "individual" && value.handicap.subPolicy === "fixed_average" ? <Num c={c} path="handicap.subAverage" label="Substitute average" min={0} max={300} /> : null}
            </Group>
          ) : null}
          <HandicapExample cfg={value} />
        </>
      ) : null}

      {show("standings") ? (
        <Group title="Standings">
          <Tiebreakers c={c} />
          <Sel c={c} path="standings.pinsBasis" label="Total pins & averages use" options={[["handicap", "Handicap-adjusted pins"], ["scratch", "Scratch pins"]]} />
          <Bool c={c} path="standings.includeProvisional" label="Include unfinalized (draft) results" help="Normally only finalized results count in official standings." />
        </Group>
      ) : null}

      {show("playoffs") ? (
        <Group title="Playoffs" note="Playoffs are single elimination, seeded by the final regular-season standings.">
          <Bool c={c} path="playoffs.enabled" label="This league has playoffs" />
          {value.playoffs.enabled ? (
            <>
              <Num c={c} path="playoffs.qualifiers" label="Teams that qualify" min={2} max={32} />
              <Num c={c} path="playoffs.weeks" label="Playoff weeks" min={1} max={8} help="Weeks added after the regular season." />
              <Sel c={c} path="playoffs.tiebreak" label="If a playoff match ends level" options={[["series_then_seed", "Series winner advances, then higher seed"], ["higher_seed", "Higher seed advances"]]} />
              <Num c={c} path="playoffs.gamesPerSession" label="Playoff games per night" nullable min={1} max={10} help="Leave empty to use the regular-season value." />
              <Sel c={c} path="playoffs.basis" label="Playoff scoring basis" options={[["", "Same as regular season"], ["handicap", "Handicap-adjusted"], ["scratch", "Scratch"]]} />
              <Num c={c} path="playoffs.pointsPerGame" label="Playoff points per game" nullable min={0} step={0.5} help="Leave empty to use the regular-season value." />
              <Num c={c} path="playoffs.pointsPerSeries" label="Playoff points per series" nullable min={0} step={0.5} />
            </>
          ) : null}
        </Group>
      ) : null}

      {show("eligibility") ? (
        <Group title="Awards & records">
          <Num c={c} path="eligibility.minGamesForAwards" label="Games needed for ranked awards" min={0} max={100} help="Stops a lucky first night from topping the leaderboards." />
          <Bool c={c} path="eligibility.subsCountForRecords" label="Substitutes can set records" />
          <Bool c={c} path="recordsCarryOver" label="Records carry across seasons" help="Off = records reset each season." />
        </Group>
      ) : null}

      {check.issues.length ? (
        <ul className="grid gap-1.5" aria-label="Rule check">
          {check.issues.map((i, k) => <li key={k} className={`alert ${i.severity === "error" ? "alert-error" : "alert-warn"}`}>{i.message}</li>)}
        </ul>
      ) : null}
    </div>
  );
}
