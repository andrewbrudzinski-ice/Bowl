"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { commitImportAction, previewImportAction } from "@/app/actions/admin";
import type { ImportKind, ImportReport } from "@/server/services/data";

const LABELS: Record<ImportKind, string> = { bowlers: "Bowlers", teams: "Teams", rosters: "Season rosters", schedule: "Weekly schedule", scores: "Game scores / historical results" };

export function ImportWizard({ slug, seasons, info }: { slug: string; seasons: { id: string; name: string }[]; info: Record<ImportKind, { description: string; needsSeason: boolean }> }) {
  const router = useRouter();
  const [kind, setKind] = useState<ImportKind>("bowlers");
  const [seasonId, setSeasonId] = useState(seasons[0]?.id ?? "");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [finalize, setFinalize] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [commitErrors, setCommitErrors] = useState<{ line: number; message: string }[] | null>(null);
  const [pending, start] = useTransition();
  const needsSeason = info[kind].needsSeason;
  const reset = () => { setReport(null); setError(null); setDone(null); setConfirm(false); setCommitErrors(null); };

  const check = () => start(async () => {
    reset();
    const r = await previewImportAction(slug, needsSeason ? seasonId : null, kind, text, kind === "scores" && finalize);
    if (!r.ok || !r.report) setError(r.error ?? "Couldn't read that file."); else setReport(r.report);
  });
  const commit = () => start(async () => {
    const r = await commitImportAction(slug, needsSeason ? seasonId : null, kind, text, kind === "scores" && finalize);
    if (r.ok && r.report) { setDone(`Imported: ${r.report.willCreate} created, ${r.report.willSkip} skipped as duplicates.`); setReport(null); setText(""); setFileName(""); router.refresh(); }
    else { setError(r.error ?? "Import failed. Nothing was written."); setCommitErrors(r.errors ?? null); }
  });

  return (
    <div className="grid gap-6 md:gap-8">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field"><label htmlFor="ik">What are you importing?</label><select id="ik" className="select" value={kind} onChange={(e) => { setKind(e.target.value as ImportKind); reset(); }}>{(Object.keys(LABELS) as ImportKind[]).map((k) => <option key={k} value={k}>{LABELS[k]}</option>)}</select><span className="help">{info[kind].description}</span></div>
        {needsSeason ? <div className="field"><label htmlFor="is">Season</label><select id="is" className="select" value={seasonId} onChange={(e) => { setSeasonId(e.target.value); reset(); }}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div> : null}
      </div>
      <p className="text-[13px]"><a className="underline" href={`/l/${slug}/export/template-${kind}`}>Download the {LABELS[kind].toLowerCase()} CSV template</a></p>
      <div className="field"><label htmlFor="if">CSV file</label><input id="if" type="file" accept=".csv,text/csv" className="input !h-auto py-1.5" onChange={async (e) => { const f = e.target.files?.[0]; reset(); if (f) { if (f.size > 4_000_000) { setError("That file is over 4 MB."); return; } setFileName(f.name); setText(await f.text()); } }} /></div>
      <details><summary className="muted cursor-pointer text-[13px] hover:text-fg">…or paste CSV text</summary><textarea className="textarea mt-2 font-mono text-[13px]" rows={6} value={text} onChange={(e) => { setText(e.target.value); reset(); }} aria-label="CSV text" /></details>
      {kind === "scores" ? <label className="check items-start"><input type="checkbox" className="mt-0.5" checked={finalize} onChange={(e) => { setFinalize(e.target.checked); reset(); }} /><span><b>Finalize imported results</b><span className="help block">For historical results. Every matchup must be complete; handicaps and the rule version are locked in. Otherwise scores arrive as drafts.</span></span></label> : null}
      <div><button className="btn btn-primary" disabled={pending || !text.trim() || (needsSeason && !seasonId)} onClick={check}>{pending && !report ? "Checking…" : `Check ${fileName || "file"}`}</button></div>

      {error ? <div className="alert alert-error" role="alert"><div><div className="font-semibold">{error}</div>{commitErrors?.length ? <ul className="mt-1 list-disc pl-4 text-[13px]">{commitErrors.slice(0, 20).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul> : null}</div></div> : null}
      {done ? <div className="alert alert-ok" role="status">{done}</div> : null}

      {report ? (
        <section className="card" aria-label="Import preview">
          <header className="card-head"><h3 className="h-section">Preview — nothing has been written</h3></header>
          <div className="grid gap-3 p-5">
            <p className="text-[13px]"><b>{report.rows}</b> rows · <b className="text-win">{report.willCreate}</b> will be created · <b>{report.willSkip}</b> duplicates skipped · <b className={report.errors.length ? "text-loss" : ""}>{report.errors.length}</b> errors · {report.warnings.length} warnings</p>
            {report.errors.length ? <div><div className="eyebrow mb-1 text-loss">Errors — fix these and check again</div><ul className="alert alert-error grid list-disc gap-0.5 pl-6 text-[13px]">{report.errors.slice(0, 50).map((e, i) => <li key={i}><b>Line {e.line}:</b> {e.message}</li>)}</ul>{report.errors.length > 50 ? <p className="faint text-[13px]">…and {report.errors.length - 50} more.</p> : null}</div> : null}
            {report.duplicates.length ? <div><div className="eyebrow mb-1">Possible duplicates (skipped)</div><ul className="muted list-disc pl-6 text-[13px]">{report.duplicates.slice(0, 15).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul></div> : null}
            {report.warnings.length ? <ul className="alert alert-warn list-disc pl-6 text-[13px]">{report.warnings.slice(0, 15).map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}</ul> : null}
            {report.preview.length ? <div className="tbl-wrap"><table className="tbl"><thead><tr>{Object.keys(report.preview[0]).map((h) => <th key={h} scope="col" className="!text-left">{h}</th>)}</tr></thead><tbody>{report.preview.map((r, i) => <tr key={i}>{Object.values(r).map((v, j) => <td key={j} className="l">{v}</td>)}</tr>)}</tbody></table></div> : null}
            {report.ok ? (
              <div className="grid gap-2 border-t border-line pt-3">
                <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I've reviewed this preview and want to write the data. It's all-or-nothing: if anything fails, nothing is imported.</label>
                <div><button className="btn btn-primary" disabled={!confirm || pending} onClick={commit}>{pending ? "Importing…" : "Import now"}</button></div>
              </div>
            ) : <p className="muted text-[13px]">Fix the errors above to continue. No rows were imported.</p>}
          </div>
        </section>
      ) : null}
    </div>
  );
}
