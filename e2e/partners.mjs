// Rotating partners, end to end in a browser: create a league from the template, add bowlers, draw a week, enter and finalize scores,
// then check what members see and run an accessibility audit on the pages that change for this kind of league.
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
ok((await page.locator("#f-partners\\.winPoints").inputValue()) === "2", "a pair win is worth 2 points by default");
ok((await page.locator("#f-partners\\.bonusPoints").inputValue()) === "1", "the highest pin count is worth 1 point by default");
await page.fill("#f-partners\\.winPoints", "3");
ok((await page.locator("text=Points each partner earns for a win").count()) > 0, "the partner point settings are shown instead of game/series points");
await page.getByRole("button", { name: "Next" }).click(); // handicap
await page.getByRole("button", { name: "Next" }).click(); // standings
ok((await page.locator("text=Playoffs aren't available with rotating partners yet").count()) > 0, "playoffs are explained as unavailable");
await page.getByRole("button", { name: "Next" }).click(); // review
ok((await page.locator("text=Each partner earns 3 points").count()) > 0, "the review describes the rules in plain language");
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
ok((await page.locator("text=10 bowling: 2 matches, and 2 sit out").count()) > 0, "the form explains the split: 2 matches, 2 sitting out");
await page.getByRole("button", { name: "Nobody" }).click();
ok((await page.locator("text=Pick at least four").count()) > 0, "fewer than four bowlers is explained");
await page.getByRole("button", { name: "Everyone" }).click();
await page.getByRole("button", { name: "Draw week 1 partners" }).click();
await page.waitForSelector("text=Week 1 partners drawn: 2 matches, 2 bowlers sitting out", { timeout: 10000 });
ok(true, "week 1 is drawn");
await page.reload({ waitUntil: "networkidle" });
const week1 = page.locator("section, .card").filter({ hasText: "Week 1" }).first();
const matchLinks = await page.locator(`a[href*="/matchup/"]`).allInnerTexts();
const vs = matchLinks.filter((t) => / vs /.test(t));
const sits = matchLinks.filter((t) => / sits out/.test(t));
ok(vs.length === 2 && sits.length === 2, `week 1 lists 2 matches and 2 bowlers sitting out (${vs.length}, ${sits.length})`);
ok(vs.every((t) => (t.match(/ & /g) ?? []).length === 2), "each side is named after its two partners");
ok((await page.locator("text=(drawn)").count()) > 0, "the week list marks week 1 as drawn");
const weekPick = page.getByLabel("Week", { exact: true });
ok((await weekPick.inputValue()) === "2", "after week 1 is drawn, the form moves on to week 2");
await weekPick.selectOption("1");
ok((await page.locator("text=Partners are already drawn for this week").count()) > 0, "picking a drawn week warns that drawing again replaces it");
await page.getByRole("button", { name: "Draw week 1 again" }).click();
await page.waitForSelector("text=The earlier draw was replaced", { timeout: 10000 });
ok(true, "drawing again replaces the draw before any scores exist");

