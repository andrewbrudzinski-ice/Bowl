// Restores the league's own backup through the real "Restore from a full backup" form, once as exported and once padded past 1 MB.
// Server actions reject bodies over 1 MB unless next.config.mjs raises the limit, which would make backups of any real league unrestorable.
// Usage: BASE=http://localhost:3000 EMAIL=… PASSWORD=… SLUG=… node e2e/restore.mjs
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { BASE = "http://localhost:3000", EMAIL, PASSWORD, SLUG } = process.env;
if (!EMAIL || !PASSWORD || !SLUG) throw new Error("Set EMAIL, PASSWORD and SLUG");
const failures = [];
const ok = (c, m) => { console.log(c ? "  ✓" : "  ✗", m); if (!c) failures.push(m); };

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/login`);
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);

const res = await ctx.request.get(`${BASE}/l/${SLUG}/export/bundle`);
ok(res.status() === 200, `backup downloads (${res.status()})`);
const bundle = JSON.parse(await res.text());
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bowl-restore-"));

for (const [label, padKb] of [["as exported", 0], ["padded past 1 MB", 1100]]) {
  const file = path.join(dir, `backup-${padKb}.json`);
  fs.writeFileSync(file, JSON.stringify(padKb ? { ...bundle, _pad: "x".repeat(padKb * 1024) } : bundle));
  await page.goto(`${BASE}/l/${SLUG}/admin/data`, { waitUntil: "networkidle" });
  await page.setInputFiles("#bf", file);
  await page.fill("#bn", `Restore check ${padKb || "plain"}`);
  await page.getByRole("button", { name: "Restore as a new league" }).click();
  try {
    await page.waitForURL(/\/l\/restore-check-[^/]+\/admin/, { timeout: 20000 });
    ok(true, `backup ${label} (${(fs.statSync(file).size / 1024).toFixed(0)} KB) restores as a new league`);
  } catch {
    ok(false, `backup ${label} (${(fs.statSync(file).size / 1024).toFixed(0)} KB) did not restore; page says: ${(await page.locator("body").innerText()).match(/Something went wrong|too large|isn't valid|Body exceeded/i)?.[0] ?? "(nothing)"}`);
  }
}
await browser.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(failures.length ? `\n${failures.length} FAILURE(S)` : "\nALL OK");
process.exit(failures.length ? 1 : 0);
