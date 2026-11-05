// Handicap-setting weeks, end to end in a browser: the first week is bowled scratch to set handicaps. Its scores count toward averages
// and handicaps but not toward points or the standings; week 2 then uses the handicaps they set.
// Usage: BASE=http://localhost:3000 node e2e/handicap-weeks.mjs   (registers its own account)
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

console.log("\n== set up a league with one handicap-setting week ==");
await page.goto(`${BASE}/register`);
await page.fill("#name", "Handicap Tester");
await page.fill("#email", `hcap${Date.now()}@example.com`);
await page.fill("#password", "correct-horse-battery");
await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
await page.goto(`${BASE}/leagues/new`, { waitUntil: "networkidle" });
await page.fill("#name", "Setting Weeks League");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: /Rotating partners league/ }).click();
await page.getByRole("button", { name: "Next" }).click(); // scoring
await page.getByRole("button", { name: "Next" }).click(); // handicap
ok((await page.locator("#f-handicapSetting\\.weeks").inputValue()) === "0", "handicap-setting weeks start at none");
await page.fill("#f-handicapSetting\\.weeks", "1");
await page.getByRole("button", { name: "Next" }).click(); // standings
await page.getByRole("button", { name: "Next" }).click(); // review
ok((await page.locator("text=The first 1 week are bowled scratch").count()) > 0, "the review says the first week is bowled scratch");
await Promise.all([page.waitForURL(/\/admin\?welcome=1/, { timeout: 15000 }), page.getByRole("button", { name: "Create league" }).click()]);
const slug = page.url().match(/\/l\/([^/]+)\//)[1];
const L = `${BASE}/l/${slug}`;

await page.goto(`${L}/admin/roster`, { waitUntil: "networkidle" });
for (const [i, n] of ["Alex Rivera", "Sam Chen", "Jordan Blake", "Taylor Nguyen", "Casey Morgan", "Riley Patel", "Jamie Okafor", "Morgan Reyes"].entries()) {
  await page.fill("#bname", n);
  await page.fill("#bavg", String(150 + i));
  await page.getByRole("button", { name: "Add bowler to this season" }).click();
  await page.waitForSelector(`text=${n}`);
}

const drawWeek = async (week) => {
  await page.goto(`${L}/admin/schedule`, { waitUntil: "networkidle" });
  await page.getByLabel("Week", { exact: true }).selectOption(String(week));
  await page.getByRole("button", { name: `Draw week ${week} partners` }).click();
  const reveal = page.locator("dialog.draw-dialog[open]");
  await reveal.waitFor({ timeout: 10000 });
  await reveal.getByRole("button", { name: /Skip to the end/ }).click();
  await reveal.getByRole("button", { name: "Done" }).click();
};
const bowlWeek = async (week, score) => {
  await page.goto(`${L}/admin/scores?week=${week}`, { waitUntil: "networkidle" });
  const sections = page.locator("section").filter({ has: page.locator("input.score-input") });
  const count = await sections.count();
  for (let s = 0; s < count; s++) {
    const inputs = sections.nth(s).locator("input.score-input:not([disabled])");
    await inputs.first().click();
    for (let i = 0; i < (await inputs.count()); i++) await page.keyboard.type(String(score));
  }
  await page.getByRole("button", { name: /Save all drafts/ }).click();
  await page.waitForSelector("text=saved as draft", { timeout: 10000 });
  await page.reload({ waitUntil: "networkidle" });
  for (let s = 0; s < count; s++) {
    await sections.nth(s).getByRole("button", { name: /Preview & finalize/ }).click();
    await page.waitForSelector("text=Impact on standings", { timeout: 10000 });
    await page.getByRole("button", { name: "Finalize result" }).click();
    await page.waitForSelector("text=Finalized. Standings are updated.", { timeout: 10000 });
    await page.reload({ waitUntil: "networkidle" });
  }
  return count;
};

console.log("\n== week 1: scratch, counts toward averages only ==");
await drawWeek(1);
await page.goto(`${L}/admin/schedule`, { waitUntil: "networkidle" });
ok((await page.locator("text=HANDICAP WEEK").count()) > 0, "the schedule marks week 1 as a handicap week");
await page.goto(`${L}/admin/scores?week=1`, { waitUntil: "networkidle" });
ok((await page.locator("text=Handicap-setting week.").count()) > 0, "score entry explains it's a handicap-setting week");
ok((await page.locator("text=hdcp").count()) === 0, "no handicap is shown or applied in week 1");
const n1 = await bowlWeek(1, 200);
ok(n1 === 2, "both matches of week 1 were entered and finalized");

await page.goto(`${L}/standings`, { waitUntil: "networkidle" });
ok((await page.locator("text=Handicap-setting weeks").count()) > 0 && (await page.locator("text=Standings start after the handicap-setting weeks").count()) > 0, "standings explain that week 1 doesn't count and haven't started");
ok((await page.locator("table.tbl").count()) === 0, "there are no standings rows yet");
await page.goto(`${L}/season/2026/week/1`, { waitUntil: "networkidle" });
ok((await page.locator("text=HANDICAP WEEK").count()) > 0 && (await page.locator("text=no points").count()) > 0, "the week page labels the results and gives no points");
ok((await page.locator("text=Standings after week 1").count()) === 0, "no 'standings after week 1' card");
await page.goto(`${L}/bowlers`, { waitUntil: "networkidle" });
ok((await page.locator("td", { hasText: /^200\.0$/ }).count()) >= 8, "every bowler has a 200 average from week 1");

console.log("\n== week 2: handicaps from week 1 apply, and points count ==");
await drawWeek(2);
await page.goto(`${L}/admin/scores?week=2`, { waitUntil: "networkidle" });
ok((await page.locator("text=Handicap-setting week.").count()) === 0, "week 2 isn't a handicap-setting week");
ok((await page.locator("text=hdcp").count()) > 0, "week 2 shows handicaps");
await bowlWeek(2, 190);
await page.goto(`${L}/standings`, { waitUntil: "networkidle" });
ok((await page.locator("table.tbl").first().locator("tbody tr").count()) === 8, "standings list the 8 bowlers once a counted week is final");
const points = await Promise.all([...(await page.locator("table.tbl").first().locator("tbody tr").all())].map(async (r) => Number((await r.locator("td").nth(2).innerText()).trim())));
ok(points.every((p) => p >= 0 && p <= 7) && points.some((p) => p > 0), `only week 2's points are there, 7 at most (${points.join(",")})`);
ok((await page.locator("text=Handicap-setting weeks").count()) > 0, "the standings still say week 1 wasn't counted");

console.log("\n== accessibility ==");
const problems = [];
let checked = 0;
for (const theme of ["dark", "light"]) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", storageState: await ctx.storageState() });
  if (theme === "light") await c.addInitScript(() => localStorage.setItem("sweeper-theme", "light"));
  const p = await c.newPage();
  for (const u of ["/standings", "/schedule", "/season/2026/week/1", "/timeline", "/admin/scores?week=1", "/admin/settings?section=rules"]) {
    await p.goto(`${L}${u}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(200);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 1) problems.push(`${theme} ${u}: sideways scroll of ${over}px`);
    await p.addScriptTag({ content: AXE });
    const res = await p.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }, resultTypes: ["violations"] }));
    checked++;
    for (const v of res.violations) for (const n of v.nodes.slice(0, 3)) problems.push(`${theme} ${u} — ${v.id} (${v.impact}): ${n.target.join(" ")}`);
  }
  await c.close();
}
ok(problems.length === 0, `no accessibility or overflow problems on ${checked} page checks${problems.length ? ":\n    " + problems.slice(0, 12).join("\n    ") : ""}`);
ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
await browser.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
