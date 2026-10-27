// Registers a new account, creates a league through the wizard, and checks access boundaries.
// Usage: BASE=http://localhost:3100 OTHER_SLUG=<an existing private league> node e2e/wizard.mjs
import { chromium } from "playwright";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OTHER = process.env.OTHER_SLUG;
const fails = [];
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) fails.push(m); };
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const email = `wiz${Date.now()}@example.com`;
await p.goto(`${BASE}/register`);
await p.fill("#name", "Wizard Tester"); await p.fill("#email", email); await p.fill("#password", "correct-horse-battery");
await Promise.all([p.waitForURL(`${BASE}/`), p.click("button[type=submit]")]);
ok(true, "registered and signed in");

await p.goto(`${BASE}/leagues/new`, { waitUntil: "networkidle" });
await p.fill("#name", "Tuesday Rollers");
await p.fill("#teams", "Alpha\nBravo\nCharlie\nDelta");
await p.getByRole("button", { name: "Next" }).click();           // → format
await p.getByRole("button", { name: /Scratch team league/ }).click();
await p.getByRole("button", { name: "Next" }).click();           // → scoring
await p.fill("#f-scoring\\.pointsPerGame", "2");
await p.getByRole("button", { name: "Next" }).click();           // → handicap (scratch template: disabled)
ok(await p.locator("text=Handicap is off").count() > 0, "handicap step shows the scratch league has no handicap");
await p.getByRole("button", { name: "Next" }).click();           // → standings
await p.getByRole("button", { name: "Next" }).click();           // → review
ok(await p.locator("text=Winner earns 2 points").count() > 0, "review summary is generated from the chosen rules (2 points per game)");
await Promise.all([p.waitForURL(/\/admin\?welcome=1/, { timeout: 15000 }), p.getByRole("button", { name: "Create league" }).click()]);
ok(true, "league created; landed on the commissioner overview");
const slug = p.url().match(/\/l\/([^/]+)\//)[1];
await p.goto(`${BASE}/l/${slug}/rules`, { waitUntil: "networkidle" });
ok(await p.locator("text=Winner earns 2 points").count() > 0, "rules page reflects saved settings");

if (OTHER) {
  for (const path of ["", "/admin", "/admin/scores", "/admin/settings", "/admin/audit"]) {
    const r = await p.goto(`${BASE}/l/${OTHER}${path}`);
    ok(r.status() === 404, `non-member gets 404 for private league ${path || "/"} (got ${r.status()})`);
  }
}
const anon = await (await b.newContext()).newPage();
const r = await anon.goto(`${BASE}/l/${slug}`);
ok(r.url().includes("/login"), "signed-out visitor to a private league is sent to sign in");
const r2 = await anon.goto(`${BASE}/l/${slug}/admin`);
ok(r2.url().includes("/login"), "signed-out visitor to admin is sent to sign in");
await b.close();
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : "\nALL OK");
process.exit(fails.length ? 1 : 0);