// ---- score entry ----
console.log("\n== scores ==");
await page.goto(`${L}/admin/scores?week=1`, { waitUntil: "networkidle" });
const sections = page.locator("section").filter({ has: page.locator("input.score-input") });
const nMatches = await sections.count();
ok(nMatches === 2, `score entry shows the 2 matches (${nMatches})`);
for (let s = 0; s < nMatches; s++) {
  const inputs = sections.nth(s).locator("input.score-input");
  const n = await inputs.count();
  ok(n === 12, `match ${s + 1} has 12 score boxes: 4 bowlers × 3 games (${n})`);
  await inputs.first().click();
  // Match 1: its A side bowls well. Match 2: one bowler on side B bowls the best series of the night.
  for (let i = 0; i < n; i++) await page.keyboard.type(String(s === 0 ? (i < 6 ? 190 : 150) : i >= 6 && i < 9 ? 235 : 160));
}
await page.getByRole("button", { name: /Save all drafts/ }).click();
await page.waitForSelector("text=saved as draft", { timeout: 10000 });
for (let s = 0; s < nMatches; s++) {
  await sections.nth(s).getByRole("button", { name: /Preview & finalize/ }).click();
  await page.waitForSelector("text=Impact on standings", { timeout: 10000 });
  await page.getByRole("button", { name: "Finalize result" }).click();
  await page.waitForSelector("text=Finalized. Standings are updated.", { timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
}
ok(true, "both matches finalized from the UI");

// ---- what members see ----
console.log("\n== standings and pages ==");
const visit = async (path) => { const r = await page.goto(`${L}${path}`, { waitUntil: "networkidle" }); await page.waitForTimeout(200); return r.status(); };
ok((await visit("/standings")) === 200, "standings load");
const tbl = page.locator("table.tbl").first();
const rows = await tbl.locator("tbody tr").allInnerTexts();
ok(rows.length === 8, `standings list the 8 bowlers who bowled (${rows.length})`);
ok((await page.locator('th:has-text("Bonus")').count()) === 1, "standings show a Bonus column once a bonus has been earned");
const text = (await tbl.locator("tbody").innerText()).replace(/\s+/g, " ");
const pts = [...(await tbl.locator("tbody tr").all())].map(async (r) => (await r.locator("td").nth(2).innerText()).trim());
const points = await Promise.all(pts);
// Two winning pairs at 3 points a partner, and the bowler with the best series of the night (on a winning pair) earns the bonus on top.
ok(points.join(",") === "4,3,3,3,0,0,0,0", `3 points per winning partner, plus 1 for the best series of the night (points: ${points.join(",")})`);
ok(!/Unknown/.test(text), "no unknown names in the standings");
ok((await visit("/")) === 200 && (await page.locator("text=Standings").count()) > 0, "league home loads with standings");
ok((await visit("/teams")) === 200 && page.url().endsWith("/standings"), "the Teams page sends you to the standings");
ok((await page.locator('a[href$="/teams"]').count()) === 0, "there is no Teams link in the navigation");
ok((await visit("/schedule")) === 200 && (await page.locator("text=sits out").count()) === 0, "the public schedule loads");
ok((await visit("/results")) === 200, "results load");
// A real head-to-head match (not a bowler sitting out), whatever the draw happened to produce.
await visit("/admin/schedule");
const mu = await page.locator(`a[href*="/matchup/"]`, { hasText: " vs " }).first().getAttribute("href");
ok(!!mu && (await visit(mu.replace(`/l/${slug}`, ""))) === 200, "a matchup page loads");
ok((await page.locator("h1").first().innerText()).includes(" & "), "the matchup is titled with both pairs' names");
const sc = await page.request.get(`${BASE}${mu}/scorecard`);
ok(sc.status() === 200 && /image\/png/.test(sc.headers()["content-type"] ?? ""), "the scorecard image renders for a pair matchup");
ok((await visit("/bowlers")) === 200 && (await page.locator('th:has-text("W-L")').count()) === 1 && (await page.locator('th:has-text("Team")').count()) === 0, "bowlers show a W-L record and no team column");
const bowlerHref = await page.locator(`a[href*="/bowlers/"]`).first().getAttribute("href");
ok((await visit(bowlerHref.replace(`/l/${slug}`, ""))) === 200, "a bowler profile loads");
for (const p of ["/stats", "/stats?tab=records", "/stats?tab=awards&week=1", "/stats?tab=insights", "/timeline", "/history", "/rules", "/admin", "/admin/scores?week=1", "/admin/roster", "/admin/settings?section=rules", "/admin/audit"]) ok((await visit(p)) === 200, `${p} loads`);
await visit("/rules");
ok((await page.locator("text=Rotating partners").count()) > 0 && (await page.locator("text=Each partner earns 3 points").count()) > 0, "the public rules page explains rotating partners");
await visit("/admin/audit");
ok((await page.locator("text=partners.drawn").count()) > 0 || (await page.locator("text=drawn").count()) > 0, "the draw is in the audit log");

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
  const mpath = mu.replace(`/l/${slug}`, "");
  for (const u of ["", "/standings", "/bowlers", "/schedule", "/results", mpath, "/rules", "/admin", "/admin/schedule", "/admin/roster", "/admin/scores?week=1", "/admin/settings?section=rules"]) {
    await p.goto(`${L}${u}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(200);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${theme} ${u || "/"}: sideways scroll of ${over}px`);
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }, resultTypes: ["violations"] }));
    checked++;
    for (const v of res.violations) for (const n of v.nodes.slice(0, 3)) problems.push(`${theme} ${u || "/"} — ${v.id} (${v.impact}): ${n.target.join(" ")}`);
  }
  await c.close();
}
ok(problems.length === 0, `no accessibility or overflow problems on ${checked} page checks${problems.length ? ":\n    " + problems.slice(0, 15).join("\n    ") : ""}`);
ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
