import { NextResponse } from "next/server";
import { getStore } from "@/server/db";
import { log } from "@/server/log";

export const dynamic = "force-dynamic";

/**
 * Liveness + database check for load balancers and uptime monitors. Opens the store (so an un-migrated or unreachable
 * database fails here) but reads no rows, and never reveals why it failed — details go to the server log.
 */
export async function GET() {
  try {
    await getStore().read((db) => db.users.length, { userIds: [] });
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    log("error", "health_check_failed", { error: e instanceof Error ? e.message : String(e) });
    return NextResponse.json({ ok: false }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
