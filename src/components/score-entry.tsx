"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Check, Lock, Save } from "lucide-react";
import { correctAction, finalizeAction, markReadyAction, previewFinalizeAction, reopenAction, saveEntriesAction } from "@/app/actions/scores";
import type { RuleConfig } from "@/domain/config";
import { fmtPts } from "@/domain/math";
import { evaluateMatchup, usesHandicap, type BowlerHandicapInfo } from "@/domain/scoring";
import type { Matchup, ResultState, Score, ScoreKind, Side } from "@/domain/types";
import type { FinalizePreview } from "@/server/services/results";

export interface EntryMatchup {
  id: string;
  revision: number;
  state: ResultState;
  kind: "team" | "individual";
  forfeitBy: Side | null;
  a: { id: string; name: string; color: string };
  b: { id: string; name: string; color: string } | null;
  lineupA: string[];
  lineupB: string[];
  scores: { bowlerId: string; side: Side; game: number; scratch: number | null; kind: ScoreKind }[];
  official: boolean;
  href: string;
  /** Roster bowlers who could be added as a substitute (not bowling elsewhere this week). */
  subs: { id: string; name: string; team: string | null }[];
  bowlersPerTeam: number;
}

export interface EntryData {
  slug: string;
  seasonId: string;
  week: number;
  dateLabel: string;
  cfg: RuleConfig;
  matchups: EntryMatchup[];
  pool: Record<string, BowlerHandicapInfo & { name: string }>;
  canFinalize: boolean;
  canCorrect: boolean;
}

interface Draft {
  lineupA: string[];
  lineupB: string[];
  forfeitBy: Side | null;
  cells: Record<string, string>;
  absent: Record<string, boolean>;
  revision: number;
  dirty: boolean;
}

const key = (b: string, g: number) => `${b}|${g}`;

function initDraft(m: EntryMatchup): Draft {
  const cells: Record<string, string> = {};
  const absent: Record<string, boolean> = {};
  for (const s of m.scores) {
    if (s.kind === "absent") absent[s.bowlerId] = true;
    else if (s.scratch != null) cells[key(s.bowlerId, s.game)] = String(s.scratch);
  }
  return { lineupA: [...m.lineupA], lineupB: [...m.lineupB], forfeitBy: m.forfeitBy, cells, absent, revision: m.revision, dirty: false };
}

function toScores(d: Draft, G: number) {
  const out: { bowlerId: string; side: Side; game: number; scratch: number | null; kind: ScoreKind }[] = [];
  for (const [side, lineup] of [["A", d.lineupA], ["B", d.lineupB]] as const) {
    for (const b of lineup) {
      for (let g = 1; g <= G; g++) {
        if (d.absent[b]) out.push({ bowlerId: b, side, game: g, scratch: null, kind: "absent" });
        else {
          const raw = (d.cells[key(b, g)] ?? "").trim();
          if (raw !== "") out.push({ bowlerId: b, side, game: g, scratch: Number(raw), kind: "bowled" });
        }
      }
    }
  }
  return out;
}

const STATE_LABEL: Record<ResultState, string> = { scheduled: "Not started", in_progress: "In progress", draft: "Draft", ready_for_review: "Ready for review", finalized: "Final", corrected: "Final (corrected)" };

