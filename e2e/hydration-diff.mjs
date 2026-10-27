// Finds what differs between the server HTML and the hydrated page when React reports a hydration error (#418).
// Loads PATH repeatedly: once with every <script src> stripped (so nothing hydrates — this is the server's own HTML after streaming),
// once normally. When the normal load logs a hydration error, prints the elements that differ.
// Usage: BASE=http://localhost:3000 EMAIL=… PASSWORD=… PATH_=/l/<slug>/season/2026/week/6 [TRIES=60] [PHONE=1] node e2e/hydration-diff.mjs
import { chromium } from "playwright";
const { BASE = "http://localhost:3000", EMAIL, PASSWORD, PATH_, TRIES = "60", PHONE } = process.env;
if (!EMAIL || !PASSWORD || !PATH_) throw new Error("Set EMAIL, PASSWORD and PATH_");
const browser = await chromium.launch();
const mk = async () => {
  const ctx = await browser.newContext({ viewport: PHONE ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
  if (PHONE) await ctx.addInitScript(() => Object.defineProperty(navigator, "share", { value: () => Promise.resolve(), configurable: true }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await Promise.all([page.waitForURL(`${BASE}/`), page.click("button[type=submit]")]);
  return { ctx, page };
};
const tokens = (page) =>
  page.evaluate(() => {
    const out = [];
    const skip = new Set(["script", "style", "template", "link", "meta", "noscript"]);
    const walk = (n, path) => {
      if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) out.push({ k: "text", v: t, at: path }); }
      else if (n.nodeType === 1) {
        const tg = n.tagName.toLowerCase();
        if (skip.has(tg)) return;
        const attrs = [...n.attributes].filter((a) => !/^(data-|style$|class$)/.test(a.name)).map((a) => `${a.name}=${a.value}`).sort().join(" ");
        out.push({ k: "el", v: `<${tg}${attrs ? " " + attrs : ""}>`, at: path });
        let i = 0;
        n.childNodes.forEach((c) => walk(c, `${path}>${tg}${n.id ? "#" + n.id : ""}[${i++}]`));
      }
    };
    walk(document.body, "body");
    return out;
  });
const ssr = await mk();
await ssr.ctx.route("**/*", async (route) => {
  if (route.request().resourceType() !== "document") return route.continue();
  const res = await route.fetch();
  let body = await res.text();
  body = body.replace(/<script[^>]*\ssrc=[^>]*><\/script>/g, "");
  return route.fulfill({ response: res, body });
});
const live = await mk();
let found = false;
for (let i = 1; i <= Number(TRIES) && !found; i++) {
  const errs = [];
  live.page.removeAllListeners("pageerror");
  live.page.on("pageerror", (e) => /#418|hydrat/i.test(e.message) && errs.push(e.message.slice(0, 60)));
  await live.page.goto(`${BASE}${PATH_}`, { waitUntil: "networkidle" });
  await live.page.waitForTimeout(900);
  if (!errs.length) continue;
  found = true;
  const hydrated = await tokens(live.page);
  await ssr.page.goto(`${BASE}${PATH_}`, { waitUntil: "networkidle" });
  await ssr.page.waitForTimeout(600);
  const server = await tokens(ssr.page);
  console.log(`Hydration error on try ${i}: server ${server.length} nodes vs hydrated ${hydrated.length}`);
  let a = 0;
  const diffs = [];
  let j = 0;
  while ((a < server.length || j < hydrated.length) && diffs.length < 12) {
    const s = server[a], h = hydrated[j];
    if (s && h && s.k === h.k && s.v === h.v) { a++; j++; continue; }
    // resync: look ahead for the next match within a window
    const look = 40;
    let ns = -1, nh = -1;
    outer: for (let d = 1; d <= look; d++) {
      for (let x = 0; x <= d; x++) {
        const sa = server[a + x], ha = hydrated[j + d - x];
        if (sa && ha && sa.k === ha.k && sa.v === ha.v) { ns = x; nh = d - x; break outer; }
      }
    }
    if (ns < 0) { diffs.push({ server: server.slice(a, a + 3), hydrated: hydrated.slice(j, j + 3) }); break; }
    diffs.push({ server: server.slice(a, a + ns), hydrated: hydrated.slice(j, j + nh) });
    a += ns; j += nh;
  }
  for (const d of diffs) {
    console.log("\n--- differs at", (d.server[0] || d.hydrated[0] || {}).at);
    console.log("  server  :", d.server.map((t) => t.v.slice(0, 90)));
    console.log("  hydrated:", d.hydrated.map((t) => t.v.slice(0, 90)));
  }
}
if (!found) console.log(`No hydration error in ${TRIES} loads of ${PATH_}`);
await browser.close();
process.exit(found ? 2 : 0);
