// Rotating partners, end to end in a browser: create a league from the template, add ten bowlers, draw a week (two matches plus an extra
// pair compared with another pair's scores), watch the draw, enter and finalize scores, then check what members see and run an
// accessibility audit on the pages that change for this kind of league.
// Usage: BASE=http://localhost:3000 node e2e/partners.mjs   (registers its own account)
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://localhost:3000";
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const fails = [];
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror at ${new URL(page.url()).pathname}: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(404|401|403)/.test(m.text())) errors.push(`console at ${new URL(page.url()).pathname}: ${m.text()}`); });

// ---- sign up and create the league from the template ----
console.log("\n== create a rotating-partners league ==");
await page.goto(`${BASE}/register`);
await page.fill("#name", "Partners Tester");
await page.fill("#email", `partners${Date.now()}@example.com`);
await page.fill("#password", "correct-horse-battery");
await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
await page.goto(`${BASE}/leagues/new`, { waitUntil: "networkidle" });
await page.fill("#name", "Thursday Partners");
await page.fill("#wk", "9");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /Rotating partners league/ }).click();
ok(await page.locator("#f-partners\\.enabled").isChecked(), "the template switches rotating partners on");
await page.getByRole("button", { name: "Next" }).click(); // scoring
ok((await page.locator("#f-scoring\\.pointsPerGame").inputValue()) === "2", "each game won is worth 2 points");
ok((await page.locator("#f-scoring\\.pointsPerSeries").inputValue()) === "1", "the higher three-game total is worth 1 point");
ok((await page.locator("text=a bowler can earn up to").count()) > 0 && (await page.locator("b", { hasText: /^7$/ }).count()) > 0, "the form says a bowler can earn up to 7 points a night");
await page.getByRole("button", { name: "Next" }).click(); // handicap
await page.getByRole("button", { name: "Next" }).click(); // standings
ok((await page.locator("text=Playoffs aren't available with rotating partners yet").count()) > 0, "playoffs are explained as unavailable");
await page.getByRole("button", { name: "Next" }).click(); // review
ok((await page.locator("text=Winner earns 2 points").count()) > 0 && (await page.locator("text=Most a bowler can earn in a night").count()) > 0, "the review describes the rules in plain language");
ok((await page.locator("text=Extra pair").count()) > 0, "the review explains the extra pair");
await Promise.all([page.waitForURL(/\/admin\?welcome=1/, { timeout: 15000 }), page.getByRole("button", { name: "Create league" }).click()]);
const slug = page.url().match(/\/l\/([^/]+)\//)[1];
const L = `${BASE}/l/${slug}`;
ok((await page.locator("text=add your bowlers, then draw each week's partners").count()) > 0, "the welcome message talks about bowlers and draws, not teams");

// ---- roster: ten bowlers, no teams ----
console.log("\n== roster ==");
await page.goto(`${L}/admin/roster`, { waitUntil: "networkidle" });
ok((await page.locator("#bteam").count()) === 0, "no team picker when adding a bowler");
const names = ["Alex Rivera", "Sam Chen", "Jordan Blake", "Taylor Nguyen", "Casey Morgan", "Riley Patel", "Jamie Okafor", "Morgan Reyes", "Quinn Larsen", "Avery Kim"];
for (const [i, n] of names.entries()) {
  await page.fill("#bname", n);
  await page.fill("#bavg", String(150 + i * 4));
  await page.getByRole("button", { name: "Add bowler to this season" }).click();
  await page.waitForSelector("text=Bowler added.", { timeout: 8000 });
  await page.waitForSelector(`text=${n}`);
}
ok((await page.locator("summary", { hasText: "Avery Kim" }).count()) === 1, "ten bowlers are on the roster");

// ---- draw ----
console.log("\n== draw partners ==");
await page.goto(`${L}/admin`, { waitUntil: "networkidle" });
ok((await page.locator("text=Draw week 1 partners").count()) > 0, "the overview's next step is to draw week 1");
await page.goto(`${L}/admin/schedule`, { waitUntil: "networkidle" });
ok((await page.locator("text=Generate schedule").count()) === 0, "there is no round-robin generator");
ok((await page.locator('input[name="bowler"]').count()) === 10, "all ten bowlers are listed as bowling");
ok((await page.locator("text=10 bowling: 5 pairs, making 2 matches plus one extra pair").count()) > 0 && (await page.locator("text=everyone bowls").count()) > 0, "the form explains the split: 5 pairs, 2 matches, one extra pair, everyone bowls");
await page.getByRole("button", { name: "Nobody" }).click();
ok((await page.locator("text=Pick at least four").count()) > 0, "fewer than four bowlers is explained");
await page.getByRole("button", { name: "Everyone" }).click();
await page.getByRole("button", { name: "Draw week 1 partners" }).click();
await page.waitForSelector("text=Week 1 partners drawn: 2 matches, one extra comparison", { timeout: 10000 });
ok(true, "week 1 is drawn: 2 matches and one extra comparison, nobody sitting out");

// The draw plays as a show right away.
const reveal = page.locator("dialog.draw-dialog[open]");
await reveal.waitFor({ timeout: 5000 });
ok((await reveal.locator("h2", { hasText: "The draw" }).count()) === 1, "the draw opens as a reveal straight after drawing");
ok((await reveal.locator("svg[role=img]").count()) === 1, "the reveal shows the lane");
await page.waitForTimeout(500);
ok((await reveal.locator("ol li").count()) === 0, "nothing is revealed before the first ball lands");
await reveal.getByRole("button", { name: /Skip to the end/ }).click();
await page.waitForTimeout(200);
const items = await reveal.locator("ol li").allInnerTexts();
ok(items.length === 3, `skipping shows the whole draw: 2 matches and the extra pair (${items.length} items)`);
ok(items.slice(0, 2).every((t) => / vs /.test(t)) && /scores/.test(items[2]) && /Only .* can earn points/.test(items[2]), "each match names both pairs; the extra pair says only they earn points");
await reveal.getByRole("button", { name: "Done" }).click();
await reveal.waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
ok((await page.locator("dialog.draw-dialog[open]").count()) === 0, "the reveal closes");

await page.reload({ waitUntil: "networkidle" });
const matchLinks = await page.locator(`a[href*="/matchup/"]`).allInnerTexts();
const real = matchLinks.filter((t) => / vs /.test(t) && !/’s scores/.test(t));
const extra = matchLinks.filter((t) => /’s scores/.test(t));
ok(real.length === 2 && extra.length === 1 && matchLinks.length === 3, `week 1 lists 2 matches and 1 extra comparison (${real.length}, ${extra.length})`);
ok(real.every((t) => (t.match(/ & /g) ?? []).length === 2), "each side is named after its two partners");
ok((await page.locator("text=EXTRA COMPARISON").count()) === 1, "the extra comparison is labelled");
ok((await page.locator("text=(drawn)").count()) > 0, "the week list marks week 1 as drawn");
const weekPick = page.getByLabel("Week", { exact: true });
ok((await weekPick.inputValue()) === "2", "after week 1 is drawn, the form moves on to week 2");
await weekPick.selectOption("1");
ok((await page.locator("text=Partners are already drawn for this week").count()) > 0, "picking a drawn week warns that drawing again replaces it");
await page.getByRole("button", { name: "Draw week 1 again" }).click();
await page.waitForSelector("text=The earlier draw was replaced", { timeout: 10000 });
await page.locator("dialog.draw-dialog[open]").getByRole("button", { name: /Skip to the end/ }).click();
await page.locator("dialog.draw-dialog[open]").getByRole("button", { name: "Done" }).click();
ok(true, "drawing again replaces the draw before any scores exist");
await page.reload({ waitUntil: "networkidle" });
await page.getByRole("button", { name: "Watch the draw" }).first().click();
await page.locator("dialog.draw-dialog[open]").waitFor();
ok(true, "a drawn week can be watched again from the schedule");
await page.locator("dialog.draw-dialog[open]").getByRole("button", { name: "Close", exact: true }).click();

// ---- score entry ----
console.log("\n== scores ==");
await page.goto(`${L}/admin/scores?week=1`, { waitUntil: "networkidle" });
const sections = page.locator("section").filter({ has: page.locator("input.score-input") });
ok((await sections.count()) === 3, `score entry shows 2 matches and the extra comparison (${await sections.count()})`);
ok((await sections.nth(2).locator("text=Extra comparison").count()) > 0, "the extra comparison comes last and says what it is");
ok((await sections.nth(2).locator("input.score-input:not([disabled])").count()) === 6 && (await sections.nth(2).locator("input.score-input[disabled]").count()) === 6, "only the extra pair's six boxes can be typed in; the other pair's six are read-only");
// Match 1: side A (6 boxes) bowls 190, side B 150. Match 2: side A 160, side B 170. Extra pair: 175.
const typeAll = async (s, n, valueFor) => { const inputs = sections.nth(s).locator("input.score-input:not([disabled])"); await inputs.first().click(); for (let i = 0; i < n; i++) await page.keyboard.type(String(valueFor(i))); };
await typeAll(0, 12, (i) => (i < 6 ? 190 : 150));
await typeAll(1, 12, (i) => (i < 6 ? 160 : 170));
await typeAll(2, 6, () => 175);
await page.getByRole("button", { name: /Save all drafts/ }).click();
await page.waitForSelector("text=saved as draft", { timeout: 10000 });
// The extra comparison can't be finalized before the pair it is compared with.
await sections.nth(2).getByRole("button", { name: /Preview & finalize/ }).click();
await page.waitForSelector("text=this extra comparison uses their scores", { timeout: 10000 });
ok((await page.locator("text=matchup first: this extra comparison uses their scores").count()) > 0, "finalizing the extra comparison before the other pair's matchup is refused with a clear reason");
await page.reload({ waitUntil: "networkidle" });
for (let s = 0; s < 3; s++) {
  await sections.nth(s).getByRole("button", { name: /Preview & finalize/ }).click();
  await page.waitForSelector("text=Impact on standings", { timeout: 10000 });
  await page.getByRole("button", { name: "Finalize result" }).click();
  await page.waitForSelector("text=Finalized. Standings are updated.", { timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
}
ok(true, "both matches and the extra comparison finalized from the UI");

// ---- what members see ----
console.log("\n== standings and pages ==");
const visit = async (path) => { const r = await page.goto(`${L}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(200); return r.status(); };
ok((await visit("/standings")) === 200, "standings load");
const tbl = page.locator("table.tbl").first();
const rows = await tbl.locator("tbody tr").allInnerTexts();
ok(rows.length === 10, `standings list all 10 bowlers (${rows.length})`);
const text = (await tbl.locator("tbody").innerText()).replace(/\s+/g, " ");
const points = await Promise.all([...(await tbl.locator("tbody tr").all())].map(async (r) => (await r.locator("td").nth(2).innerText()).trim()));
// Match 1's A pair and match 2's B pair swept their matches (7 each). The extra pair, at 175, beat the pair it was compared with if that
// pair bowled 160 (match 2's A pair, who earned nothing) and lost to it if it bowled 190 (match 1's A pair). Nobody scores more than 7.
const sevens = points.filter((p) => p === "7").length;
ok(points.every((p) => p === "0" || p === "7") && (sevens === 4 || sevens === 6), `2 a game plus 1 for the total, 7 at most (points: ${points.join(",")})`);
ok(!/Unknown/.test(text), "no unknown names in the standings");
ok((await visit("/")) === 200 && (await page.locator("text=Standings").count()) > 0, "league home loads with standings");
ok((await visit("/teams")) === 200 && page.url().endsWith("/standings"), "the Teams page sends you to the standings");
ok((await page.locator('a[href$="/teams"]').count()) === 0, "there is no Teams link in the navigation");
ok((await visit("/schedule")) === 200, "the public schedule loads");
ok((await visit("/results")) === 200, "results load");
// A real head-to-head match, and the extra comparison, whatever the draw happened to produce.
await visit("/admin/schedule");
const hrefs = await page.locator(`a[href*="/matchup/"]`).evaluateAll((as) => as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent })));
const mu = hrefs.find((h) => / vs /.test(h.text) && !/’s scores/.test(h.text)).href;
const xmu = hrefs.find((h) => /’s scores/.test(h.text)).href;
ok((await visit(mu.replace(`/l/${slug}`, ""))) === 200, "a matchup page loads");
ok((await page.locator("h1").first().innerText()).includes(" & "), "the matchup is titled with both pairs' names");
const sc = await page.request.get(`${BASE}${mu}/scorecard`);
ok(sc.status() === 200 && /image\/png/.test(sc.headers()["content-type"] ?? ""), "the scorecard image renders for a pair matchup");
ok((await visit(xmu.replace(`/l/${slug}`, ""))) === 200, "the extra comparison's page loads");
ok((await page.locator("text=EXTRA COMPARISON").count()) > 0 && (await page.locator("text=no points").count()) > 0 && (await page.locator("text=already scored in their own matchup").count()) > 0, "it is labelled an extra comparison, gives the compared pair no points, and says why");
const xsc = await page.request.get(`${BASE}${xmu}/scorecard`);
ok(xsc.status() === 200 && /image\/png/.test(xsc.headers()["content-type"] ?? ""), "the extra comparison's scorecard renders too");
ok((await visit("/bowlers")) === 200 && (await page.locator('th:has-text("W-L")').count()) === 1 && (await page.locator('th:has-text("Team")').count()) === 0, "bowlers show a W-L record and no team column");
const bowlerHref = await page.locator(`a[href*="/bowlers/"]`).first().getAttribute("href");
ok((await visit(bowlerHref.replace(`/l/${slug}`, ""))) === 200, "a bowler profile loads");
for (const p of ["/stats", "/stats?tab=records", "/stats?tab=awards&week=1", "/stats?tab=insights", "/timeline", "/history", "/rules", "/admin", "/admin/scores?week=1", "/admin/roster", "/admin/settings?section=rules", "/admin/audit"]) ok((await visit(p)) === 200, `${p} loads`);
await visit("/rules");
ok((await page.locator("text=Rotating partners").count()) > 0 && (await page.locator("text=Winner earns 2 points").count()) > 0, "the public rules page explains rotating partners");
await visit("/admin/audit");
ok((await page.locator("text=partners.drawn").count()) > 0 || (await page.locator("text=drawn").count()) > 0, "the draw is in the audit log");
// The week page can replay the draw for anyone.
await visit("/season/2026/week/1");
await page.getByRole("button", { name: "Watch the draw" }).click();
await page.locator("dialog.draw-dialog[open]").waitFor();
await page.locator("dialog.draw-dialog[open]").getByRole("button", { name: /Skip to the end/ }).click();
ok((await page.locator("dialog.draw-dialog[open] ol li").count()) === 3, "anyone can replay the draw from the week page");
await page.locator("dialog.draw-dialog[open]").getByRole("button", { name: "Done" }).click();

// ---- the rules form keeps the structural option locked once scores exist ----
await visit("/admin/settings?section=rules");
await page.getByRole("button", { name: "Format", exact: true }).click();
ok(await page.locator("#f-partners\\.enabled").isDisabled(), "rotating partners can't be switched off once scores exist");

// ---- other leagues are untouched ----
console.log("\n== a normal league still works ==");
await page.goto(`${BASE}/leagues/new`, { waitUntil: "networkidle" });
await page.fill("#name", "Regular Teams League");
await page.fill("#teams", "Alpha\nBravo");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /Traditional handicap team league/ }).click();
ok(!(await page.locator("#f-partners\\.enabled").isChecked()), "the traditional template has rotating partners off");
ok((await page.locator("#f-bowlersPerTeam").count()) === 1, "bowlers per team is offered");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Next" }).click();
await Promise.all([page.waitForURL(/\/admin\?welcome=1/, { timeout: 15000 }), page.getByRole("button", { name: "Create league" }).click()]);
const slug2 = page.url().match(/\/l\/([^/]+)\//)?.[1];
await page.goto(`${BASE}/l/${slug2}/admin/schedule`, { waitUntil: "networkidle" });
ok((await page.locator("text=Generate schedule").count()) > 0 && (await page.locator("text=Draw partners").count()) === 0, "a team league keeps its schedule generator");
await page.goto(`${BASE}/l/${slug2}/teams`, { waitUntil: "networkidle" });
ok(page.url().endsWith("/teams"), "a team league keeps its Teams page");

// ---- accessibility, phone width, dark and light ----
console.log("\n== accessibility ==");
const problems = [];
let checked = 0;
for (const theme of ["dark", "light"]) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
  if (theme === "light") await c.addInitScript(() => localStorage.setItem("sweeper-theme", "light"));
  const p = await c.newPage();
  const audit = async (label, u) => {
    await p.waitForTimeout(200);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${theme} ${label}: sideways scroll of ${over}px`);
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }, resultTypes: ["violations"] }));
    checked++;
    for (const v of res.violations) for (const n of v.nodes.slice(0, 3)) problems.push(`${theme} ${label} — ${v.id} (${v.impact}): ${n.target.join(" ")}`);
  };
  for (const u of ["", "/standings", "/bowlers", "/schedule", "/results", mu.replace(`/l/${slug}`, ""), xmu.replace(`/l/${slug}`, ""), "/rules", "/admin", "/admin/schedule", "/admin/roster", "/admin/scores?week=1", "/admin/settings?section=rules"]) {
    await p.goto(`${L}${u}`, { waitUntil: "networkidle" });
    await audit(u || "/");
  }
  // The reveal itself (reduced motion shows the finished list), open.
  await p.goto(`${L}/season/2026/week/1`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Watch the draw" }).click();
  await p.locator("dialog.draw-dialog[open]").waitFor();
  await audit("the draw reveal");
  await c.close();
}
ok(problems.length === 0, `no accessibility or overflow problems on ${checked} page checks${problems.length ? ":\n    " + problems.slice(0, 15).join("\n    ") : ""}`);
ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