export function ScoreEntry({ data }: { data: EntryData }) {
  const router = useRouter();
  const G = data.cfg.scoring.gamesPerSession;
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(data.matchups.map((m) => [m.id, initDraft(m)])));
  const [messages, setMessages] = useState<Record<string, { tone: "ok" | "error"; text: string; issues?: string[] }>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [modal, setModal] = useState<{ matchupId: string; preview: FinalizePreview } | null>(null);
  const [correcting, setCorrecting] = useState<Record<string, { reason: string; confirm: boolean } | null>>({});
  const formRef = useRef<HTMLDivElement>(null);
  const pendingRev = useRef<Record<string, number>>({});
  const storageKey = `bowl:draft:${data.seasonId}:${data.week}`;

  // Pull in fresh server data, but never clobber a matchup that has unsaved edits.
  useEffect(() => {
    setDrafts((cur) => {
      const next = { ...cur };
      for (const m of data.matchups) if (!cur[m.id]?.dirty) next[m.id] = initDraft(m);
      return next;
    });
  }, [data]);

  // Restore unsaved work from this device (only if the server copy hasn't moved on).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, Draft>;
      let restored = 0;
      setDrafts((cur) => {
        const next = { ...cur };
        for (const m of data.matchups) {
          const s = saved[m.id];
          if (s && s.dirty && s.revision === m.revision && !m.official) { next[m.id] = s; restored++; }
        }
        return next;
      });
      if (restored) setBanner("Restored unsaved changes from this device. Review them and save when ready.");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const dirty = Object.fromEntries(Object.entries(drafts).filter(([, d]) => d.dirty));
      if (Object.keys(dirty).length) localStorage.setItem(storageKey, JSON.stringify(dirty));
      else localStorage.removeItem(storageKey);
    } catch {}
  }, [drafts, storageKey]);

  const anyDirty = Object.values(drafts).some((d) => d.dirty);
  useEffect(() => {
    if (!anyDirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [anyDirty]);

  const patch = useCallback((id: string, fn: (d: Draft) => Draft) => setDrafts((cur) => ({ ...cur, [id]: { ...fn(cur[id]), dirty: true } })), []);

  // ---- keyboard navigation between score cells ----
  const focusCell = (mi: number, row: number, g: number) => {
    const el = formRef.current?.querySelector<HTMLInputElement>(`[data-cell="${mi}:${row}:${g}"]`);
    if (el) { el.focus(); el.select(); return true; }
    return false;
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, mi: number, row: number, g: number) => {
    if (e.key === "Enter" || (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
      e.preventDefault();
      if (!focusCell(mi, row, g + 1) && !focusCell(mi, row + 1, 1)) focusCell(mi + 1, 0, 1);
    } else if (e.key === "ArrowDown") { e.preventDefault(); focusCell(mi, row + 1, g); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(mi, row - 1, g); }
    else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) { e.preventDefault(); if (!focusCell(mi, row, g - 1)) focusCell(mi, row - 1, G); }
  };

  const entryFor = (m: EntryMatchup, submit: "draft" | "ready" = "draft") => {
    const d = drafts[m.id];
    return { matchupId: m.id, expectedRevision: d.revision, lineupA: d.lineupA, lineupB: d.lineupB, scores: toScores(d, G), forfeitBy: d.forfeitBy, submit, idempotencyKey: crypto.randomUUID() };
  };

  const applyResults = (results: NonNullable<Awaited<ReturnType<typeof saveEntriesAction>>["results"]>) => {
    const msgs: typeof messages = {};
    setDrafts((cur) => {
      const next = { ...cur };
      for (const r of results) {
        if (r.ok && r.result) {
          next[r.matchupId] = { ...next[r.matchupId], revision: r.result.revision, dirty: false };
          msgs[r.matchupId] = { tone: "ok", text: `Saved${r.result.issues.some((i) => i.severity === "warning") ? " — with warnings below" : ""}.`, issues: r.result.issues.filter((i) => i.severity === "warning").map((i) => i.message).slice(0, 6) };
        } else msgs[r.matchupId] = { tone: "error", text: r.error ?? "Couldn't save.", issues: r.issues?.filter((i) => i.severity === "error").map((i) => i.message).slice(0, 8) };
      }
      return next;
    });
    setMessages((cur) => ({ ...cur, ...msgs }));
  };

  const saveMany = (ms: EntryMatchup[]) =>
    start(async () => {
      const entries = ms.map((m) => entryFor(m));
      if (!entries.length) { setBanner("Nothing to save — no unsaved changes."); return; }
      const res = await saveEntriesAction(data.slug, entries);
      if (!res.ok || !res.results) { setBanner(res.error ?? "Couldn't save."); return; }
      applyResults(res.results);
      const ok = res.results.filter((r) => r.ok).length;
      const bad = res.results.length - ok;
      setBanner(bad ? `${ok} saved, ${bad} failed — see the matchups marked below. Nothing was overwritten.` : `${ok} matchup${ok === 1 ? "" : "s"} saved as draft.`);
      router.refresh();
    });

  const dirtyMatchups = data.matchups.filter((m) => drafts[m.id]?.dirty && !m.official);

  const startFinalize = (m: EntryMatchup) =>
    start(async () => {
      let savedRev: number | null = null;
      if (drafts[m.id].dirty) {
        const res = await saveEntriesAction(data.slug, [entryFor(m)]);
        if (!res.ok || !res.results) { setBanner(res.error ?? "Couldn't save."); return; }
        applyResults(res.results);
        if (!res.results[0].ok || !res.results[0].result) return;
        savedRev = res.results[0].result.revision;
      }
      pendingRev.current[m.id] = savedRev ?? drafts[m.id].revision;
      const p = await previewFinalizeAction(data.slug, m.id);
      if (!p.ok || !p.preview) { setMessages((c) => ({ ...c, [m.id]: { tone: "error", text: p.error ?? "Couldn't preview." } })); return; }
      if (!p.preview.canFinalize) {
        setMessages((c) => ({ ...c, [m.id]: { tone: "error", text: "This can't be finalized yet:", issues: p.preview!.issues.filter((i) => i.severity === "error").map((i) => i.message).slice(0, 8) } }));
        return;
      }
      setModal({ matchupId: m.id, preview: p.preview });
    });

  const confirmFinalize = () =>
    start(async () => {
      if (!modal) return;
      const m = data.matchups.find((x) => x.id === modal.matchupId)!;
      const rev = pendingRev.current[m.id] ?? drafts[m.id].revision;
      const r = await finalizeAction(data.slug, m.id, rev);
      setModal(null);
      setMessages((c) => ({ ...c, [m.id]: r.ok ? { tone: "ok", text: "Finalized. Standings are updated." } : { tone: "error", text: r.error ?? "Couldn't finalize.", issues: r.issues } }));
      router.refresh();
    });

  const submitCorrection = (m: EntryMatchup) =>
    start(async () => {
      const c = correcting[m.id];
      if (!c) return;
      const e = entryFor(m);
      const r = await correctAction(data.slug, { ...e, reason: c.reason, confirm: c.confirm });
      setMessages((cur) => ({ ...cur, [m.id]: r.ok ? { tone: "ok", text: "Correction saved and recorded in the audit history." } : { tone: "error", text: r.error ?? "Couldn't save the correction.", issues: r.issues } }));
      if (r.ok) setCorrecting((cur) => ({ ...cur, [m.id]: null }));
      router.refresh();
    });

  const doReopen = (m: EntryMatchup) => {
    const reason = window.prompt("Why are you reopening this finalized result? (recorded in the audit history)");
    if (!reason) return;
    start(async () => {
      const r = await reopenAction(data.slug, m.id, reason, true);
      setMessages((cur) => ({ ...cur, [m.id]: r.ok ? { tone: "ok", text: "Reopened as a draft. It no longer counts in official standings until finalized again." } : { tone: "error", text: r.error ?? "Couldn't reopen." } }));
      router.refresh();
    });
  };

  return (
    <div ref={formRef} className="grid gap-6">
      {banner ? <div className="alert alert-info" role="status"><span>{banner}</span><button className="btn btn-ghost btn-sm ml-auto" onClick={() => setBanner(null)} aria-label="Dismiss">×</button></div> : null}
      <div className="card sticky top-[calc(4rem+env(safe-area-inset-top))] z-20 flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 !shadow-[var(--shadow-md)]">
        <div className="text-[13px]"><b>Week {data.week}</b> <span className="muted">· {data.dateLabel} · {G} games · scores are scratch</span>{anyDirty ? <span className="ml-2 badge badge-warn">UNSAVED CHANGES</span> : <span className="ml-2 badge badge-win">ALL SAVED</span>}</div>
        <button className="btn btn-primary btn-sm" disabled={pending || !dirtyMatchups.length} onClick={() => saveMany(dirtyMatchups)}><Save size={14} aria-hidden />Save all drafts{dirtyMatchups.length ? ` (${dirtyMatchups.length})` : ""}</button>
      </div>

      {data.matchups.map((m, mi) => (
        <MatchupEntry key={m.id} m={m} mi={mi} d={drafts[m.id]} data={data} G={G} pending={pending} msg={messages[m.id]}
          correcting={correcting[m.id] ?? null}
          onCorrecting={(v) => setCorrecting((c) => ({ ...c, [m.id]: v }))}
          patch={patch} onKey={onKey} focusCell={focusCell}
          onSave={() => saveMany([m])} onReady={() => start(async () => {
            let rev = drafts[m.id].revision;
            if (drafts[m.id].dirty) {
              const sv = await saveEntriesAction(data.slug, [entryFor(m)]);
              if (sv.results) applyResults(sv.results);
              const first = sv.results?.[0];
              if (!first?.ok || !first.result) return;
              rev = first.result.revision;
            }
            const r = await markReadyAction(data.slug, m.id, rev);
            setMessages((c) => ({ ...c, [m.id]: r.ok ? { tone: "ok", text: "Marked ready for review." } : { tone: "error", text: r.error ?? "Not ready yet.", issues: r.issues } }));
            router.refresh();
          })} onFinalize={() => startFinalize(m)} onCorrect={() => submitCorrection(m)} onReopen={() => doReopen(m)} />
      ))}

      {modal ? <FinalizeDialog modal={modal} data={data} onCancel={() => setModal(null)} onConfirm={confirmFinalize} pending={pending} /> : null}
    </div>
  );
}

function MatchupEntry({ m, mi, d, data, G, pending, msg, correcting, onCorrecting, patch, onKey, focusCell, onSave, onReady, onFinalize, onCorrect, onReopen }: {
  m: EntryMatchup; mi: number; d: Draft; data: EntryData; G: number; pending: boolean;
  msg?: { tone: "ok" | "error"; text: string; issues?: string[] };
  correcting: { reason: string; confirm: boolean } | null;
  onCorrecting: (v: { reason: string; confirm: boolean } | null) => void;
  patch: (id: string, fn: (d: Draft) => Draft) => void;
  onKey: (e: React.KeyboardEvent<HTMLInputElement>, mi: number, row: number, g: number) => void;
  focusCell: (mi: number, row: number, g: number) => boolean;
  onSave: () => void; onReady: () => void; onFinalize: () => void; onCorrect: () => void; onReopen: () => void;
}) {
  const cfg = data.cfg;
  const locked = m.official && !correcting;
  const hdcp = cfg.handicap.enabled;
  const showAdj = usesHandicap(cfg) || hdcp;
  const scores = useMemo(() => toScores(d, G), [d, G]);

  const result = useMemo(() => {
    if (!m.b) return null;
    const mu: Matchup = {
      id: m.id, seasonId: data.seasonId, weekNumber: data.week, kind: m.kind, sideA: m.a.id, sideB: m.b.id, lineupA: d.lineupA, lineupB: d.lineupB,
      state: "draft", forfeitBy: d.forfeitBy, ruleVersion: null, handicapSnapshot: null, playoffRound: null, notes: "", revision: d.revision,
      finalizedAt: null, finalizedBy: null, updatedAt: "", updatedBy: "", isDemo: false,
    };
    const sc: Score[] = scores.map((s, i) => ({ id: String(i), matchupId: m.id, bowlerId: s.bowlerId, side: s.side, game: s.game, scratch: s.scratch, kind: s.kind, updatedAt: "", updatedBy: "" }));
    return evaluateMatchup({ matchup: mu, scores: sc, cfg, handicaps: data.pool });
  }, [m, d, scores, cfg, data.pool, data.seasonId, data.week]);

  const flagFor = (b: string, g: number): { flag?: "error" | "warn" | "missing"; why?: string } => {
    const raw = (d.cells[key(b, g)] ?? "").trim();
    if (d.absent[b]) return {};
    if (raw === "") return d.dirty || m.state !== "scheduled" ? { flag: "missing", why: "Missing score" } : {};
    const n = Number(raw);
    if (!Number.isInteger(n)) return { flag: "error", why: "Whole numbers only" };
    if (n < cfg.scoring.minGameScore || n > cfg.scoring.maxGameScore) return { flag: "error", why: `Must be ${cfg.scoring.minGameScore}–${cfg.scoring.maxGameScore}` };
    const avg = data.pool[b]?.average;
    if (avg != null && Math.abs(n - avg) > cfg.scoring.suspiciousDeviation) return { flag: "warn", why: `${Math.abs(Math.round(n - avg))} pins ${n > avg ? "above" : "below"} average` };
    if (n === 300) return { flag: "warn", why: "Perfect game — confirm" };
    return {};
  };
  const hasError = d.lineupA.concat(d.lineupB).some((b) => Array.from({ length: G }, (_, i) => flagFor(b, i + 1).flag === "error").some(Boolean));

  const setCell = (b: string, g: number, v: string, row: number) => {
    const clean = v.replace(/[^\d]/g, "").slice(0, 3);
    patch(m.id, (x) => ({ ...x, cells: { ...x.cells, [key(b, g)]: clean } }));
    const n = Number(clean);
    // Advance synchronously so fast typing can never spill extra digits into this cell.
    if ((clean.length === 3 || (clean.length === 2 && n > 30)) && g <= G) { if (!focusCell(mi, row, g + 1) && !focusCell(mi, row + 1, 1)) focusCell(mi + 1, 0, 1); }
  };

  const sideRows = (side: Side) => (side === "A" ? d.lineupA : d.lineupB);
  const rowOffset = (side: Side) => (side === "A" ? 0 : d.lineupA.length);
  const addSub = (side: Side, id: string) => patch(m.id, (x) => ({ ...x, [side === "A" ? "lineupA" : "lineupB"]: [...(side === "A" ? x.lineupA : x.lineupB), id] }));
  const removeFromLineup = (side: Side, id: string) => patch(m.id, (x) => ({ ...x, [side === "A" ? "lineupA" : "lineupB"]: (side === "A" ? x.lineupA : x.lineupB).filter((i) => i !== id) }));

  const renderSide = (side: Side) => {
    const info = side === "A" ? m.a : m.b!;
    const sl = result ? (side === "A" ? result.a : result.b) : null;
    return (
      <div className="min-w-0">
        <div className="mb-3 flex items-center gap-2.5 px-1"><span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: info.color }} aria-hidden /><h3 className="truncate text-[15px] font-bold tracking-tight">{info.name}</h3>{d.forfeitBy === side ? <span className="badge badge-loss">FORFEIT</span> : null}</div>
        <ul className="overflow-hidden rounded-2xl border border-line bg-[color-mix(in_srgb,var(--color-raised)_45%,transparent)]" aria-label={`${info.name} scores`}>
          {sideRows(side).map((b, ri) => {
            const row = rowOffset(side) + ri;
            const p = data.pool[b];
            const line = sl?.lineup.find((l) => l.bowlerId === b);
            const isAbs = !!d.absent[b];
            return (
              <li key={b} className="border-b border-line p-4 last:border-b-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold tracking-tight">{p?.name ?? b}{p?.isSub ? <span className="badge ml-2">SUB</span> : null}</div>
                    <div className="faint num mt-0.5 text-[12.5px]">avg {p?.average ?? "—"}{hdcp || showAdj ? <> · hdcp <b className="font-semibold text-muted">{line?.handicap ?? p?.handicap ?? 0}</b></> : null}</div>
                    {!locked ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                        <label className="check !gap-2"><input type="checkbox" checked={isAbs} onChange={(e) => patch(m.id, (x) => ({ ...x, absent: { ...x.absent, [b]: e.target.checked } }))} />Absent</label>
                        {m.kind === "team" && p?.isSub ? <button type="button" className="text-muted underline" onClick={() => removeFromLineup(side, b)}>remove</button> : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="faint text-[11px] font-semibold">Series</div>
                    <div className="score text-[24px] leading-tight">{line && line.gamesScored ? line.scratchSeries : "–"}</div>
                    {showAdj ? <div className="faint num text-[12px]">adj {line && line.gamesScored ? line.adjustedSeries : "–"}</div> : null}
                  </div>
                </div>
                <div className="mt-3.5 grid gap-2.5" style={{ gridTemplateColumns: `repeat(${G}, minmax(0, 1fr))` }}>
                  {Array.from({ length: G }, (_, i) => {
                    const g = i + 1;
                    const f = flagFor(b, g);
                    const gl = line?.games[i];
                    return (
                      <div key={g} className="grid gap-1">
                        <span className="faint text-center text-[11px] font-semibold">G{g}</span>
                        {isAbs ? <div className="num muted flex h-11 items-center justify-center rounded-xl border border-dashed border-line-strong text-[14px]" title="Blind score">{gl?.scratch ?? "—"}<sup>b</sup></div> : (
                          <input className="score-input" inputMode="numeric" pattern="[0-9]*" autoComplete="off" disabled={locked || d.forfeitBy != null} value={d.cells[key(b, g)] ?? ""} data-cell={`${mi}:${row}:${g}`} data-flag={f.flag} title={f.why}
                            aria-label={`${p?.name ?? b}, game ${g}${f.why ? `, ${f.why}` : ""}`} aria-invalid={f.flag === "error"}
                            onChange={(e) => setCell(b, g, e.target.value, row)} onFocus={(e) => e.currentTarget.select()} onKeyDown={(e) => onKey(e, mi, row, g)} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </li>
            );
          })}
          {sl ? (
            <li className="flex items-center justify-between gap-4 bg-raised px-4 py-3.5 text-[13px]">
              <span className="font-semibold">Team</span>
              <span className="num flex flex-wrap items-center justify-end gap-x-4 gap-y-1">
                {sl.games.map((g, i) => <span key={i} className="text-muted">G{i + 1} <b className="font-semibold text-fg">{(result!.basis === "handicap" ? g.adjusted : g.scratch) ?? "–"}</b></span>)}
                <span className="text-muted">Series <b className="text-[15px] font-bold text-fg">{sl.scratchSeries || "–"}</b></span>
                {showAdj ? <span className="text-muted">Adj <b className="font-semibold text-fg">{sl.adjustedSeries || "–"}</b></span> : null}
              </span>
            </li>
          ) : null}
        </ul>
        {!locked && m.kind === "team" && sideRows(side).length < m.bowlersPerTeam + 2 ? (
          <label className="mt-3 flex items-center gap-3 px-1 text-[13px]"><span className="muted">Add a bowler</span>
            <select className="select !h-9 !w-auto !rounded-[10px] text-[13px]" value="" onChange={(e) => e.target.value && addSub(side, e.target.value)} aria-label={`Add a bowler to ${info.name}`}>
              <option value="">Choose…</option>
              {m.subs.filter((s) => ![...d.lineupA, ...d.lineupB].includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}{s.team ? ` (${s.team})` : ""}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    );
  };

  const stateTone = m.official ? "badge-win" : m.state === "ready_for_review" ? "badge-warn" : "";
  const finalNow = m.official;
  return (
    <section className={`card overflow-hidden ${msg?.tone === "error" ? "!border-loss" : ""}`} aria-label={`${m.a.name} versus ${m.b?.name ?? "bye"}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <h2 className="min-w-0 text-[16px] font-bold tracking-tight"><a className="hover:underline" href={m.href}>{m.a.name}{m.b ? <span className="muted font-medium"> vs </span> : null}{m.b?.name}</a></h2>
        <div className="flex items-center gap-2">
          {d.dirty ? <span className="badge badge-warn">UNSAVED</span> : null}
          <span className={`badge ${stateTone}`}>{finalNow ? <Lock size={10} aria-hidden /> : null}{STATE_LABEL[m.state]}</span>
        </div>
      </header>
      {!m.b ? <p className="muted px-5 py-5 text-[14px]">Bye week — nothing to enter.</p> : (
        <>
          <div className="grid gap-7 p-5 lg:grid-cols-2">
            {renderSide("A")}{renderSide("B")}
          </div>
          {result ? (
            <div className="border-t border-line bg-raised px-5 py-4 text-[14px]" aria-live="polite">
              {d.forfeitBy ? <b>{d.forfeitBy === "A" ? m.b.name : m.a.name} wins by forfeit.</b> : result.winner && result.complete ? (
                <span><b>{result.winner === "tie" ? "Matchup tied" : `${result.winner === "A" ? m.a.name : m.b.name} wins`}</b> <span className="num">{fmtPts(result.a.points)}–{fmtPts(result.b!.points)} pts · {result.basis === "handicap" ? "adjusted" : "scratch"} series {result.a.basisSeries}–{result.b!.basisSeries}{result.margin != null ? ` (margin ${result.margin})` : ""}</span> <span className="faint">(preview — not official)</span></span>
              ) : <span className="muted">{result.missing.length ? `${result.missing.length} score${result.missing.length === 1 ? "" : "s"} missing — no result yet.` : "Enter scores to see the result."}</span>}
            </div>
          ) : null}
          {msg ? <div className={`alert m-5 ${msg.tone === "ok" ? "alert-ok" : "alert-error"}`} role={msg.tone === "error" ? "alert" : "status"}><div><div className="font-semibold">{msg.text}</div>{msg.issues?.length ? <ul className="mt-1 list-disc pl-4 text-[13px]">{msg.issues.map((i, k) => <li key={k}>{i}</li>)}</ul> : null}</div></div> : null}
          <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-4">
            {!finalNow || correcting ? (
              <>
                <label className="field !flex-row items-center gap-2"><span className="label">Forfeit</span><select className="select !h-9 !w-auto !rounded-[10px] text-[13px]" disabled={locked} value={d.forfeitBy ?? ""} onChange={(e) => patch(m.id, (x) => ({ ...x, forfeitBy: (e.target.value || null) as Side | null }))}><option value="">None</option><option value="A">{m.a.name} forfeits</option><option value="B">{m.b.name} forfeits</option></select></label>
                {!correcting ? (
                  <>
                    <button className="btn btn-sm" disabled={pending || !d.dirty || hasError} onClick={onSave}><Save size={13} aria-hidden />Save draft</button>
                    <button className="btn btn-sm" disabled={pending || hasError || (!d.dirty && m.state === "scheduled")} onClick={onReady}>Mark ready</button>
                    {data.canFinalize ? <button className="btn btn-primary btn-sm" disabled={pending || hasError || (!!result && !result.complete && !d.forfeitBy)} onClick={onFinalize}><Check size={13} aria-hidden />Preview & finalize</button> : null}
                  </>
                ) : null}
                {hasError ? <span className="inline-flex items-center gap-1 text-[13px] text-loss"><AlertTriangle size={13} aria-hidden />Fix the red scores to continue</span> : null}
              </>
            ) : (
              <>
                <span className="muted text-[13px]">Finalized results are protected from accidental edits.</span>
                {data.canCorrect ? <button className="btn btn-sm ml-auto" onClick={() => onCorrecting({ reason: "", confirm: false })}>Correct result…</button> : null}
                {data.canCorrect ? <button className="btn btn-danger btn-sm" onClick={onReopen} disabled={pending}>Reopen</button> : null}
              </>
            )}
          </footer>
          {correcting ? (
            <div className="grid gap-3 border-t border-line bg-[color-mix(in_srgb,var(--color-warn)_6%,transparent)] p-5">
              <p className="text-[13px]"><b>Correcting a finalized result.</b> Edit the scores above, then explain the change. The old and new values are written to the audit history, and standings recalculate.</p>
              <div className="field"><label htmlFor={`reason-${m.id}`}>Reason for the correction</label><input id={`reason-${m.id}`} className="input" value={correcting.reason} onChange={(e) => onCorrecting({ ...correcting, reason: e.target.value })} placeholder="e.g. Misread game 2 on the scoresheet" /></div>
              <label className="check"><input type="checkbox" checked={correcting.confirm} onChange={(e) => onCorrecting({ ...correcting, confirm: e.target.checked })} />I understand this changes an official result.</label>
              <div className="flex gap-2"><button className="btn btn-primary btn-sm" disabled={pending || !correcting.confirm || correcting.reason.trim().length < 3 || hasError} onClick={onCorrect}>Save correction</button><button className="btn btn-sm" onClick={() => onCorrecting(null)}>Cancel</button></div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function FinalizeDialog({ modal, data, onCancel, onConfirm, pending }: { modal: { matchupId: string; preview: FinalizePreview }; data: EntryData; onCancel: () => void; onConfirm: () => void; pending: boolean }) {
  const m = data.matchups.find((x) => x.id === modal.matchupId)!;
  const p = modal.preview;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); const h = (e: KeyboardEvent) => e.key === "Escape" && onCancel(); document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, [onCancel]);
  const before = new Map(p.standingsBefore.map((r) => [r.id, r]));
  const moves = p.standingsAfter.map((r) => ({ r, b: before.get(r.id) })).filter((x) => !x.b || x.b.rank !== x.r.rank || x.b.points !== x.r.points);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-labelledby="fin-title">
      <button className="absolute inset-0 bg-[var(--overlay)]" onClick={onCancel} aria-label="Close" tabIndex={-1} />
      <div className="card relative max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-6 !shadow-[var(--shadow-lg)] sm:rounded-b-[20px]">
        <h2 id="fin-title" className="text-[18px] font-extrabold tracking-tight">Finalize {m.a.name} vs {m.b?.name}?</h2>
        <p className="muted mt-1 text-[13px]">Result: <b className="text-fg">{p.summary.winner === "tie" ? "Tie" : p.summary.winner === "A" ? m.a.name : m.b?.name} {fmtPts(p.summary.a)}–{fmtPts(p.summary.b)}</b>. Handicaps and the rule version are locked in when you finalize.</p>
        <div className="mt-3">
          <div className="eyebrow mb-1">Impact on standings</div>
          {moves.length === 0 ? <p className="muted text-[13px]">No change in rank or points.</p> : (
            <table className="tbl"><thead><tr><th scope="col">Team</th><th scope="col">Rank</th><th scope="col">Points</th></tr></thead><tbody>{moves.map(({ r, b }) => <tr key={r.id}><td>{r.name}</td><td className="num">{b ? `${b.rank} → ` : ""}<b>{r.rank}</b></td><td className="num">{b ? `${fmtPts(b.points)} → ` : ""}<b>{fmtPts(r.points)}</b></td></tr>)}</tbody></table>
          )}
        </div>
        {p.issues.some((i) => i.severity === "warning") ? <ul className="alert alert-warn mt-3 list-disc pl-6 text-[13px]">{p.issues.filter((i) => i.severity === "warning").map((i, k) => <li key={k}>{i.message}</li>)}</ul> : null}
        <div className="mt-6 flex justify-end gap-3"><button className="btn" onClick={onCancel}>Not yet</button><button ref={ref} className="btn btn-primary" onClick={onConfirm} disabled={pending}>Finalize result</button></div>
      </div>
    </div>
  );
}
