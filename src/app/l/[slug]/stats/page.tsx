import Link from "next/link";
import { Fragment } from "react";
import { AWARD_DEFS, computeAwards } from "@/domain/awards";
import { fmt1 } from "@/domain/math";
import { generateInsights } from "@/domain/narrative";
import { RECORD_CATEGORY_LABELS, buildRecordBook, type RecordCategory } from "@/domain/records";
import { bowlerSeasonStats, collectTeamNights, improvement } from "@/domain/stats";
import { Trend } from "@/components/charts";
import { seasonParam } from "@/components/links";
import { ShareBar } from "@/components/share-bar";
import { Alert, Avatar, Badge, Card, CardHead, EmptyState, PageHeader, Tabs } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { allModels, formatDate, shareHref } from "@/server/views";

export const metadata = { title: "Statistics & Records" };
const PALETTE = ["#38bdf8", "#f97316", "#a78bfa", "#34d399", "#f43f5e", "#facc15"];

export default async function Stats({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; tab?: string; q?: string; cat?: string; team?: string; week?: string; scope?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const m = ctx.model;
  const sq = seasonParam(ctx);
  const tab = sp.tab ?? "leaders";
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ ...(sq ? { season: sq } : {}), ...extra }).toString()}`;
  const base = `/l/${slug}/stats`;
  const share = shareHref(ctx, `${base}${qs({ tab })}`);
  const tabs = [
    { key: "leaders", label: "Leaders", href: base + qs({}) }, { key: "awards", label: "Awards", href: base + qs({ tab: "awards" }) },
    { key: "records", label: "Record book", href: base + qs({ tab: "records" }) }, { key: "insights", label: "Insights", href: base + qs({ tab: "insights" }) }, { key: "trends", label: "Trends", href: base + qs({ tab: "trends" }) },
  ];
  const stats = bowlerSeasonStats(m);
  const hasData = stats.some((s) => s.games > 0);

  return (
    <div>
      <PageHeader title="Statistics & records" eyebrow={ctx.season.name} sub="Every number comes from finalized scores. Scratch and handicap-adjusted figures are always labelled separately." actions={<ShareBar path={share.path} title={`${ctx.league.name} stats`} note={share.note} />} />
      <Tabs items={tabs} current={tab} />
      {tab === "leaders" ? <Leaders ctx={ctx} stats={stats} team={sp.team} hasData={hasData} slug={slug} sq={sq} /> : null}
      {tab === "awards" ? <Awards ctx={ctx} week={sp.week ? Number(sp.week) : undefined} slug={slug} sq={sq} /> : null}
      {tab === "records" ? <Records ctx={ctx} q={sp.q} cat={sp.cat} slug={slug} sq={sq} scope={sp.scope} /> : null}
      {tab === "insights" ? <Insights ctx={ctx} /> : null}
      {tab === "trends" ? <Trends ctx={ctx} stats={stats} /> : null}
    </div>
  );
}

function Leaders({ ctx, stats, team, hasData, slug, sq }: { ctx: Awaited<ReturnType<typeof getLeagueCtx>>; stats: ReturnType<typeof bowlerSeasonStats>; team?: string; hasData: boolean; slug: string; sq: string | null }) {
  const m = ctx.model!;
  const min = ctx.cfg.eligibility.minGamesForAwards;
  const hd = ctx.cfg.handicap.enabled;
  const rows = stats.filter((s) => s.games > 0 && (!team || s.teamId === team)).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));
  const teamNights = collectTeamNights(m);
  const teams = m.data.teams.filter((t) => teamNights.some((n) => n.teamId === t.id)).map((t) => { const ns = teamNights.filter((n) => n.teamId === t.id); return { t, hg: Math.max(...ns.flatMap((n) => n.gameScratch)), hs: Math.max(...ns.map((n) => n.scratchSeries)), hga: Math.max(...ns.flatMap((n) => n.gameAdjusted)), hsa: Math.max(...ns.map((n) => n.adjustedSeries)) }; });
  if (!hasData) return <Card><EmptyState title="No finalized scores yet">Leaders and totals appear after the first week is finalized.</EmptyState></Card>;
  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="tab" value="leaders" />{sq ? <input type="hidden" name="season" value={sq} /> : null}
        <div className="field"><label htmlFor="team">Filter by team</label><select id="team" name="team" defaultValue={team ?? ""} className="select !w-48"><option value="">All teams</option>{m.data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
        <button className="btn btn-sm mb-0.5" type="submit">Apply</button>
      </form>
      <Card>
        <CardHead title="Bowler leaderboard" right={<span className="muted">Bowlers with fewer than {min} games are marked “prov.”</span>} />
        <div className="tbl-wrap"><table className="tbl tbl-sticky"><thead><tr><th scope="col" className="!pl-3">Bowler</th><th scope="col">Avg</th><th scope="col">Gms</th><th scope="col">Pins</th><th scope="col" title="Highest scratch game">HG</th><th scope="col" title="Highest scratch series">HS</th>{hd ? <th scope="col" title="Highest handicap-adjusted game">HG+H</th> : null}{hd ? <th scope="col" title="Highest handicap-adjusted series">HS+H</th> : null}<th scope="col" title="Standard deviation of game scores; lower is steadier">σ</th></tr></thead>
          <tbody>{rows.map((s, i) => { const b = m.bowlerById.get(s.bowlerId)!; return <tr key={s.bowlerId}><td className="!pl-3"><Link href={`/l/${slug}/bowlers/${s.bowlerId}${sq ? `?season=${sq}` : ""}`} className="flex min-w-[160px] items-center gap-2 hover:underline"><span className="rank">{i + 1}</span><Avatar name={b.name} color={b.avatarColor} url={b.avatarUrl} size={22} /><span className="truncate font-semibold">{b.name}</span>{s.games < min ? <span className="badge" title={`Fewer than ${min} games`}>PROV.</span> : null}</Link></td><td className="score">{fmt1(s.average)}</td><td className="num">{s.games}</td><td className="num">{s.pins.toLocaleString()}</td><td className="num">{s.highGame?.scratch ?? "—"}</td><td className="num">{s.highSeries?.scratch ?? "—"}</td>{hd ? <td className="num">{s.highGameAdj?.adjusted ?? "—"}</td> : null}{hd ? <td className="num">{s.highSeriesAdj?.adjusted ?? "—"}</td> : null}<td className="num">{s.stdDev == null ? "—" : s.stdDev.toFixed(1)}</td></tr>; })}</tbody></table></div>
      </Card>
      {ctx.cfg.format !== "individual" ? (
        <Card><CardHead title="Team highs" />
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Team</th><th scope="col">High game</th><th scope="col">High series</th>{hd ? <th scope="col">HG+H</th> : null}{hd ? <th scope="col">HS+H</th> : null}</tr></thead>
            <tbody>{[...teams].sort((a, b) => b.hs - a.hs).map(({ t, hg, hs, hga, hsa }) => <tr key={t.id}><td className="!pl-3"><Link className="font-semibold hover:underline" href={`/l/${slug}/teams/${t.id}${sq ? `?season=${sq}` : ""}`}>{t.name}</Link></td><td className="num">{hg}</td><td className="num">{hs}</td>{hd ? <td className="num">{hga}</td> : null}{hd ? <td className="num">{hsa}</td> : null}</tr>)}</tbody></table></div>
        </Card>
      ) : null}
      <Card><CardHead title="How these are calculated" /><ul className="muted list-disc px-8 py-3 text-[13px]"><li><b className="text-fg">Average</b>: total scratch pins ÷ games bowled. Blind and absent scores are excluded.</li><li><b className="text-fg">High series</b>: best total of a full night's games.</li><li><b className="text-fg">Handicap-adjusted</b> figures add the handicap in force that night; scratch figures never include handicap.</li><li><b className="text-fg">σ (consistency)</b>: sample standard deviation of game scores.</li></ul></Card>
    </div>
  );
}

async function Awards({ ctx, week, slug, sq }: { ctx: Awaited<ReturnType<typeof getLeagueCtx>>; week?: number; slug: string; sq: string | null }) {
  const m = ctx.model!;
  const commissioner = await getStore().read((db) => db.commissionerAwards.filter((a) => a.leagueId === ctx.league.id && a.seasonId === ctx.season!.id).map((a) => ({ id: a.id, title: a.title, recipientKind: a.recipientKind, recipientId: a.recipientId, note: a.note, week: a.week })));
  const weeks = [...new Set(m.results.filter((r) => r.official).map((r) => r.weekNumber))].sort((a, b) => a - b);
  const selected = week && weeks.includes(week) ? week : undefined;
  const seasonAwards = computeAwards(m, ctx.league.awards, { commissioner }).filter((a) => a.scope === "season" || a.source === "commissioner");
  const weekAwards = selected ? computeAwards(m, ctx.league.awards, { week: selected }).filter((a) => a.scope === "week" && a.source === "statistical") : [];
  const disabled = AWARD_DEFS.filter((d) => ctx.league.awards[d.id]?.enabled === false);
  return (
    <div className="grid gap-4">
      <Card>
        <CardHead title="Season awards" right={ctx.can("awards.manage") ? <Link className="text-[var(--accent)]" href={`/l/${slug}/admin/settings?section=awards`}>Configure →</Link> : null} />
        {seasonAwards.length === 0 ? <EmptyState title="No awards yet">Season awards need enough finalized games to meet each award's qualification rules.</EmptyState> : (
          <ul className="divide-y divide-line">{seasonAwards.map((a) => (
            <li key={a.id} className="px-3.5 py-3">
              <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">{a.name}</span>{a.source === "commissioner" ? <Badge tone="info">COMMISSIONER AWARD</Badge> : <Badge>STATISTICAL</Badge>}</div>
              {a.winners.map((w) => <div key={w.id + w.detail} className="mt-1 flex items-start gap-2"><span className="text-[15px] font-bold">{w.kind === "bowler" ? <Link className="hover:underline" href={`/l/${slug}/bowlers/${w.id}${sq ? `?season=${sq}` : ""}`}>{w.name}</Link> : w.name}</span><span className="muted text-[13px]">{w.detail}</span></div>)}
              <details className="mt-1"><summary className="faint cursor-pointer text-[11px] hover:text-muted">How this is decided</summary><p className="muted mt-1 text-xs">{a.qualification}</p></details>
            </li>
          ))}</ul>
        )}
      </Card>
      <Card>
        <CardHead title="Weekly awards" />
        <div className="pill-nav px-3 py-2">{weeks.map((w) => <Link key={w} className="tab !px-2.5" href={`/l/${slug}/stats?tab=awards&week=${w}${sq ? `&season=${sq}` : ""}`} aria-current={w === selected ? "page" : undefined}>Wk {w}</Link>)}</div>
        {!selected ? <p className="muted border-t border-line px-3.5 py-3 text-[13px]">Pick a week to see its awards.</p> : (
          <ul className="divide-y divide-line border-t border-line">{weekAwards.map((a) => <li key={a.id} className="px-3.5 py-2.5"><div className="eyebrow">{a.name}</div><div className="text-[14px] font-semibold">{a.winners.map((w) => w.name).join(", ")}</div><div className="muted text-xs">{a.winners[0].detail}</div><details><summary className="faint cursor-pointer text-[11px]">Rule</summary><p className="muted text-xs">{a.qualification}</p></details></li>)}</ul>
        )}
      </Card>
      {disabled.length ? <p className="faint text-xs">Not awarded in this league: {disabled.map((d) => d.name).join(", ")}.</p> : null}
    </div>
  );
}

async function Records({ ctx, q, cat, slug, sq, scope }: { ctx: Awaited<ReturnType<typeof getLeagueCtx>>; q?: string; cat?: string; slug: string; sq: string | null; scope?: string }) {
  const models = scope === "season" || !ctx.cfg.recordsCarryOver ? [ctx.model!] : await allModels(ctx);
  const book = buildRecordBook(models);
  const term = (q ?? "").trim().toLowerCase();
  const filtered = book.filter((r) => (!cat || r.category === cat) && (!term || r.title.toLowerCase().includes(term) || r.history.some((h) => h.holderName.toLowerCase().includes(term))));
  const cats = Object.keys(RECORD_CATEGORY_LABELS) as RecordCategory[];
  return (
    <div className="grid gap-4">
      <form className="flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="tab" value="records" />{sq ? <input type="hidden" name="season" value={sq} /> : null}
        <div className="field"><label htmlFor="q">Search records or holders</label><input id="q" name="q" defaultValue={q ?? ""} className="input !w-56" placeholder="e.g. series, Alex" /></div>
        <div className="field"><label htmlFor="cat">Category</label><select id="cat" name="cat" defaultValue={cat ?? ""} className="select !w-52"><option value="">All categories</option>{cats.map((c) => <option key={c} value={c}>{RECORD_CATEGORY_LABELS[c]}</option>)}</select></div>
        <div className="field"><label htmlFor="scope">Scope</label><select id="scope" name="scope" defaultValue={scope ?? "all"} className="select !w-40" disabled={!ctx.cfg.recordsCarryOver}><option value="all">All seasons</option><option value="season">This season</option></select></div>
        <button className="btn btn-sm mb-0.5" type="submit">Search</button>
      </form>
      {!ctx.cfg.recordsCarryOver ? <Alert tone="info">This league resets records every season, so only this season is shown.</Alert> : null}
      {filtered.length === 0 ? <Card><EmptyState title={book.length ? "No records match" : "No records yet"}>{book.length ? "Try a different search." : "Records are set automatically as results are finalized."}</EmptyState></Card> : cats.filter((c) => filtered.some((r) => r.category === c)).map((c) => (
        <Card key={c}>
          <CardHead title={RECORD_CATEGORY_LABELS[c]} />
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-3">Record</th><th scope="col">Mark</th><th scope="col" className="!text-left">Holder</th><th scope="col" className="!text-left">Achievement</th><th scope="col" className="!text-left">Season</th><th scope="col" className="!text-left">Date</th></tr></thead>
            <tbody>{filtered.filter((r) => r.category === c).map((r) => (
              <Fragment key={r.key}>
                {r.holders.map((h, i) => (
                  <tr key={r.key + h.holderId + h.week}>
                    <td className="!pl-3 l font-semibold">{i === 0 ? <span title={r.definition}>{r.title}</span> : <span className="faint">↳ tied</span>}</td>
                    <td className="score">{h.value}</td>
                    <td className="l"><Link className="hover:underline" href={h.holderKind === "bowler" ? `/l/${slug}/bowlers/${h.holderId}` : `/l/${slug}/teams/${h.holderId}`}>{h.holderName}</Link></td>
                    <td className="l muted">{h.matchupId ? <Link className="hover:underline" href={`/l/${slug}/matchup/${h.matchupId}`}>{h.detail}</Link> : h.detail}</td>
                    <td className="l muted">{h.seasonName}{h.week ? ` · wk ${h.week}` : ""}</td><td className="l muted">{h.date ? formatDate(h.date, { month: "short", day: "numeric", year: "numeric" }) : ""}</td>
                  </tr>
                ))}
                {r.history.some((h) => h.status === "former") ? (
                  <tr key={r.key + "hist"}><td colSpan={6} className="!whitespace-normal !text-left"><details className="px-2"><summary className="faint cursor-pointer text-xs hover:text-muted">Former holders of “{r.title}” ({r.history.filter((h) => h.status === "former").length})</summary><ul className="mt-1 grid gap-0.5 pb-1 text-xs">{r.history.filter((h) => h.status === "former").reverse().map((h, i) => <li key={i} className="muted"><b className="num text-fg">{h.value}</b> · {h.holderName} · {h.seasonName}{h.week ? `, wk ${h.week}` : ""}{h.date ? ` (${formatDate(h.date, { month: "short", day: "numeric", year: "numeric" })})` : ""}</li>)}</ul></details></td></tr>
                ) : null}
              </Fragment>
            ))}</tbody></table></div>
        </Card>
      ))}
      <p className="faint text-xs">Substitutes {ctx.cfg.eligibility.subsCountForRecords ? "are" : "are not"} eligible for individual records. Ties share a record; beaten records stay listed as former holders.</p>
    </div>
  );
}

function Insights({ ctx }: { ctx: Awaited<ReturnType<typeof getLeagueCtx>> }) {
  const ins = generateInsights(ctx.model!);
  return (
    <Card>
      <CardHead title="Statistical insights" />
      {ins.length === 0 ? <EmptyState title="Nothing notable yet">Insights are only generated when the recorded numbers support them — no predictions.</EmptyState> : (
        <ul className="divide-y divide-line">{ins.map((i) => <li key={i.id} className="px-3.5 py-3"><div className="text-[14px] font-medium">{i.text}</div><ul className="muted mt-1 list-disc pl-4 text-xs">{i.support.map((s, k) => <li key={k} className="num">{s}</li>)}</ul></li>)}</ul>
      )}
    </Card>
  );
}

function Trends({ ctx, stats }: { ctx: Awaited<ReturnType<typeof getLeagueCtx>>; stats: ReturnType<typeof bowlerSeasonStats> }) {
  const m = ctx.model!;
  const weeks = [...new Set(m.results.filter((r) => r.official && !r.isBye).map((r) => r.weekNumber))].sort((a, b) => a - b);
  if (!weeks.length) return <Card><EmptyState title="No trends yet" /></Card>;
  const nights = stats.flatMap((s) => s.nightsLog);
  const scoring = weeks.map((w) => { const ns = nights.filter((n) => n.week === w); const games = ns.flatMap((n) => n.games); return { week: w, "League avg": Math.round((games.reduce((t, g) => t + g.scratch, 0) / Math.max(1, games.length)) * 10) / 10 }; });
  const margins = weeks.map((w) => { const rs = m.results.filter((r) => r.official && !r.isBye && !r.forfeitBy && r.weekNumber === w && r.margin != null); return { week: w, "Avg margin": rs.length ? Math.round((rs.reduce((t, r) => t + r.margin!, 0) / rs.length) * 10) / 10 : null }; });
  const top = [...stats].filter((s) => s.progression.length > 1).sort((a, b) => (b.average ?? 0) - (a.average ?? 0)).slice(0, 5);
  const topData = weeks.map((w) => ({ week: w, ...Object.fromEntries(top.map((s) => [s.name, (() => { const p = [...s.progression].filter((x) => x.week <= w).pop(); return p ? Math.round(p.average * 10) / 10 : null; })()])) }));
  const impr = stats.map((s) => improvement(s, { window: 6, minGames: 9 })).filter(Boolean);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHead title="League scoring average by week" /><div className="p-3"><Trend data={scoring} series={[{ key: "League avg", label: "Scratch game average", color: "#38bdf8" }]} summary="League-wide scratch game average for each week." /></div></Card>
      <Card><CardHead title="Average matchup margin by week" /><div className="p-3"><Trend data={margins} series={[{ key: "Avg margin", label: "Series margin (pins)", color: "#f97316" }]} summary="Average series margin of decided matchups each week." /></div></Card>
      <Card className="lg:col-span-2"><CardHead title="Top bowlers: average progression" /><div className="p-3"><Trend data={topData} series={top.map((s, i) => ({ key: s.name, label: s.name, color: PALETTE[i % PALETTE.length] }))} summary="Cumulative scratch average by week for the five highest-average bowlers." height={260} /></div></Card>
      <p className="faint text-xs lg:col-span-2">{impr.length} bowlers have enough games for improvement tracking (latest 6 games vs. baseline, minimum 9 games).</p>
    </div>
  );
}
