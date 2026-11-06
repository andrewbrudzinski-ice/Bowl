import type { NextRequest } from "next/server";
import { buildWeeklySheet } from "@/domain/sheet";
import { getLeagueCtx } from "@/server/context";
import { renderSheetPdf } from "@/server/sheet-pdf";
import { currentWeek } from "@/server/views";

/**
 * The weekly sheet as a PDF file. A phone saved to the Home Screen can't print (iOS ignores window.print() in a web app), so the page
 * hands this file to the share sheet instead, which can save, print or send it. Obeys the same visibility rules as the sheet page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const q = req.nextUrl.searchParams;
  const ctx = await getLeagueCtx(slug, q.get("season"));
  if (!ctx.model || !ctx.season) return new Response("This league has no season yet.", { status: 404 });
  const wanted = Number(q.get("week"));
  const week = Number.isInteger(wanted) && ctx.model.weekByNumber.has(wanted) ? wanted : currentWeek(ctx);
  const sheet = buildWeeklySheet(ctx.model, week);
  if (!sheet) return new Response("No such week.", { status: 404 });
  const bytes = renderSheetPdf(ctx.model, sheet, { leagueName: ctx.league.name, seasonName: ctx.season.name, logoText: ctx.league.logoText });
  const file = `${slug}-week-${week}-sheet.pdf`.replace(/[^a-z0-9._-]/gi, "-");
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file}"`,
      // League pages can be private: never let a shared cache keep a copy.
      "Cache-Control": "private, no-store",
    },
  });
}
