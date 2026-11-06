import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { SeasonModel } from "@/domain/engine";
import { fmt1, fmtPts } from "@/domain/math";
import type { MatchupResult, SideLine } from "@/domain/scoring";
import type { SheetMatch, WeeklySheet } from "@/domain/sheet";
import { formatDate } from "./views";

/**
 * The weekly sheet as a PDF: the same content as the page, laid out for letter paper. It exists because a phone saved to the Home Screen
 * can't print: iOS ignores window.print() in a web app, so the sheet has to arrive as a file the share sheet can save or print.
 * Built with the PDF's standard fonts, which only hold Latin-1, so other characters are replaced (see `text`).
 */

const PAGE_W = 612;
const PAGE_H = 792;
const M = 40;
const TOP = 40;
const BOTTOM = 52;
const CONTENT_W = PAGE_W - 2 * M;
/** Every table row is this tall (one line of text plus padding), so heights are known before a table is drawn. */
const ROW = 13;
const INK: [number, number, number] = [20, 20, 20];
const MUTED: [number, number, number] = [95, 95, 95];
const SHADE: [number, number, number] = [240, 240, 240];
const RULE: [number, number, number] = [185, 185, 185];
const WIN: [number, number, number] = [19, 107, 63];
const LOSS: [number, number, number] = [163, 48, 58];

/** Keeps what the PDF's standard fonts can show: Latin-1 as is, accents on other letters dropped, anything else a "?". */
export function text(s: string): string {
  return Array.from(s, (c) => {
    if (c === "−" || c === "–" || c === "—") return "-";
    if (c === "‘" || c === "’") return "'";
    if (c === "“" || c === "”") return '"';
    const code = c.codePointAt(0)!;
    if (code <= 0xff) return c;
    const base = c.normalize("NFKD").replace(/[̀-ͯ]/g, "");
    return /^[\x20-\x7e -ÿ]+$/.test(base) ? base : "?";
  }).join("");
}

const ordinal = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));
const signed = (n: number | null, decimals = 0) => (n == null ? "-" : n === 0 ? "0" : `${n > 0 ? "+" : "-"}${Math.abs(n).toFixed(decimals)}`);
const round = (n: number | null) => (n == null ? "-" : String(Math.round(n)));
type Align = "left" | "right";

export interface SheetPdfMeta {
  leagueName: string;
  seasonName: string;
  logoText: string;
}

