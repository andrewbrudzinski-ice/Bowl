"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { applyRulesAction, previewRulesAction, saveTemplateAction } from "@/app/actions/admin";
import { STARTER_TEMPLATES, type RuleConfig } from "@/domain/config";
import { fmtPts } from "@/domain/math";
import type { ChangeScope, RulePreview } from "@/domain/rulechange";
import { RuleForm } from "./rule-form";

type ScopeKind = "from_week" | "historical" | "new_season";

export function RulesEditor({ slug, seasonId, seasonName, current, leagueDefault, hasScores, eligibleWeek, totalWeeks, names, canApplyHistorical }: {
  slug: string; seasonId: string; seasonName: string; current: RuleConfig; leagueDefault: RuleConfig; hasScores: boolean; eligibleWeek: number; totalWeeks: number; names: Record<string, string>; canApplyHistorical: boolean;
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<RuleConfig>(current);
  const [scopeKind, setScopeKind] = useState<ScopeKind>("from_week");
  const [week, setWeek] = useState(Math.min(eligibleWeek, totalWeeks));
  const [reason, setReason] = useState("");
  const [strong, setStrong] = useState("");
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<"scoring" | "handicap" | "standings" | "format">("scoring");
  const scope: ChangeScope = scopeKind === "from_week" ? { type: "from_week", week } : scopeKind === "historical" ? { type: "historical" } : { type: "new_season" };
  const changed = JSON.stringify(cfg) !== JSON.stringify(current);

  const doPreview = () => start(async () => {
    setMsg(null);
    const r = await previewRulesAction(slug, seasonId, cfg, scope);
    if (!r.ok || !r.preview) { setPreview(null); setMsg({ tone: "error", text: r.error ?? "Couldn't preview." }); return; }
    setPreview(r.preview);
  });
  const apply = () => start(async () => {
    const r = await applyRulesAction(slug, seasonId, cfg, scope, reason, strong);
    if (r?.ok) { setMsg({ tone: "ok", text: r.message ?? "Saved." }); setPreview(null); setReason(""); setStrong(""); router.refresh(); }
    else setMsg({ tone: "error", text: r?.error ?? "Couldn't apply." });
  });
  const bump = (fn: () => void) => { fn(); setPreview(null); };
  const standingChanges = preview ? preview.standingsAfter.map((a) => ({ a, b: preview.standingsBefore.find((x) => x.id === a.id) })).filter((x) => x.b && (x.b.rank !== x.a.rank || x.b.points !== x.a.points)) : [];

  return (
    <div className="grid gap-6 md:gap-8">
      <div className="card p-5">
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <fieldset className="grid gap-2"><legend className="label mb-1">When should the change take effect?</legend>
            <label className="check items-start"><input type="radio" name="scope" checked={scopeKind === "from_week"} onChange={() => bump(() => setScopeKind("from_week"))} className="mt-0.5" /><span><b>Starting with a future week</b> <span className="muted">— finalized weeks are untouched</span>{scopeKind === "from_week" ? <span className="ml-2 inline-flex items-center gap-1"><label htmlFor="ef" className="sr-only">Week</label><select id="ef" className="select !h-7 !w-24 text-[13px]" value={week} onChange={(e) => bump(() => setWeek(Number(e.target.value)))}>{Array.from({ length: Math.max(0, totalWeeks - eligibleWeek + 1) }, (_, i) => eligibleWeek + i).map((w) => <option key={w} value={w}>Week {w}</option>)}</select></span> : null}</span></label>
            <label className="check items-start"><input type="radio" name="scope" checked={scopeKind === "new_season"} onChange={() => bump(() => setScopeKind("new_season"))} className="mt-0.5" /><span><b>Default for new seasons only</b> <span className="muted">— {seasonName} and past seasons keep their rules</span></span></label>
            {canApplyHistorical ? <label className="check items-start"><input type="radio" name="scope" checked={scopeKind === "historical"} onChange={() => bump(() => setScopeKind("historical"))} className="mt-0.5" /><span><b>Correct history</b> <span className="muted">— recalculates finalized results for this season (explicit correction, needs stronger confirmation)</span></span></label> : null}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="button" onClick={() => { setCfg(current); setPreview(null); }} disabled={!changed}>Discard edits</button>
            <button className="btn btn-primary" type="button" onClick={doPreview} disabled={pending || (!changed && scopeKind !== "new_season") || (scopeKind === "new_season" && JSON.stringify(cfg) === JSON.stringify(leagueDefault))}>Preview changes</button>
          </div>
        </div>
        {scopeKind === "from_week" && eligibleWeek > totalWeeks ? <p className="alert alert-warn mt-3">Every week already has finalized results, so a forward-looking change has nothing left to apply to this season. Use “new seasons”, or correct history.</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="label">Start from</span>
        <select className="select !w-auto" value="" onChange={(e) => { const t = STARTER_TEMPLATES.find((x) => x.id === e.target.value); if (t) bump(() => setCfg({ ...structuredClone(t.config), format: current.format, bowlersPerTeam: current.bowlersPerTeam, scoring: { ...structuredClone(t.config.scoring), gamesPerSession: current.scoring.gamesPerSession } })); }} aria-label="Apply a starter template">
          <option value="">Template…</option>{STARTER_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <button className="btn btn-sm" type="button" onClick={() => bump(() => setCfg(structuredClone(leagueDefault)))}>Use league default</button>
        <button className="btn btn-sm" type="button" onClick={() => { const n = window.prompt("Template name"); if (n) start(async () => { const r = await saveTemplateAction(slug, cfg, n); setMsg(r?.ok ? { tone: "ok", text: "Template saved." } : { tone: "error", text: r?.error ?? "Couldn't save." }); }); }}>Save as template</button>
      </div>

      <nav className="pill-nav" aria-label="Rule sections">{([["format", "Format"], ["scoring", "Games & scoring"], ["handicap", "Handicap"], ["standings", "Standings & playoffs"]] as const).map(([k, l]) => <button key={k} type="button" className="tab" data-active={tab === k} onClick={() => setTab(k)}>{l}</button>)}</nav>
      <RuleForm value={cfg} onChange={(c) => bump(() => setCfg(c))} lockStructural={hasScores && scopeKind !== "new_season"} sections={tab === "format" ? ["format"] : tab === "scoring" ? ["scoring"] : tab === "handicap" ? ["handicap"] : ["standings", "playoffs", "eligibility"]} />

      {msg ? <div className={`alert ${msg.tone === "ok" ? "alert-ok" : "alert-error"}`} role={msg.tone === "error" ? "alert" : "status"}>{msg.text}</div> : null}

      {preview ? (
        <section className="card" aria-label="Preview of the rule change">
          <header className="card-head"><h2 className="h-section">Preview — nothing is saved yet</h2></header>
          <div className="grid gap-4 p-5">
            {preview.blockers.length ? <ul className="alert alert-error list-disc pl-6">{preview.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
            {preview.warnings.length ? <ul className="alert alert-warn list-disc pl-6">{preview.warnings.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
            <div>
              <div className="eyebrow mb-1">What changes ({preview.diffs.length})</div>
              {preview.diffs.length === 0 ? <p className="muted text-[13px]">No settings differ from the current rules.</p> : <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-2">Setting</th><th scope="col">Existing</th><th scope="col">Proposed</th></tr></thead><tbody>{preview.diffs.map((d) => <tr key={d.path}><td className="!pl-2 l"><code className="text-[13px]">{d.path}</code></td><td className="num muted">{JSON.stringify(d.before)}</td><td className="num"><b>{JSON.stringify(d.after)}</b></td></tr>)}</tbody></table></div>}
            </div>
            {scopeKind !== "new_season" ? (
              <>
                <p className="text-[13px]"><b>Applies to:</b> {scopeKind === "historical" ? "every week of this season, including finalized results" : `weeks ${preview.affectedWeeks[0] ?? "—"}–${preview.affectedWeeks[preview.affectedWeeks.length - 1] ?? "—"} (${preview.affectedWeeks.length} week${preview.affectedWeeks.length === 1 ? "" : "s"})`}. <b>Finalized results changed:</b> {preview.finalizedAffected.length}{preview.reversedCount ? <span className="text-loss"> — {preview.reversedCount} would flip winner</span> : ""}.</p>
                {preview.finalizedAffected.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-2">Week</th><th scope="col" className="!text-left">Before</th><th scope="col" className="!text-left">After</th></tr></thead><tbody>{preview.finalizedAffected.slice(0, 12).map((c) => <tr key={c.matchupId}><td className="!pl-2">{c.week}</td><td className="l num">{c.before.winner ?? "—"} · {fmtPts(c.before.a)}–{fmtPts(c.before.b)}</td><td className="l num">{c.reversed ? <b className="text-loss">{c.after.winner ?? "—"}</b> : c.after.winner ?? "—"} · {fmtPts(c.after.a)}–{fmtPts(c.after.b)}{c.reversed ? " ← reversed" : ""}</td></tr>)}</tbody></table></div> : null}
                {preview.handicapChanges.length ? <div><div className="eyebrow mb-1">Handicaps in week {preview.handicapChanges[0].week} ({preview.handicapChanges.length} change)</div><div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-2">Bowler</th><th scope="col">Before</th><th scope="col">After</th></tr></thead><tbody>{preview.handicapChanges.slice(0, 12).map((h) => <tr key={h.bowlerId}><td className="!pl-2">{names[h.bowlerId] ?? h.bowlerId}</td><td className="num muted">{h.before}</td><td className="num"><b>{h.after}</b></td></tr>)}</tbody></table></div>{preview.handicapChanges.length > 12 ? <p className="faint text-[13px]">…and {preview.handicapChanges.length - 12} more.</p> : null}</div> : null}
                {standingsChanges(standingChanges)}
                {preview.playoffQualifiersChanged ? <p className="alert alert-warn">This would change who qualifies for the playoffs.</p> : null}
              </>
            ) : <p className="text-[13px]">Only the league's default for <b>future</b> seasons changes. {seasonName} and all past seasons keep their rules and results exactly as they are.</p>}

            <div className="grid gap-3 border-t border-line pt-3">
              <div className="field"><label htmlFor="why">Why are you changing the rules? (recorded in the audit log)</label><input id="why" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. League vote on Jan 10" /></div>
              {preview.requiresStrongConfirmation ? <div className="field"><label htmlFor="strong">This can change official results or playoff qualification. Type <b>CHANGE RESULTS</b> to confirm.</label><input id="strong" className="input" value={strong} onChange={(e) => setStrong(e.target.value)} autoComplete="off" /></div> : null}
              <div className="flex gap-2"><button className="btn btn-primary" type="button" disabled={pending || !preview.ok || reason.trim().length < 3 || (preview.requiresStrongConfirmation && strong !== "CHANGE RESULTS")} onClick={apply}>Apply changes</button><button className="btn" type="button" onClick={() => setPreview(null)}>Cancel</button></div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );

  function standingsChanges(rows: { a: { id: string; name: string; rank: number; points: number }; b?: { rank: number; points: number } }[]) {
    if (!rows.length) return <p className="muted text-[13px]">Standings would not change.</p>;
    return <div><div className="eyebrow mb-1">Standings impact</div><div className="tbl-wrap"><table className="tbl"><thead><tr><th scope="col" className="!pl-2">Team</th><th scope="col">Rank</th><th scope="col">Points</th></tr></thead><tbody>{rows.map(({ a, b }) => <tr key={a.id}><td className="!pl-2">{a.name}</td><td className="num">{b!.rank} → <b>{a.rank}</b></td><td className="num">{fmtPts(b!.points)} → <b>{fmtPts(a.points)}</b></td></tr>)}</tbody></table></div></div>;
  }
}
