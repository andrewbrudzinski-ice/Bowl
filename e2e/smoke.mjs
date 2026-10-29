// Browser smoke test. Usage: BASE=http://localhost:3000 EMAIL=… PASSWORD=… SLUG=… node e2e/smoke.mjs [shotDir]
import { chromium } from "playwright";

const { BASE = "http://localhost:3000", EMAIL, PASSWORD, SLUG } = process.env;
const shotDir = process.argv[2];
if (!EMAIL || !PASSWORD || !SLUG) throw new Error("Set EMAIL, PASSWORD and SLUG");
const failures = [];
const warnings = [];
const ok = (cond, msg) => { if (!cond) { failures.push(msg); console.log("  ✗", msg); } else console.log("  ✓", msg); };

const browser = await chromium.launch();
for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["mobile", { width: 390, height: 844 }]]) {
  console.log(`\n== ${label} ==`);
  const ctx = await browser.newContext({ viewport });
  // Phones expose native sharing; desktop Chromium doesn't. Server HTML must match the first client render either way (hydration).
  if (label === "mobile") await ctx.addInitScript(() => Object.defineProperty(navigator, "share", { value: () => Promise.resolve(), configurable: true }));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror at ${new URL(page.url()).pathname}: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(404|401|403)/.test(m.text())) errors.push(`console at ${new URL(page.url()).pathname}: ${m.text()}`); });
  // A deterministic bug errors on every load; a rare transient (one load in dozens) should not fail CI. If a page logs an error, reload it
  // twice: fail only if the error comes back, otherwise report it as a warning with the page, so it is visible but not blocking.
  const visit = async (url) => {
    const before = errors.length;
    const res = await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    if (errors.length > before) {
      const first = errors.splice(before);
      let repeats = 0;
      for (let n = 0; n < 2; n++) {
        const b2 = errors.length;
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(400);
        if (errors.length > b2) repeats++;
      }
      if (repeats) errors.push(...first);
      else for (const e of first) warnings.push(`${label}: ${e.slice(0, 160)} (did not recur on 2 reloads)`);
    }
    return res;
  };

  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);

  const paths = ["", "/schedule", "/standings", "/bowlers", "/teams", "/stats", "/stats?tab=records", "/stats?tab=awards&week=3", "/stats?tab=insights", "/stats?tab=trends", "/results", "/timeline", "/news", "/history", "/rules", "/admin", "/admin/scores?week=7", "/admin/roster", "/admin/schedule", "/admin/settings", "/admin/settings?section=rules", "/admin/settings?section=appearance", "/admin/settings?section=awards", "/admin/settings?section=visibility", "/admin/members", "/admin/news", "/admin/seasons", "/admin/data", "/admin/audit", "/standings?season=2025", "/season/2026/week/3", "/history/2025"];
  for (const p of paths) {
    const res = await visit(`${BASE}/l/${SLUG}${p}`);
    ok(res.status() === 200, `${label} ${p || "/"} → ${res.status()}`);
    if (shotDir && label === "mobile" && ["", "/standings", "/admin/scores?week=7", "/bowlers"].includes(p)) await page.screenshot({ path: `${shotDir}/m${p.replace(/[^a-z0-9]+/gi, "_") || "_home"}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (label === "mobile") ok(overflow <= 1, `mobile ${p || "/"} has no horizontal page scroll (overflow ${overflow}px)`);
  }
  // dynamic pages: first bowler, team, matchup
  const hrefs = async (sel) => page.$$eval(sel, (as) => as.map((a) => a.getAttribute("href")));
  await visit(`${BASE}/l/${SLUG}/bowlers`);
  const bowler = (await hrefs(`a[href^="/l/${SLUG}/bowlers/"]`))[0];
  for (const p of [bowler, bowler + (bowler.includes("?") ? "&" : "?") + "view=career"]) { const r = await visit(BASE + p); ok(r.status() === 200, `${label} ${p} → ${r.status()}`); }
  await visit(`${BASE}/l/${SLUG}/teams`);
  const team = (await hrefs(`a[href^="/l/${SLUG}/teams/"]`))[0];
  { const r = await visit(BASE + team); ok(r.status() === 200, `${label} ${team} → ${r.status()}`); }
  await visit(`${BASE}/l/${SLUG}/season/2026/week/6`);
  const mu = (await hrefs(`a[href^="/l/${SLUG}/matchup/"]`))[0];
  { const r = await visit(BASE + mu); ok(r.status() === 200, `${label} ${mu} → ${r.status()}`); }
  { const r = await page.request.get(BASE + mu + "/scorecard"); ok(r.status() === 200 && /image\/png/.test(r.headers()["content-type"] ?? ""), `${label} ${mu}/scorecard renders a PNG (${r.status()})`); }
  ok(errors.length === 0, `${label}: no console/page errors${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""}`);
  await ctx.close();
}

// ---- Score entry flow (desktop): type scores into an unplayed week, save, finalize ----
console.log("\n== score entry flow ==");
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
  await page.goto(`${BASE}/l/${SLUG}/admin/scores?week=${process.env.ENTRY_WEEK ?? 8}`, { waitUntil: "networkidle" });
  const inputs = page.locator("input.score-input");
  const n = await inputs.count();
  ok(n > 0, `entry week shows ${n} score inputs`);
  // first matchup only: keyboard entry using Enter to advance
  const firstMatchupInputs = await page.locator("section").first().locator("input.score-input").count();
  await inputs.first().click();
  for (let i = 0; i < firstMatchupInputs; i++) { await page.keyboard.type(String(150 + (i % 7) * 9)); }
  await page.waitForTimeout(150);
  ok((await page.locator("text=UNSAVED CHANGES").count()) > 0, "unsaved-changes indicator appears");
  // out-of-range value flags error and blocks save
  await inputs.first().fill("999");
  ok((await inputs.first().getAttribute("data-flag")) === "error", "999 is flagged as an error");
  await inputs.first().fill("177");
  await page.getByRole("button", { name: /Save all drafts/ }).click();
  await page.waitForSelector("text=saved as draft", { timeout: 8000 });
  ok(true, "bulk save reports success");
  const section = page.locator("section").first();
  await section.getByRole("button", { name: /Preview & finalize/ }).click();
  await page.waitForSelector("text=Impact on standings", { timeout: 8000 });
  ok(true, "finalize preview shows standings impact");
  await page.getByRole("button", { name: "Finalize result" }).click();
  await page.waitForSelector("text=Finalized. Standings are updated.", { timeout: 8000 });
  ok(true, "finalized from the UI");
  await page.reload({ waitUntil: "networkidle" });
  ok((await page.locator("section").first().locator("input.score-input:not([disabled])").count()) === 0, "finalized matchup is read-only after reload");
  await ctx.close();
}
await browser.close();
if (warnings.length) console.log(`\n⚠ ${warnings.length} transient console error(s) — not failing, but worth a look:\n  ` + warnings.join("\n  "));
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : "\nALL OK");
process.exit(failures.length ? 1 : 0);
