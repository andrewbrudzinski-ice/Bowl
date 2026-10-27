import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { buildSeasonModel } from "@/domain/engine";
import { fmt1, fmtPts } from "@/domain/math";
import { matchupRecap } from "@/domain/narrative";
import { computeStandings } from "@/domain/standings";
import { Breakdown, BowlerCard } from "@/components/matchup-parts";
import { ParticipantName, Scoreboard } from "@/components/scoreboard";
import { ShareBar } from "@/components/share-bar";
import { Alert, Badge, Card, CardHead, EmptyState, FormChips, KV } from "@/components/ui";
import { seasonData } from "@/server/access";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { formatDate, participant, recordsEntering, resultStatus, shareHref } from "@/server/views";

export async function generateMetadata({ params }: { params: Promise<{ slug: string; id: string }> }) {
  return { title: "Matchup" };
}

export default async function MatchupPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const base = await getLeagueCtx(slug);
  // Find the season that owns this matchup, scoped to this league.
  const owner = await getStore().read((db) => {
    const m = db.matchups.find((x) => x.id === id);
    const s = m ? db.seasons.find((x) => x.id === m.seasonId && x.leagueId === base.league.id) : null;
    return s ? s.slug : null;
  }, { leagueId: base.league.id });
  if (!owner) notFound();
  const ctx = await getLeagueCtx(slug, owner);
  const model = ctx.model!;
  const r = model.resultById.get(id);
  if (!r) notFound();
  const kind = r.matchup.kind === "team" ? "team" : "individual";
  const sq = ctx.season!.slug === (ctx.seasons.find((s) => s.status === "active") ?? ctx.seasons[0])?.slug ? null : ctx.season!.slug;
  const A = participant(ctx, r.a.participantId, kind, sq);
  const B = r.b ? participant(ctx, r.b.participantId, kind, sq) : undefined;
  const rec = recordsEntering(ctx, r.weekNumber);
  const status = resultStatus(r);
  const week = model.weekByNumber.get(r.weekNumber);
  const cfg = model.configForWeek(r.weekNumber);
  const ver = r.matchup.ruleVersion != null ? ctx.season!.ruleVersions.find((v) => v.version === r.matchup.ruleVersion) : model.versionForWeek(r.weekNumber);
  const recap = status.final ? matchupRecap(model, r) : [];
  const weekMatchups = model.results.filter((x) => x.weekNumber === r.weekNumber && !x.isBye);
  const idx = weekMatchups.findIndex((x) => x.matchup.id === id);
  const prev = weekMatchups[idx - 1];
  const next = weekMatchups[idx + 1];

  // Form + season averages entering the matchup
  const scope = kind === "team" ? "team" : "bowler";
  const before = computeStandings(model, { scope, throughWeek: r.weekNumber - 1 }).rows;
  const rowA = before.find((x) => x.id === A.id);
  const rowB = B ? before.find((x) => x.id === B.id) : undefined;
  const entering = (side: typeof r.a) => {
    const avs = side.lineup.map((l) => l.average);
    return avs.length && avs.every((a) => a != null) ? avs.reduce((t, a) => t! + a!, 0)! : null;
  };
  const enA = entering(r.a);
  const enB = r.b ? entering(r.b) : null;

  // Head-to-head across every season of this league (official results only)
  type H2H = { season: string; week: number; id: string; text: string; winner: string | null };
  // Built inside the callback and returned: the store may re-run a callback, so it must not push into outer state.
  const h2h: H2H[] = B ? await getStore().read((db) => {
    const out: H2H[] = [];
    for (const s of ctx.seasons) {
      const m2 = s.id === ctx.season!.id ? model : buildSeasonModel(seasonData(db, ctx.league.id, s.id));
      for (const x of m2.results) {
        if (!x.official || x.isBye || x.matchup.id === id || x.matchup.kind !== r.matchup.kind || !x.b || !x.winner) continue;
        const ids = [x.a.participantId, x.b.participantId];
        if (!(ids.includes(A.id) && ids.includes(B.id))) continue;
        if (s.id === ctx.season!.id && x.weekNumber > r.weekNumber) continue;
        const aSide = x.a.participantId === A.id ? x.a : x.b;
        const bSide = x.a.participantId === A.id ? x.b : x.a;
        const w = x.winner === "tie" ? null : (x.winner === "A" ? x.a.participantId : x.b.participantId);
        out.push({ season: s.name, week: x.weekNumber, id: x.matchup.id, text: `${A.name} ${fmtPts(aSide.points)} – ${fmtPts(bSide.points)} ${B.name} (${aSide.basisSeries}–${bSide.basisSeries} pins)`, winner: w === A.id ? A.name : w === B.id ? B.name : "Tie" });
      }
    }
    return out;
  }, { leagueId: ctx.league.id }) : [];
  const share = shareHref(ctx, `/l/${slug}/matchup/${id}`);
  const G = cfg.scoring.gamesPerSession;
  const proj = !status.final && enA != null && enB != null && B ? { a: enA * G, b: enB * G, ha: r.a.lineup.reduce((t, l) => t + l.handicap, 0) * G, hb: r.b!.lineup.reduce((t, l) => t + l.handicap, 0) * G } : null;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={week ? `/l/${slug}/season/${ctx.season!.slug}/week/${r.weekNumber}` : `/l/${slug}/schedule`} className="btn btn-ghost btn-sm"><ChevronLeft size={14} />Week {r.weekNumber}</Link>
        <ShareBar path={share.path} title={`${A.name}${B ? ` vs ${B.name}` : ""} — Week ${r.weekNumber}`} imageHref={ctx.isMember || ctx.league.visibility === "public" ? `/l/${slug}/matchup/${id}/scorecard` : undefined} note={share.note} />
      </div>

      <div>
        <div className="eyebrow">{ctx.season!.name} · Week {r.weekNumber}{week?.date ? ` · ${formatDate(week.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}{r.matchup.playoffRound ? ` · Playoff round ${r.matchup.playoffRound}` : ""}</div>
        <h1 className="h-page mt-1">{A.name}{B ? <span className="muted font-medium"> vs </span> : null}{B?.name}</h1>
      </div>

      {r.matchup.state === "corrected" ? <Alert tone="info" title="Corrected after finalization">This result was changed after it was first finalized. The change is recorded in the league's audit history.</Alert> : null}
      {!status.final && !r.isBye ? <Alert tone="warn" title="Unofficial">{r.complete ? "All scores are in, but this result hasn't been finalized. It does not count in official standings." : `${r.missing.length} score${r.missing.length === 1 ? " is" : "s are"} still missing, so there is no result yet.`}</Alert> : null}

      <Scoreboard r={r} a={A} b={B} recA={rec.get(A.id)} recB={B ? rec.get(B.id) : undefined} />

      {recap.length ? (
        <Card>
          <CardHead title="Recap" />
          <ul className="grid gap-1.5 p-3.5">{recap.map((l, i) => <li key={i} className="flex gap-2 text-[13.5px]"><span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden />{l.text}</li>)}</ul>
          <p className="faint border-t border-line px-3.5 py-2 text-[11px]">Every line is generated from the recorded scores above.</p>
        </Card>
      ) : null}

      {B ? (
        <>
          <Card>
            <CardHead title="How the result was decided" right={<Badge tone={r.basis === "handicap" ? "accent" : "neutral"}>{r.basis === "handicap" ? "Decided on handicap-adjusted pins" : "Decided on scratch pins"}</Badge>} />
            <Breakdown r={r} nameA={A.name} nameB={B.name} />
            <dl className="border-t border-line px-3.5 py-1">
              <KV k="Series margin">{r.margin != null ? `${r.margin} ${r.basis === "handicap" ? "adjusted " : ""}pins` : "—"}</KV>
              {r.basis === "handicap" ? <KV k="Scratch series">{r.a.scratchSeries} vs {r.b!.scratchSeries} ({r.a.scratchSeries === r.b!.scratchSeries ? "level" : `${Math.abs(r.a.scratchSeries - r.b!.scratchSeries)} pin${Math.abs(r.a.scratchSeries - r.b!.scratchSeries) === 1 ? "" : "s"} difference`})</KV> : null}
              {r.basis === "handicap" ? <KV k="Handicap pins (series)">{r.a.handicapSeries} vs {r.b!.handicapSeries}</KV> : null}
              <KV k="Rules in effect">{ver ? `Version ${ver.version}, from week ${ver.effectiveFromWeek}` : "—"}</KV>
              {ver && ver.config.handicap.enabled ? <KV k="Handicap formula">{`${ver.config.handicap.baseMode === "fixed" ? `(${ver.config.handicap.baseValue} − avg)` : "(base − avg)"} × ${ver.config.handicap.percentage}%, ${ver.config.handicap.rounding}`}</KV> : <KV k="Handicap">Not used</KV>}
            </dl>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <BowlerCard ctx={ctx} r={r} side={r.a} name={A.name} />
            <BowlerCard ctx={ctx} r={r} side={r.b!} name={B.name} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHead title="Entering the matchup" />
              <table className="tbl">
                <thead><tr><th scope="col" className="!pl-3" /><th scope="col"><ParticipantName p={A} link={false} size={20} /></th><th scope="col"><ParticipantName p={B} link={false} size={20} /></th></tr></thead>
                <tbody>
                  <tr><td className="!pl-3 muted">Standing</td><td>{rowA ? `#${rowA.rank}` : "—"}</td><td>{rowB ? `#${rowB.rank}` : "—"}</td></tr>
                  <tr><td className="!pl-3 muted">Record</td><td>{rowA ? `${rowA.wins}-${rowA.losses}${rowA.ties ? `-${rowA.ties}` : ""}` : "0-0"}</td><td>{rowB ? `${rowB.wins}-${rowB.losses}${rowB.ties ? `-${rowB.ties}` : ""}` : "0-0"}</td></tr>
                  <tr><td className="!pl-3 muted">Points</td><td>{rowA ? fmtPts(rowA.points) : 0}</td><td>{rowB ? fmtPts(rowB.points) : 0}</td></tr>
                  <tr><td className="!pl-3 muted">Game average</td><td>{fmt1(rowA?.average)}</td><td>{fmt1(rowB?.average)}</td></tr>
                  {kind === "team" ? <tr><td className="!pl-3 muted" title="Sum of lineup averages used for handicap">Lineup average total</td><td>{enA != null ? Math.round(enA * 10) / 10 : "—"}</td><td>{enB != null ? Math.round(enB * 10) / 10 : "—"}</td></tr> : null}
                  <tr><td className="!pl-3 muted">Last five</td><td><FormChips form={rowA?.form ?? []} /></td><td><FormChips form={rowB?.form ?? []} /></td></tr>
                </tbody>
              </table>
            </Card>
            <Card>
              <CardHead title="Head-to-head" />
              {h2h.length === 0 ? (
                <EmptyState title="No previous meetings">Records are only shown when official results exist — nothing is estimated.</EmptyState>
              ) : (
                <>
                  <ul className="divide-y divide-line">{h2h.slice(-5).reverse().map((h) => <li key={h.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2 text-[13px]"><Link href={`/l/${slug}/matchup/${h.id}`} className="hover:underline">{h.text}</Link><span className="faint shrink-0 text-xs">{h.season} · Wk {h.week}</span></li>)}</ul>
                  <p className="muted border-t border-line px-3.5 py-2 text-xs">All-time in this league: {A.name} {h2h.filter((h) => h.winner === A.name).length}–{h2h.filter((h) => h.winner === B.name).length} {B.name}{h2h.some((h) => h.winner === "Tie") ? `, ${h2h.filter((h) => h.winner === "Tie").length} tied` : ""} ({h2h.length} meeting{h2h.length === 1 ? "" : "s"})</p>
                </>
              )}
            </Card>
          </div>

          {proj ? (
            <Card>
              <CardHead title="Average-based comparison" right={<Badge>NOT A PREDICTION</Badge>} />
              <div className="p-3.5 text-[13px]">
                <p className="muted mb-2">If every bowler in the lineups scored exactly their current average for {G} games:</p>
                <ul className="grid gap-1">
                  <li><b>Scratch:</b> <span className="num">{A.name} {Math.round(proj.a)} vs {B.name} {Math.round(proj.b)}</span></li>
                  {r.basis === "handicap" ? <li><b>With handicap:</b> <span className="num">{A.name} {Math.round(proj.a + proj.ha)} vs {B.name} {Math.round(proj.b + proj.hb)}</span></li> : null}
                </ul>
                <p className="faint mt-2 text-xs">Simple arithmetic on recorded averages. Real scores vary from night to night, so this says nothing about who will win.</p>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}

      <nav className="flex justify-between text-[13px]" aria-label="Other matchups this week">
        {prev ? <Link className="btn btn-sm" href={`/l/${slug}/matchup/${prev.matchup.id}`}>← {participant(ctx, prev.a.participantId, kind).name} vs {participant(ctx, prev.b!.participantId, kind).name}</Link> : <span />}
        {next ? <Link className="btn btn-sm" href={`/l/${slug}/matchup/${next.matchup.id}`}>{participant(ctx, next.a.participantId, kind).name} vs {participant(ctx, next.b!.participantId, kind).name} →</Link> : null}
      </nav>
    </div>
  );
}
