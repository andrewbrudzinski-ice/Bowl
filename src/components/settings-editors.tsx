"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { awardsAction, homepageAction } from "@/app/actions/admin";
import type { AwardDef } from "@/domain/awards";
import type { AwardsConfig } from "@/domain/types";

export function HomepageEditor({ slug, modules, labels }: { slug: string; modules: { id: string; enabled: boolean }[]; labels: Record<string, { label: string; description: string }> }) {
  const [list, setList] = useState(modules);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const move = (i: number, d: number) => setList((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  return (
    <div className="grid gap-3">
      <p className="help">Turn modules on or off and reorder them. Wide modules (standings, matchups, results, highlights) span the full row; the rest sit side by side.</p>
      <ol className="grid gap-1.5">
        {list.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-2">
            <label className="check flex-1 items-start"><input type="checkbox" className="mt-0.5" checked={m.enabled} onChange={(e) => setList((l) => l.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)))} /><span><span className="font-semibold">{labels[m.id]?.label ?? m.id}</span><span className="help block">{labels[m.id]?.description}</span></span></label>
            <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${labels[m.id]?.label} up`}><ArrowUp size={14} /></button>
            <button type="button" className="btn btn-ghost btn-sm !px-1.5" onClick={() => move(i, 1)} disabled={i === list.length - 1} aria-label={`Move ${labels[m.id]?.label} down`}><ArrowDown size={14} /></button>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={pending} onClick={() => start(async () => { const r = await homepageAction(slug, list); setMsg(r?.ok ? "Homepage saved." : r?.error ?? "Couldn't save."); router.refresh(); })}>Save homepage</button>{msg ? <span role="status" className="text-xs text-win">{msg}</span> : null}</div>
    </div>
  );
}

export function AwardsEditor({ slug, defs, value }: { slug: string; defs: AwardDef[]; value: AwardsConfig }) {
  const [cfg, setCfg] = useState<AwardsConfig>(value);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="grid gap-3">
      <p className="help">Statistical awards are calculated from recorded scores using the rules below — nobody picks the winner. For judgment calls, add a <b>commissioner award</b> instead; those are always labelled as such.</p>
      {defs.map((d) => {
        const s = cfg[d.id] ?? { enabled: true, params: {} };
        return (
          <fieldset key={d.id} className="rounded-lg border border-line p-3">
            <legend className="px-1.5"><label className="check"><input type="checkbox" checked={s.enabled} onChange={(e) => setCfg((c) => ({ ...c, [d.id]: { ...s, enabled: e.target.checked } }))} /><span className="font-semibold">{d.name}</span><span className="badge">{d.scope === "week" ? "WEEKLY" : "SEASON"}</span></label></legend>
            <p className="muted text-[13px]">{d.description}</p>
            <p className="faint mt-0.5 text-xs">Rule: {d.qualification}</p>
            {d.params.length ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{d.params.map((p) => <div key={p.key} className="field"><label htmlFor={`${d.id}-${p.key}`}>{p.label}</label><input id={`${d.id}-${p.key}`} type="number" className="input" min={p.min} max={p.max} disabled={!s.enabled} value={s.params[p.key] ?? p.default} onChange={(e) => setCfg((c) => ({ ...c, [d.id]: { ...s, params: { ...s.params, [p.key]: Number(e.target.value) } } }))} /></div>)}</div> : null}
          </fieldset>
        );
      })}
      <div className="flex items-center gap-3"><button className="btn btn-primary" disabled={pending} onClick={() => start(async () => { const r = await awardsAction(slug, cfg); setMsg(r?.ok ? "Awards saved." : r?.error ?? "Couldn't save."); router.refresh(); })}>Save awards</button>{msg ? <span role="status" className="text-xs text-win">{msg}</span> : null}</div>
    </div>
  );
}
