// Phone-width layout stress test. Fonts differ between machines (a CI runner is not your laptop), so a page that barely fits at
// 390px with one font can overflow with another. This widens every glyph (letter-spacing) and fails if any page scrolls sideways.
// Usage: BASE=http://localhost:3000 EMAIL=… PASSWORD=… SLUG=… [SPACING=0.45px] node e2e/overflow.mjs
import { chromium } from "playwright";
const { BASE = "http://localhost:3000", EMAIL, PASSWORD, SLUG, SPACING = "0.45px" } = process.env;
if (!EMAIL || !PASSWORD || !SLUG) throw new Error("Set EMAIL, PASSWORD and SLUG");
const LS = SPACING;
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:390,height:844}}); const p=await ctx.newPage();
await p.goto(BASE+"/login"); await p.fill("#email",EMAIL); await p.fill("#password",PASSWORD);
await Promise.all([p.waitForURL(BASE+"/"),p.click("button[type=submit]")]);
const paths=["","/schedule","/standings","/bowlers","/teams","/stats","/stats?tab=records","/stats?tab=awards&week=3","/stats?tab=insights","/stats?tab=trends","/results","/timeline","/news","/history","/rules","/admin","/admin/scores?week=7","/admin/roster","/admin/schedule","/admin/settings","/admin/settings?section=rules","/admin/settings?section=appearance","/admin/settings?section=awards","/admin/settings?section=visibility","/admin/members","/admin/news","/admin/seasons","/admin/data","/admin/audit","/standings?season=2025","/season/2026/week/3","/history/2025"];
const bad=[];
for (const x of paths) { await p.goto(`${BASE}/l/${SLUG}${x}`,{waitUntil:"networkidle"}); await p.addStyleTag({content:`body *{letter-spacing:${LS} !important}`}); await p.waitForTimeout(150);
  const o=await p.evaluate(()=>{ const W=window.innerWidth; const clipped=(e)=>{ for(let a=e.parentElement;a&&a!==document.body;a=a.parentElement){ const v=getComputedStyle(a).overflowX; if(v==="auto"||v==="scroll"||v==="hidden") return true; } return false; }; let who=""; for(const e of document.querySelectorAll("body *")){ const r=e.getBoundingClientRect(); if(r.width&&r.right>W+0.5&&!clipped(e)){ who=e.tagName.toLowerCase()+"."+String(e.className).slice(0,40)+" «"+(e.textContent||"").trim().slice(0,40)+"»"; break; } } return {o:document.documentElement.scrollWidth-W,who}; });
  if (o.o>1) bad.push(`${x||"/"}: +${o.o}px ${o.who}`); }
await b.close();
if (bad.length) { console.log(`${bad.length} page(s) scroll sideways at 390px with ${LS} letter-spacing:\n` + bad.join("\n")); process.exit(1); }
console.log(`ALL OK: no page scrolls sideways at 390px with ${LS} letter-spacing (${paths.length} pages)`);
