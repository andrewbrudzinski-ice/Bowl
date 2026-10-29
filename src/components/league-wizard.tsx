"use client";
import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { createLeagueAction } from "@/app/actions/leagues";
import { accentInk } from "@/components/theme";
import { STARTER_TEMPLATES, validateConfig, type RuleConfig } from "@/domain/config";
import { BRAND_ACCENT } from "@/domain/brand";
import { describeRules } from "@/domain/describe";
import { RuleForm } from "./rule-form";

export interface CopyOption {
  id: string;
  name: string;
  config: RuleConfig;
}

const STEPS = ["Basics", "Format", "Games & scoring", "Handicap", "Standings & playoffs", "Review"];
const VIS: [string, string, string][] = [
  ["private", "Private", "Only people you invite can see anything."],
  ["unlisted", "Unlisted", "Anyone with your private link can view standings and results. Not shown in public lists."],
  ["public", "Public", "Standings and results are viewable by anyone. Admin tools and member details always stay private."],
];

export function LeagueWizard({ copyOptions, defaultConfig }: { copyOptions: CopyOption[]; defaultConfig: RuleConfig }) {
  const year = new Date().getFullYear();
  const [step, setStep] = useState(0);
  const [b, setB] = useState({ name: "", description: "", logoText: "", accent: BRAND_ACCENT, visibility: "private", seasonName: `${year} Season`, year, startDate: `${year}-01-06`, regularWeeks: 10, teamNames: "" });
  const [cfg, setCfg] = useState<RuleConfig>(defaultConfig);
  const [templateId, setTemplateId] = useState("traditional-handicap-team");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const check = validateConfig(cfg);
  const teamNames = b.teamNames.split("\n").map((t) => t.trim()).filter(Boolean);
  const basicsOk = b.name.trim().length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(b.startDate) && b.regularWeeks >= 1;
  const canNext = step === 0 ? basicsOk : step >= 1 && step <= 4 ? check.ok : true;
  const up = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) => setB((x) => ({ ...x, [k]: v }));

  const create = () =>
    start(async () => {
      setError(null);
      const res = await createLeagueAction({ name: b.name, description: b.description, logoText: b.logoText, accent: b.accent, visibility: b.visibility as "private", season: { name: b.seasonName, year: b.year, startDate: b.startDate, regularWeeks: b.regularWeeks }, config: cfg, teamNames });
      if (res && !res.ok) setError(res.error ?? "Couldn't create the league.");
    });

  return (
    <div className="grid gap-6 md:gap-8">
      <ol className="pill-nav" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s}><button type="button" className="tab" data-active={i === step} aria-current={i === step ? "step" : undefined} onClick={() => (i <= step || basicsOk) && setStep(i)}>{i < step ? <Check size={13} className="mr-1 text-win" aria-hidden /> : <span className="num muted mr-1.5">{i + 1}</span>}{s}</button></li>
        ))}
      </ol>
      <div className="card p-4 md:p-5">
        {step === 0 ? (
          <div className="grid gap-6 md:gap-8">
            <div><h2 className="text-[17px] font-bold">League basics</h2><p className="muted text-[13px]">You can change all of this later in League settings.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="field sm:col-span-2"><label htmlFor="name">League name</label><input id="name" className="input" value={b.name} onChange={(e) => up("name", e.target.value)} maxLength={60} placeholder="Friday Night Strikers" autoFocus /></div>
              <div className="field sm:col-span-2"><label htmlFor="desc">Description</label><textarea id="desc" className="textarea" value={b.description} onChange={(e) => up("description", e.target.value)} maxLength={300} placeholder="Who you are, where you bowl, what night." /></div>
              <div className="field"><label htmlFor="logo">Logo letters</label><input id="logo" className="input" value={b.logoText} onChange={(e) => up("logoText", e.target.value.toUpperCase().slice(0, 3))} placeholder={b.name.slice(0, 2).toUpperCase() || "FNS"} maxLength={3} /><span className="help">Up to three letters shown in your league's mark.</span></div>
              <div className="field"><label htmlFor="accent">Accent color</label><div className="flex items-center gap-2"><input id="accent" type="color" value={b.accent} onChange={(e) => up("accent", e.target.value)} className="h-9 w-12 cursor-pointer rounded-md border border-line-strong bg-bg p-0.5" /><span className="num muted text-[13px]">{b.accent}</span><span className="inline-flex h-9 flex-1 items-center justify-center rounded-md text-[13px] font-bold" style={{ background: b.accent, color: accentInk(b.accent) }}>Preview</span></div></div>
              <div className="field"><label htmlFor="sn">Season name</label><input id="sn" className="input" value={b.seasonName} onChange={(e) => up("seasonName", e.target.value)} /></div>
              <div className="field"><label htmlFor="yr">Year</label><input id="yr" className="input" type="number" value={b.year} onChange={(e) => up("year", Number(e.target.value))} /></div>
              <div className="field"><label htmlFor="sd">First bowling night</label><input id="sd" className="input" type="date" value={b.startDate} onChange={(e) => up("startDate", e.target.value)} /></div>
              <div className="field"><label htmlFor="wk">Regular-season weeks</label><input id="wk" className="input" type="number" min={1} max={60} value={b.regularWeeks} onChange={(e) => up("regularWeeks", Number(e.target.value))} /><span className="help">Playoff weeks are added after these if you enable playoffs.</span></div>
              <div className="field sm:col-span-2"><label htmlFor="teams">Teams (optional, one per line)</label><textarea id="teams" className="textarea" value={b.teamNames} onChange={(e) => up("teamNames", e.target.value)} placeholder={"Pin Pals\nGutter Gang\nStrike Force"} /><span className="help">{teamNames.length ? `${teamNames.length} team${teamNames.length === 1 ? "" : "s"}. ` : ""}You can add teams and bowlers any time.</span></div>
            </div>
            <fieldset className="grid gap-2"><legend className="label mb-1">Who can see this league?</legend>
              {VIS.map(([v, l, d]) => <label key={v} className="card flex cursor-pointer items-start gap-3 p-3 has-[:checked]:border-[var(--accent)]"><input type="radio" name="vis" value={v} checked={b.visibility === v} onChange={() => up("visibility", v)} className="mt-1 accent-[var(--accent)]" /><span><span className="font-semibold">{l}</span><span className="help block">{d}</span></span></label>)}
            </fieldset>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="grid gap-6 md:gap-8">
            <div><h2 className="text-[17px] font-bold">Competition format</h2><p className="muted text-[13px]">Start from a template, copy another league you manage, or build from scratch. Everything stays editable.</p></div>
            <div className="grid gap-2 sm:grid-cols-2">
              {STARTER_TEMPLATES.map((t) => <button key={t.id} type="button" onClick={() => { setTemplateId(t.id); setCfg(structuredClone(t.config)); }} className={`card card-link p-3 text-left ${templateId === t.id ? "!border-[var(--accent)]" : ""}`} aria-pressed={templateId === t.id}><span className="block text-[14px] font-bold">{t.name}</span><span className="help block">{t.description}</span></button>)}
            </div>
            {copyOptions.length ? <div className="field max-w-md"><label htmlFor="copy">Or copy rules from one of your leagues</label><select id="copy" className="select" value="" onChange={(e) => { const o = copyOptions.find((x) => x.id === e.target.value); if (o) { setCfg(structuredClone(o.config)); setTemplateId(o.id); } }}><option value="">Choose…</option>{copyOptions.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select><span className="help">Copies rules only — never scores, schedules or results.</span></div> : null}
            <RuleForm value={cfg} onChange={setCfg} sections={["format"]} />
          </div>
        ) : null}
        {step === 2 ? <div className="grid gap-6 md:gap-8"><div><h2 className="text-[17px] font-bold">Games & scoring</h2><p className="muted text-[13px]">How many games, what decides them, and how points are awarded.</p></div><RuleForm value={cfg} onChange={setCfg} sections={["scoring"]} /></div> : null}
        {step === 3 ? <div className="grid gap-6 md:gap-8"><div><h2 className="text-[17px] font-bold">Handicap rules</h2><p className="muted text-[13px]">Watch the example change as you adjust the settings.</p></div><RuleForm value={cfg} onChange={setCfg} sections={["handicap"]} /></div> : null}
        {step === 4 ? <div className="grid gap-6 md:gap-8"><div><h2 className="text-[17px] font-bold">Standings & playoffs</h2></div><RuleForm value={cfg} onChange={setCfg} sections={["standings", "playoffs", "eligibility"]} /></div> : null}

        {step === 5 ? (
          <div className="grid gap-6 md:gap-8">
            <div><h2 className="text-[17px] font-bold">Review</h2><p className="muted text-[13px]">Check everything, then create your league. Use the step tabs above to go back and edit any section.</p></div>
            <div className="card p-5"><div className="flex items-center gap-3"><span className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-sm font-black" style={{ background: b.accent, color: accentInk(b.accent) }}>{b.logoText || b.name.slice(0, 2).toUpperCase()}</span><div><div className="text-[16px] font-bold">{b.name}</div><div className="muted text-[13px]">{b.seasonName} · starts {b.startDate} · {b.regularWeeks} weeks · {VIS.find((v) => v[0] === b.visibility)?.[1]} · {teamNames.length} team{teamNames.length === 1 ? "" : "s"} listed</div></div></div></div>
            <div className="grid gap-3 md:grid-cols-2">{describeRules(cfg).map((s) => <div key={s.id} className="card"><div className="card-head"><h3 className="h-section">{s.title}</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => setStep(s.id === "format" ? 1 : s.id === "scoring" || s.id === "situations" ? 2 : s.id === "handicap" ? 3 : 4)}>Edit</button></div><dl className="px-5 py-1">{s.items.map((i) => <div key={i.label} className="border-b border-line py-1.5 last:border-0"><div className="flex justify-between gap-3 text-[13px]"><dt className="muted">{i.label}</dt><dd className="text-right font-medium">{i.value}</dd></div></div>)}</dl></div>)}</div>
            {!check.ok ? <div className="alert alert-error">These rules need fixing before you can create the league: {check.issues.find((i) => i.severity === "error")?.message}</div> : null}
            {error ? <div className="alert alert-error" role="alert">{error}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="flex justify-between">
        <button type="button" className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || pending}>Back</button>
        {step < 5 ? <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)} disabled={!canNext}>Next</button> : <button type="button" className="btn btn-primary" onClick={create} disabled={pending || !check.ok || !basicsOk}>{pending ? "Creating…" : "Create league"}</button>}
      </div>
    </div>
  );
}
