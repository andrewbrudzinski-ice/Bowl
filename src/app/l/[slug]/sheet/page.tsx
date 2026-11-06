import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { seasonParam } from "@/components/links";
import { PrintButton } from "@/components/print-button";
import { Card, EmptyState } from "@/components/ui";
import { WeeklySheetView } from "@/components/weekly-sheet";
import { buildWeeklySheet } from "@/domain/sheet";
import { getLeagueCtx } from "@/server/context";
import { currentWeek, formatDate } from "@/server/views";

export const metadata = { title: "Weekly sheet" };

export default async function SheetPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ season?: string; week?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const ctx = await getLeagueCtx(slug, sp.season);
  if (!ctx.model || !ctx.season) return <Card><EmptyState title="No season yet" /></Card>;
  const model = ctx.model;
  const weeks = [...model.data.weeks].sort((a, b) => a.number - b.number);
  if (weeks.length === 0) return <Card><EmptyState title="No weeks yet">The sheet is built from the season's weeks.</EmptyState></Card>;
  const wanted = Number(sp.week);
  const week = Number.isInteger(wanted) && model.weekByNumber.has(wanted) ? wanted : currentWeek(ctx);
  const sheet = buildWeeklySheet(model, week)!;
  const sq = seasonParam(ctx);
  const href = (n: number) => `/l/${slug}/sheet?week=${n}${sq ? `&season=${sq}` : ""}`;
  const prev = weeks.find((w) => w.number === week - 1);
  const next = weeks.find((w) => w.number === week + 1);
  return (
    <div className="grid gap-6">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2" action={`/l/${slug}/sheet`}>
          {sq ? <input type="hidden" name="season" value={sq} /> : null}
          <div className="field">
            <label htmlFor="week">Week</label>
            <select id="week" name="week" className="select !w-52" defaultValue={String(week)}>
              {weeks.map((w) => <option key={w.number} value={w.number}>{w.phase === "playoff" ? `Playoffs · ${formatDate(w.date)}` : `Week ${w.number} · ${formatDate(w.date)}`}</option>)}
            </select>
          </div>
          <button className="btn btn-sm mb-0.5" type="submit">Show</button>
        </form>
        <div className="flex flex-wrap items-center gap-2">
          {prev ? <Link className="btn btn-sm" href={href(prev.number)}><ChevronLeft size={14} aria-hidden />Week {prev.number}</Link> : null}
          {next ? <Link className="btn btn-sm" href={href(next.number)}>Week {next.number}<ChevronRight size={14} aria-hidden /></Link> : null}
          <PrintButton />
        </div>
      </div>
      <p className="no-print muted text-[13px]">The sheet for a night: last week&apos;s results, standings, this week&apos;s matchups with handicaps, and everyone&apos;s average and handicap. It updates itself from finalized scores. Print it, or choose &ldquo;Save as PDF&rdquo; in the print window.</p>
      <WeeklySheetView ctx={ctx} sheet={sheet} seasonQ={sq} />
    </div>
  );
}
