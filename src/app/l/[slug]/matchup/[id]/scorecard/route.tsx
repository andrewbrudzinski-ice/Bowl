import { ImageResponse } from "next/og";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { buildSeasonModel } from "@/domain/engine";
import { fmtPts } from "@/domain/math";
import { leagueBySlug, resolveAccess, seasonData } from "@/server/access";
import { getStore } from "@/server/db";
import { LINK_COOKIE_PREFIX, getActor } from "@/server/session";
import { resultStatus } from "@/server/views";

/** Downloadable PNG scorecard for a group chat. Obeys the same visibility rules as the page itself. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const actor = await getActor();
  const jar = await cookies();
  const store = getStore();
  const found = await store.read((db) => {
    const league = leagueBySlug(db, slug);
    if (!league) return null;
    const access = resolveAccess(db, league, actor, jar.get(LINK_COOKIE_PREFIX + slug)?.value);
    if (!access.via) return null;
    const m = db.matchups.find((x) => x.id === id);
    const season = m ? db.seasons.find((s) => s.id === m.seasonId && s.leagueId === league.id) : null;
    if (!m || !season) return null;
    return { league, model: buildSeasonModel(seasonData(db, league.id, season.id)) };
  });
  if (!found) return new Response("Not found", { status: 404 });
  const { league, model } = found;
  const r = model.resultById.get(id)!;
  if (!r.b) return new Response("No scorecard for a bye", { status: 404 });
  const kind = r.matchup.kind;
  const nm = (pid: string) => (kind === "team" ? model.teamById.get(pid)?.name : model.bowlerById.get(pid)?.name) ?? "?";
  const status = resultStatus(r);
  const hdcp = r.basis === "handicap";
  const sides = [r.a, r.b];
  const W = 1080;
  const rowH = 150;
  const H = 330 + rowH * 2;
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: "#0a0d12", color: "#e8ebf1", padding: 40, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ width: 52, height: 52, borderRadius: 12, background: league.accent, color: "#04141c", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900 }}>{league.logoText}</div>
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 16 }}>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{league.name}</div>
              <div style={{ fontSize: 20, color: "#8f9aae" }}>{model.data.season.name} · Week {r.weekNumber}</div>
            </div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, padding: "8px 16px", border: "2px solid #4ade80", borderRadius: 10, color: status.final ? "#4ade80" : "#fbbf24" }}>{status.final ? "FINAL" : "UNOFFICIAL"}</div>
        </div>
        <div style={{ display: "flex", marginTop: 28, color: "#8f9aae", fontSize: 20, fontWeight: 700 }}>
          <div style={{ flex: 1 }}>{hdcp ? "Handicap-adjusted" : "Scratch"}</div>
          {r.games.map((g) => <div key={g.game} style={{ width: 120, justifyContent: "flex-end", display: "flex" }}>G{g.game}</div>)}
          <div style={{ width: 140, justifyContent: "flex-end", display: "flex" }}>SERIES</div>
          <div style={{ width: 90, justifyContent: "flex-end", display: "flex" }}>PTS</div>
        </div>
        {sides.map((s, i) => {
          const win = status.final && r.winner === s.side;
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", height: rowH, borderTop: "1px solid #232b38" }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 34, fontWeight: 800, display: "flex" }}>{nm(s.participantId)}{win ? <span style={{ marginLeft: 12, color: "#4ade80", fontSize: 24 }}>WIN</span> : null}</div>
              </div>
              {s.games.map((g, k) => (
                <div key={k} style={{ width: 120, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{ fontSize: 36, fontWeight: 800, color: r.games[k].winner === s.side ? "#e8ebf1" : "#8f9aae" }}>{g.basis ?? "–"}</div>
                  {hdcp && g.scratch != null ? <div style={{ fontSize: 16, color: "#66718a" }}>{g.scratch}+{(g.adjusted ?? 0) - g.scratch}</div> : null}
                </div>
              ))}
              <div style={{ width: 140, display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                <div style={{ fontSize: 40, fontWeight: 900 }}>{s.basisSeries || "–"}</div>
                {hdcp ? <div style={{ fontSize: 16, color: "#66718a" }}>{s.scratchSeries}+{s.handicapSeries}</div> : null}
              </div>
              <div style={{ width: 90, display: "flex", justifyContent: "flex-end", fontSize: 40, fontWeight: 900 }}>{fmtPts(s.points)}</div>
            </div>
          );
        })}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", fontSize: 18, color: "#66718a" }}>
          <div>{status.final && r.margin != null ? `Margin: ${r.margin} ${hdcp ? "adjusted " : ""}pins` : "Not final — provisional scores"}</div>
          <div>{status.label}</div>
        </div>
      </div>
    ),
    { width: W, height: H, headers: { "Content-Disposition": `attachment; filename="${slug}-week-${r.weekNumber}-scorecard.png"`, "Cache-Control": "private, max-age=60" } }
  );
}