export function renderSheetPdf(model: SeasonModel, sheet: WeeklySheet, meta: SheetPdfMeta, opts: { compress?: boolean } = {}): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: opts.compress ?? true });
  doc.setProperties({ title: text(`${meta.leagueName} · Week ${sheet.week} sheet`), subject: text(meta.seasonName), creator: "Sweeper" });
  let y = TOP;
  const finalY = () => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  const need = (h: number) => {
    if (y + h > PAGE_H - BOTTOM) {
      doc.addPage();
      y = TOP;
    }
  };
  const ink = (c: [number, number, number]) => doc.setTextColor(c[0], c[1], c[2]);
  const baseStyles = { font: "helvetica", fontSize: 7.5, cellPadding: { top: 2.5, bottom: 2.5, left: 3, right: 3 }, minCellHeight: ROW, textColor: INK, valign: "middle" as const, overflow: "ellipsize" as const, lineColor: RULE, lineWidth: { bottom: 0.3 } };
  const name = (id: string) => model.bowlerById.get(id)?.name ?? "Unknown bowler";
  const sideName = (kind: "team" | "individual", id: string) => (kind === "team" ? model.teamById.get(id)?.name : model.bowlerById.get(id)?.name) ?? "Unknown";

  /** A section heading. `reserve` is the height of the first thing under it, so a heading never sits alone at the foot of a page. */
  const heading = (title: string, aside?: string, reserve = 40) => {
    need(12 + 13 + reserve);
    if (y > TOP + 1) y += 12;
    doc.setFont("helvetica", "bold").setFontSize(8.5);
    ink(INK);
    doc.text(text(title.toUpperCase()), M, y, { charSpace: 0.5 });
    if (aside) {
      doc.setFont("helvetica", "normal").setFontSize(8);
      ink(MUTED);
      doc.text(text(aside), PAGE_W - M, y, { align: "right" });
    }
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.8).line(M, y + 4.5, PAGE_W - M, y + 4.5);
    y += 13;
  };
  const note = (s: string, size = 8, color = MUTED, bold = false) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size);
    ink(color);
    for (const line of doc.splitTextToSize(text(s), CONTENT_W) as string[]) {
      need(size + 4);
      doc.text(line, M, y + size);
      y += size + 3;
    }
  };

  // ---- title ----
  doc.setDrawColor(INK[0], INK[1], INK[2]).setLineWidth(1.4).roundedRect(M, y, 36, 36, 7, 7);
  doc.setFont("helvetica", "bold").setFontSize(11);
  ink(INK);
  doc.text(text(meta.logoText.slice(0, 3)), M + 18, y + 22, { align: "center" });
  doc.setFontSize(7.5);
  ink(MUTED);
  doc.text(text(`${meta.leagueName} · ${meta.seasonName}${sheet.phase === "playoff" ? " · Playoffs" : ""}`.toUpperCase()), M + 48, y + 8, { charSpace: 0.4 });
  doc.setFontSize(21);
  ink(INK);
  doc.text(`Week ${sheet.week} sheet`, M + 48, y + 28);
  doc.setFont("helvetica", "normal").setFontSize(9);
  ink(MUTED);
  doc.text(text(`${formatDate(sheet.date, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}${sheet.label ? ` · ${sheet.label}` : ""}`), M + 48, y + 41);
  if (sheet.settingWeek) {
    doc.setFont("helvetica", "bold").setFontSize(7.5);
    ink(INK);
    doc.setDrawColor(INK[0], INK[1], INK[2]).setLineWidth(0.8).roundedRect(PAGE_W - M - 84, y + 4, 84, 16, 8, 8);
    doc.text("HANDICAP WEEK", PAGE_W - M - 42, y + 15, { align: "center" });
  }
  y += 52;
  doc.setDrawColor(INK[0], INK[1], INK[2]).setLineWidth(1.6).line(M, y, PAGE_W - M, y);
  y += 14;
  if (sheet.settingWeek) {
    note("Handicap week. Everyone bowls scratch tonight, with no handicap. Scores count toward averages and handicaps only, not the standings.", 8.5, INK, true);
    y += 6;
  }

  // ---- last week ----
  const prev = sheet.previous;
  const lastWeekResults = prev ? prev.results.filter((r) => !r.isBye) : [];
  const rowsOf = (r: MatchupResult) => 2 + [r.a, r.b!].reduce((n, s) => n + 2 + s.lineup.length, 0);
  heading(prev ? `Last week · Week ${prev.week}` : "Last week", prev ? formatDate(prev.date, { weekday: "short", month: "short", day: "numeric" }) : undefined, lastWeekResults.length ? rowsOf(lastWeekResults[0]) * ROW + 10 : 30);
  if (!prev) {
    note("No results yet. This is the first night of the season.", 9);
  } else {
    if (prev.settingWeek) note("Handicap week: bowled scratch, no points or winners. These scores set everyone's starting handicap.", 8);
    const results = lastWeekResults;
    const gamesPerNight = Math.max(3, ...results.map((r) => r.gamesPerSession));
    const twoUp = gamesPerNight <= 3;
    const colW = twoUp ? (CONTENT_W - 12) / 2 : CONTENT_W;
    for (let i = 0; i < results.length; i += twoUp ? 2 : 1) {
      const group = results.slice(i, i + (twoUp ? 2 : 1));
      need(Math.max(...group.map(rowsOf)) * ROW + 10);
      const startY = y;
      let bottom = startY;
      group.forEach((r, k) => {
        resultTable(r, M + k * (colW + 12), colW, startY);
        bottom = Math.max(bottom, finalY());
      });
      y = bottom + 10;
    }
    const byes = prev.results.filter((r) => r.isBye);
    if (byes.length) note(`Sat out: ${byes.map((r) => r.a.lineup.map((l) => name(l.bowlerId)).join(", ") || sideName(r.matchup.kind, r.a.participantId)).join("; ")}`, 8);
    if (prev.notFinal) note(`${prev.notFinal} matchup${prev.notFinal === 1 ? " isn't" : "s aren't"} final yet and ${prev.notFinal === 1 ? "is" : "are"} left off.`, 8);
    if (prev.highGame.length) note(`High game: ${prev.highGame.map((h) => `${h.name} ${h.score}`).join(", ")}`, 8.5, INK);
    if (prev.topSeries.length) note(`High series: ${prev.topSeries.map((s) => `${s.name} ${s.score}`).join(", ")}`, 8.5, INK);
    for (const h of prev.headlines) note(h, 8.5, INK);
  }
  y += 4;

  function resultTable(r: MatchupResult, x: number, width: number, startY: number) {
    const hdcp = r.basis === "handicap";
    const games = r.gamesPerSession;
    const showPts = !r.settingWeek;
    const cols = 2 + (hdcp ? 1 : 0) + games + 1 + (showPts ? 1 : 0);
    const kind = r.matchup.kind;
    const title = `${sideName(kind, r.a.participantId)} vs ${sideName(kind, r.b!.participantId)}${r.guest ? " (extra comparison)" : ""}`;
    const label = (s: string) => ({ content: s, styles: { textColor: MUTED, fontStyle: "normal" as const, fillColor: [255, 255, 255] as [number, number, number] } });
    const head = [
      [{ content: text(title), colSpan: cols, styles: { halign: "left" as const, fontStyle: "bold" as const, fillColor: SHADE } }],
      [label("Bowler"), label("Avg"), ...(hdcp ? [label("Hdcp")] : []), ...Array.from({ length: games }, (_, g) => label(`G${g + 1}`)), label("Ser"), ...(showPts ? [label("Pts")] : [])],
    ];
    const body: (string | { content: string; colSpan?: number; styles?: object })[][] = [];
    const side = (s: SideLine, own: boolean) => {
      body.push([{ content: text(`${sideName(kind, s.participantId)}${own ? "" : " - scores from their own match"}`), colSpan: cols, styles: { fontStyle: "bold", halign: "left" } }]);
      for (const l of s.lineup) {
        body.push([
          text(`${name(l.bowlerId)}${l.isSub ? " (sub)" : ""}`), round(l.average), ...(hdcp ? [String(l.handicap)] : []),
          ...l.games.map((g) => (g.kind === "absent" && !g.blind ? "abs" : `${g.scratch ?? "-"}${g.blind ? " b" : ""}`)),
          { content: l.scratchSeries ? String(l.scratchSeries) : "-", styles: { fontStyle: "bold" } },
          ...(showPts ? [""] : []),
        ]);
      }
      const won = r.winner === s.side;
      body.push([
        { content: hdcp ? "Total with handicap" : "Team total", styles: { fontStyle: "bold", fillColor: SHADE } }, { content: "", styles: { fillColor: SHADE } }, ...(hdcp ? [{ content: "", styles: { fillColor: SHADE } }] : []),
        ...s.games.map((g) => ({ content: String(g.basis ?? "-"), styles: { fontStyle: "bold", fillColor: SHADE } })),
        { content: s.basisSeries ? String(s.basisSeries) : "-", styles: { fontStyle: "bold", fillColor: SHADE } },
        ...(showPts ? [{ content: !own ? "-" : `${fmtPts(s.points)}${won ? " W" : r.winner === "tie" ? " T" : ""}`, styles: { fontStyle: "bold", fillColor: SHADE, textColor: won ? WIN : INK } }] : []),
      ]);
    };
    side(r.a, true);
    side(r.b!, !r.guest);
    const numeric = 22 + (hdcp ? 24 : 0) + games * 26 + 28 + (showPts ? 26 : 0);
    autoTable(doc, {
      startY, head, body, theme: "plain", margin: { left: x, right: PAGE_W - x - width }, tableWidth: width, styles: baseStyles, pageBreak: "avoid", rowPageBreak: "avoid",
      columnStyles: { 0: { cellWidth: Math.max(60, width - numeric), halign: "left" }, ...Object.fromEntries(Array.from({ length: cols - 1 }, (_, i) => [i + 1, { halign: "right" as const, cellWidth: i === 0 ? 22 : "auto" as const }])) },
    });
  }

  // ---- standings ----
  if (sheet.week > 1) {
    heading(`Standings entering week ${sheet.week}`, undefined, sheet.standings ? Math.min(sheet.standings.length + 1, 8) * ROW + 6 : 24);
    if (!sheet.standings) {
      note(prev?.settingWeek ? "Standings start after the handicap weeks. Nothing has counted yet." : "No standings yet.", 9);
    } else {
      const who = (id: string) => (sheet.standingsFor === "bowler" ? model.bowlerById.get(id)?.name : model.teamById.get(id)?.name) ?? "Unknown";
      const ties = sheet.standings.some((r) => r.ties > 0);
      const body: (string | { content: string; colSpan: number; styles: object })[][] = [];
      sheet.standings.forEach((r, i) => {
        body.push([String(r.rank), text(who(r.id)), `${r.wins}-${r.losses}${ties ? `-${r.ties}` : ""}`, fmtPts(r.points), r.form.join(" ") || "-"]);
        if (sheet.qualifiers != null && i === sheet.qualifiers - 1 && i < sheet.standings!.length - 1) body.push([{ content: `Playoff line: top ${sheet.qualifiers} qualify`, colSpan: 5, styles: { fontStyle: "italic", fontSize: 6.8, textColor: MUTED, halign: "left" } }]);
      });
      need(Math.min(body.length + 1, 14) * ROW + 6);
      autoTable(doc, {
        startY: y, head: [[sheet.standingsFor === "bowler" ? ["#", "Bowler"] : ["#", "Team"], ties ? "W-L-T" : "W-L", "Pts", "Last five"].flat()], body, theme: "plain", styles: baseStyles, margin: { left: M, right: M }, tableWidth: 400, pageBreak: "auto",
        headStyles: { textColor: MUTED, fontStyle: "normal" },
        columnStyles: { 0: { cellWidth: 22, halign: "left" }, 1: { halign: "left" }, 2: { cellWidth: 52, halign: "right" }, 3: { cellWidth: 40, halign: "right", fontStyle: "bold" }, 4: { cellWidth: 80, halign: "right" } },
        didParseCell: (d) => {
          const a: Align[] = ["left", "left", "right", "right", "right"];
          if (d.section === "head" && !d.cell.colSpan || d.section === "head" && d.cell.colSpan === 1) d.cell.styles.halign = a[d.column.index] ?? "left";
          if (d.section === "body" && d.column.index === 4 && typeof d.cell.raw === "string") d.cell.styles.textColor = MUTED;
        },
      });
      y = finalY() + 4;
    }
  }

  // ---- this week ----
  const matchRows = (m: SheetMatch) => (m.kind === "bye" ? 2 : (m.kind === "extra" ? 1 : 0) + 1 + Math.max(m.a.lineup.length, m.b!.lineup.length));
  heading(`This week · Week ${sheet.week} matchups`, sheet.handicapOn ? "Average · handicap" : "Average", sheet.matchups.length ? matchRows(sheet.matchups[0]) * ROW + 8 : 24);
  if (sheet.matchups.length === 0) {
    note(sheet.partners ? "Partners and matchups are drawn at the start of the night." : "No matchups are scheduled for this week yet.", 9);
  }
  const avgHdcp = (b: { average: number | null; handicap: number }) => `${round(b.average)}${b.handicap ? ` · ${b.handicap}` : ""}`;
  const sideHead = (s: SheetMatch["a"]) => `${s.name}${s.record ? ` · ${s.rank ? `${s.rank}${ordinal(s.rank)}, ` : ""}${s.record}` : ""}`;
  for (const m of sheet.matchups) {
    if (m.kind === "bye") {
      need(2 * ROW + 6);
      autoTable(doc, { startY: y, head: [[{ content: "Sitting out", colSpan: 1, styles: { fontStyle: "bold", halign: "left", fillColor: SHADE } }]], body: [[text(m.a.lineup.map((b) => b.name).join(", ") || m.a.name)]], theme: "plain", styles: baseStyles, margin: { left: M, right: M }, tableWidth: CONTENT_W, pageBreak: "avoid" });
      y = finalY() + 8;
      continue;
    }
    const rows = Math.max(m.a.lineup.length, m.b!.lineup.length);
    const head: { content: string; colSpan: number; styles: object }[][] = [
      ...(m.kind === "extra" ? [[{ content: text(`Extra comparison: ${m.a.name} bowl for points against ${m.b!.name}'s scores`), colSpan: 4, styles: { fontStyle: "italic", halign: "left", textColor: MUTED, fillColor: [255, 255, 255] } }]] : []),
      [{ content: text(sideHead(m.a)), colSpan: 2, styles: { fontStyle: "bold", halign: "left", fillColor: SHADE } }, { content: text(sideHead(m.b!)), colSpan: 2, styles: { fontStyle: "bold", halign: "left", fillColor: SHADE } }],
    ];
    const body = Array.from({ length: rows }, (_, i) => [text(m.a.lineup[i] ? `${m.a.lineup[i].name}${m.a.lineup[i].isSub ? " (sub)" : ""}` : ""), m.a.lineup[i] ? avgHdcp(m.a.lineup[i]) : "", text(m.b!.lineup[i] ? `${m.b!.lineup[i].name}${m.b!.lineup[i].isSub ? " (sub)" : ""}` : ""), m.b!.lineup[i] ? avgHdcp(m.b!.lineup[i]) : ""]);
    need((head.length + rows) * ROW + 8);
    autoTable(doc, {
      startY: y, head, body, theme: "plain", styles: baseStyles, margin: { left: M, right: M }, tableWidth: CONTENT_W, pageBreak: "avoid",
      columnStyles: { 0: { cellWidth: (CONTENT_W - 140) / 2, halign: "left" }, 1: { cellWidth: 70, halign: "right" }, 2: { cellWidth: (CONTENT_W - 140) / 2, halign: "left", cellPadding: { top: 2.5, bottom: 2.5, left: 16, right: 3 } }, 3: { cellWidth: 70, halign: "right" } },
    });
    y = finalY() + 8;
  }
  y += 2;

  // ---- averages and handicaps ----
  heading("Averages & handicaps", sheet.handicapOn ? `Going into week ${sheet.week}` : `Going into week ${sheet.week} · no handicap this week`, 5 * ROW + 10);
  if (sheet.bowlers.length === 0) {
    note("Nobody is on this season's roster yet.", 9);
  } else {
    const teams = !sheet.partners && sheet.bowlers.some((b) => b.teamName);
    const h = sheet.handicapOn;
    const cols = ["Bowler", ...(teams ? ["Team"] : []), "Gms", "Avg", "+/-", ...(h ? ["Hdcp", "+/-"] : []), "High G", "High S"];
    const body = sheet.bowlers.map((b) => [
      text(`${b.name}${b.isSub ? " (sub)" : ""}`), ...(teams ? [text(b.teamName ?? "-")] : []), b.games ? String(b.games) : "-", fmt1(b.average), signed(b.averageChange, 1),
      ...(h ? [String(b.handicap), signed(b.handicapChange)] : []), b.highGame != null ? String(b.highGame) : "-", b.highSeries != null ? String(b.highSeries) : "-",
    ]);
    const avgCol = cols.indexOf("Avg");
    const aligns: Align[] = cols.map((c) => (c === "Bowler" || c === "Team" ? "left" : "right"));
    autoTable(doc, {
      startY: y, head: [cols], body, theme: "plain", styles: baseStyles, margin: { left: M, right: M }, tableWidth: CONTENT_W, pageBreak: "auto", rowPageBreak: "avoid", showHead: "everyPage",
      headStyles: { textColor: MUTED, fontStyle: "normal" },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: c === "Bowler" || c === "Team" ? "left" : "right", ...(c === "Gms" || c === "Hdcp" || c === "+/-" ? { cellWidth: 36 } : c === "High G" || c === "High S" ? { cellWidth: 44 } : c === "Avg" ? { cellWidth: 40 } : {}), ...(c === "Bowler" ? { fontStyle: "bold" } : {}) }])),
      didParseCell: (d) => {
        if (d.section === "head") d.cell.styles.halign = aligns[d.column.index];
        if (d.section !== "body" || typeof d.cell.raw !== "string") return;
        if (d.column.index === avgCol + 1 && d.cell.raw !== "0" && d.cell.raw !== "-") d.cell.styles.textColor = d.cell.raw.startsWith("+") ? WIN : LOSS;
        if (d.column.index === avgCol || (h && d.column.index === avgCol + 2)) d.cell.styles.fontStyle = "bold";
      },
    });
    y = finalY() + 3;
    note(`Averages and handicaps come from finalized scores through week ${prev?.week ?? 0}. +/- is the change since the week before.`, 7.5);
  }
  // ---- coming up ----
  if (sheet.upcoming.length) {
    heading("Coming up", undefined, 30);
    for (const u of sheet.upcoming) {
      const matches = u.matches.length ? u.matches.map((x) => (x.b ? `${x.a} vs ${x.b}${x.extra ? " (extra)" : ""}` : x.a)).join(" · ") : sheet.partners ? "Partners are drawn at the start of the night." : "Matchups not scheduled yet.";
      note(`${u.phase === "playoff" ? u.label || `Playoffs · Week ${u.week}` : `Week ${u.week}`} · ${formatDate(u.date, { weekday: "short", month: "short", day: "numeric" })}${u.postponed ? " (postponed)" : ""}: ${matches}`, 8.5, INK);
    }
  }

  // ---- footer on every page ----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]).setLineWidth(0.5).line(M, PAGE_H - 36, PAGE_W - M, PAGE_H - 36);
    doc.setFont("helvetica", "normal").setFontSize(7.5);
    ink(MUTED);
    doc.text(text(`${meta.leagueName} · ${meta.seasonName}`), M, PAGE_H - 26);
    doc.text(`Week ${sheet.week} sheet · Page ${p} of ${pages}`, PAGE_W - M, PAGE_H - 26, { align: "right" });
  }
  return new Uint8Array(doc.output("arraybuffer"));
}
