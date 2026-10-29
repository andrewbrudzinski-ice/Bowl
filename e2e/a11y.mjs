// Accessibility audit with axe-core. Usage: BASE=http://localhost:3000 EMAIL=… PASSWORD=… SLUG=… node e2e/a11y.mjs
// Runs WCAG 2.0/2.1 A + AA and best-practice rules on the main pages in both themes (dark is the default; light is opt-in) at phone width,
// and fails on any violation: color contrast, missing labels or landmarks, heading order, invalid lists, nested interactive controls.
import { chromium } from "playwright";
import fs from "node:fs";
import { createRequire } from "node:module";

const { BASE = "http://localhost:3000", EMAIL, PASSWORD, SLUG } = process.env;
if (!EMAIL || !PASSWORD || !SLUG) throw new Error("Set EMAIL, PASSWORD and SLUG");
const AXE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const L = `/l/${SLUG}`;
const OUT = ["/", "/login", "/register", "/forgot", "/nonexistent-page"];
const IN = ["/", "/account", "/notifications", "/leagues/new", L, `${L}/standings`, `${L}/schedule`, `${L}/bowlers`, `${L}/teams`, `${L}/stats`, `${L}/stats?tab=records`, `${L}/stats?tab=awards&week=3`, `${L}/stats?tab=insights`, `${L}/stats?tab=trends`, `${L}/results`, `${L}/timeline`, `${L}/news`, `${L}/history`, `${L}/rules`, `${L}/season/2026/week/3`, `${L}/admin`, `${L}/admin/scores?week=7`, `${L}/admin/roster`, `${L}/admin/schedule`, `${L}/admin/settings`, `${L}/admin/settings?section=rules`, `${L}/admin/settings?section=appearance`, `${L}/admin/settings?section=awards`, `${L}/admin/members`, `${L}/admin/news`, `${L}/admin/seasons`, `${L}/admin/data`, `${L}/admin/audit`];

const browser = await chromium.launch();
const problems = [];
let checked = 0;
async function audit(ctx, urls, who, theme) {
  const page = await ctx.newPage();
  for (const u of urls) {
    await page.goto(BASE + u, { waitUntil: "networkidle" });
    await page.waitForTimeout(200);
    await page.addScriptTag({ content: AXE });
    const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "best-practice"] }, resultTypes: ["violations"] }));
    checked++;
    for (const v of res.violations) {
      for (const n of v.nodes.slice(0, 3)) {
        const d = n.any[0]?.data;
        problems.push(`${theme} ${who}${u} — ${v.id} (${v.impact}): ${n.target.join(" ")}${d?.contrastRatio ? ` ${d.fgColor} on ${d.bgColor} = ${d.contrastRatio}` : ""}`);
      }
    }
  }
  await page.close();
}
for (const theme of ["dark", "light"]) {
  const mk = async () => {
    const c = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    if (theme === "light") await c.addInitScript(() => localStorage.setItem("sweeper-theme", "light"));
    return c;
  };
  await audit(await mk(), OUT, "signed-out ", theme);
  const c = await mk();
  const p = await c.newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", EMAIL);
  await p.fill("#password", PASSWORD);
  await Promise.all([p.waitForURL(`${BASE}/`), p.click("button[type=submit]")]);
  await p.close();
  await audit(c, IN, "signed-in ", theme);
}
await browser.close();
if (problems.length) {
  console.log(`${problems.length} accessibility problem(s) across ${checked} page checks:`);
  for (const x of problems.slice(0, 40)) console.log("  ✗", x);
  process.exit(1);
}
console.log(`ALL OK: no axe violations on ${checked} page checks (dark + light, phone width)`);
