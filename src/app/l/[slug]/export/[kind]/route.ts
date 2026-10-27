import { NextResponse, type NextRequest } from "next/server";
import { AppError } from "@/server/errors";
import { getStore } from "@/server/db";
import { leagueBySlug } from "@/server/access";
import { getActor } from "@/server/session";
import { exportBundle, exportCsv, IMPORT_KINDS, templateCsv, type ExportKind, type ImportKind } from "@/server/services/data";
import { log } from "@/server/log";

/** CSV / JSON exports and import templates. Authorization is enforced inside the services (data.export). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  const { slug, kind } = await params;
  const store = getStore();
  const actor = await getActor();
  if (!actor) return new NextResponse("Sign in required", { status: 401 });
  const league = await store.read((db) => leagueBySlug(db, slug));
  if (!league) return new NextResponse("Not found", { status: 404 });
  const seasonId = req.nextUrl.searchParams.get("season");
  try {
    if (kind.startsWith("template-")) {
      const k = kind.slice(9) as ImportKind;
      if (!IMPORT_KINDS.includes(k)) return new NextResponse("Unknown template", { status: 404 });
      return new NextResponse(templateCsv(k), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${k}-template.csv"` } });
    }
    if (kind === "bundle") {
      const bundle = await exportBundle(store, actor, league.id);
      return new NextResponse(JSON.stringify(bundle, null, 1), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${slug}-full-export.json"` } });
    }
    const { filename, csv } = await exportCsv(store, actor, league.id, seasonId, kind as ExportKind);
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError) return new NextResponse(e.message, { status: e.code === "unauthenticated" ? 401 : e.code === "not_found" ? 404 : e.code === "forbidden" ? 403 : 400 });
    log("error", "export_failed", { error: e });
    return new NextResponse("Export failed", { status: 500 });
  }
}
