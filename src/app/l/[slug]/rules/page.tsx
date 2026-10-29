import { describeRules } from "@/domain/describe";
import { diffConfig } from "@/domain/rulechange";
import { Alert, Card, CardHead, KV, PageHeader } from "@/components/ui";
import { getLeagueCtx } from "@/server/context";
import { formatDate } from "@/server/views";
import Link from "next/link";

export const metadata = { title: "League rules" };

export default async function Rules({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; v?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.season) return <Card><div className="p-6 text-center muted">No season yet.</div></Card>;
  const versions = [...ctx.season.ruleVersions].sort((a, b) => a.version - b.version);
  const chosen = versions.find((v) => String(v.version) === sp.v) ?? versions[versions.length - 1];
  const sections = describeRules(chosen.config);
  return (
    <div>
      <PageHeader title="League rules" eyebrow={`${ctx.season.name} · version ${chosen.version}`} sub="Generated from the settings saved for this season, so it always matches how results are calculated." actions={ctx.can("settings.rules") ? <Link href={`/l/${slug}/admin/settings?section=rules`} className="btn btn-sm">Edit rules</Link> : undefined} />
      {versions.length > 1 ? (
        <Alert tone="info" title="This season's rules changed along the way">
          {versions.map((v) => <span key={v.version} className="mr-3 inline-block"><Link className={v.version === chosen.version ? "font-bold underline" : "underline"} href={`/l/${slug}/rules?v=${v.version}${sp.season ? `&season=${sp.season}` : ""}`}>v{v.version}</Link> <span className="muted">from week {v.effectiveFromWeek}</span></span>)}
        </Alert>
      ) : null}
      <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:gap-8">
        {sections.map((s) => (
          <Card key={s.id}>
            <CardHead title={s.title} />
            <dl className="px-5 py-1">{s.items.map((i) => <div key={i.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-baseline gap-x-4 border-b border-line py-3 last:border-0"><dt className="muted text-[14px]">{i.label}</dt><dd className="text-right text-[14px] font-medium">{i.value}{i.note ? <span className="faint mt-0.5 block text-[13px] font-normal">{i.note}</span> : null}</dd></div>)}</dl>
          </Card>
        ))}
      </div>
      <Card className="mt-4">
        <CardHead title="Rule history" />
        <ul className="divide-y divide-line">{[...versions].reverse().map((v, i, arr) => {
          const prev = arr[i + 1];
          const diffs = prev ? diffConfig(prev.config, v.config) : [];
          return (
            <li key={v.version} className="px-5 py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><b>Version {v.version} <span className="muted font-normal">· effective week {v.effectiveFromWeek}</span></b><span className="faint text-[13px]">{formatDate(v.createdAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" })}</span></div>
              <p className="muted">{v.reason}</p>
              {diffs.length ? <details className="mt-1"><summary className="faint cursor-pointer text-[13px]">{diffs.length} setting{diffs.length === 1 ? "" : "s"} changed from v{prev.version}</summary><ul className="mt-1 grid gap-0.5 text-[13px]">{diffs.map((d) => <li key={d.path} className="num"><code>{d.path}</code>: {JSON.stringify(d.before)} → <b>{JSON.stringify(d.after)}</b></li>)}</ul></details> : null}
            </li>
          );
        })}</ul>
        <p className="faint border-t border-line px-5 py-2 text-[12px]">Finalized results keep the rule version they were played under, even if rules change later.</p>
      </Card>
      <div className="hidden"><KV k="">{""}</KV></div>
    </div>
  );
}
