import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Bell } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { DesktopNav, MobileNav, SeasonSwitcher, type NavItem } from "@/components/league-nav";
import { accentInk } from "@/components/theme";
import { getLeagueCtx } from "@/server/context";
import { getStore } from "@/server/db";
import { unreadCount } from "@/server/services/content";
import { listUserLeagues } from "@/server/services/leagues";

export default async function LeagueLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const ctx = await getLeagueCtx(slug);
  const store = getStore();
  const mine = ctx.actor ? await listUserLeagues(store, ctx.actor.id) : [];
  const unread = ctx.actor ? await unreadCount(store, ctx.actor.id) : 0;
  const base = `/l/${slug}`;
  const items: NavItem[] = [
    { href: base, label: "Home", icon: "home", primary: true },
    { href: `${base}/schedule`, label: "Schedule", icon: "schedule", primary: true, match: [`${base}/season`, `${base}/matchup`] },
    { href: `${base}/standings`, label: "Standings", icon: "standings", primary: true },
    { href: `${base}/bowlers`, label: "Bowlers", icon: "bowlers", primary: true },
    { href: `${base}/teams`, label: "Teams", icon: "teams" },
    { href: `${base}/stats`, label: "Stats", icon: "stats" },
    { href: `${base}/results`, label: "Results", icon: "results" },
    { href: `${base}/timeline`, label: "Timeline", icon: "timeline" },
    { href: `${base}/news`, label: "News", icon: "news" },
    { href: `${base}/history`, label: "History", icon: "history" },
    { href: `${base}/rules`, label: "Rules", icon: "rules" },
  ];
  if (ctx.can("league.view_admin")) items.push({ href: `${base}/admin`, label: "Commissioner", icon: "admin" });
  const style = { "--accent": ctx.league.accent, "--accent-ink": accentInk(ctx.league.accent) } as CSSProperties;
  const accountMenu = ctx.actor ? (
    <div className="grid gap-1.5">
      <div className="muted px-1 text-xs">Signed in as {ctx.actor.name}</div>
      <Link href="/account" className="btn btn-sm justify-start">Account & notifications</Link>
      <Link href="/" className="btn btn-sm justify-start">My leagues</Link>
      <form action={logoutAction}><button className="btn btn-sm w-full justify-start" type="submit">Sign out</button></form>
    </div>
  ) : (
    <Link href={`/login?next=${encodeURIComponent(base)}`} className="btn btn-primary btn-sm">Sign in</Link>
  );
  return (
    <div style={style} className="min-h-dvh pb-20 md:pb-8">
      <header className="no-print sticky top-0 z-30 -mt-[env(safe-area-inset-top)] border-b border-line bg-bg/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="wrap flex h-14 items-center gap-3">
          <details className="relative min-w-0 shrink">
            <summary className="flex cursor-pointer items-center gap-2.5 rounded-lg py-1 pr-2 hover:bg-hover" aria-label="Switch league">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)] text-[13px] font-black text-[var(--accent-ink)]" aria-hidden>
                {ctx.league.logoText}
              </span>
              <span className="min-w-0 text-left leading-tight">
                <span className="block max-w-[34vw] truncate text-[14px] font-bold md:max-w-[240px]">{ctx.league.name}</span>
                <span className="muted block max-w-[34vw] truncate text-[11px] md:max-w-[240px]">{ctx.season?.name ?? "No season yet"}</span>
              </span>
            </summary>
            <div className="card absolute left-0 top-12 z-40 w-64 p-1.5 shadow-xl">
              <div className="eyebrow px-2 py-1">Your leagues</div>
              {mine.length ? mine.map((m) => (
                <Link key={m.league.id} href={`/l/${m.league.slug}`} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover" aria-current={m.league.id === ctx.league.id ? "true" : undefined}>
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[10px] font-black text-[#0a0d12]" style={{ background: m.league.accent }}>{m.league.logoText}</span>
                  <span className="min-w-0 flex-1 truncate">{m.league.name}</span>
                </Link>
              )) : <div className="muted px-2 py-1.5 text-xs">You're browsing as a guest.</div>}
              {ctx.actor ? <Link href="/leagues/new" className="mt-1 block rounded-md border-t border-line px-2 py-2 text-[13px] text-[var(--accent)] hover:bg-hover">+ Create a league</Link> : null}
            </div>
          </details>
          <div className="hidden min-w-0 flex-1 md:block"><DesktopNav items={items} home={base} /></div>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
            <SeasonSwitcher seasons={ctx.seasons.map((s) => ({ slug: s.slug, name: s.name }))} current={ctx.season?.slug ?? null} slug={slug} />
            {ctx.actor ? (
              <Link href="/notifications" className="btn btn-ghost btn-sm relative !px-2" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
                <Bell size={17} aria-hidden />
                {unread ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-extrabold text-[var(--accent-ink)]">{unread > 9 ? "9+" : unread}</span> : null}
              </Link>
            ) : null}
            <details className="relative hidden md:block">
              <summary className="btn btn-sm" aria-label="Account">{ctx.actor ? ctx.actor.name.split(" ")[0] : "Guest"}</summary>
              <div className="card absolute right-0 top-10 z-40 w-56 p-2 shadow-xl">{accountMenu}</div>
            </details>
          </div>
        </div>
      </header>
      {ctx.anonymousView ? (
        <div className="border-b border-line bg-raised text-center text-xs">
          <div className="wrap py-1.5 muted">
            You're viewing this league as a {ctx.access.via === "link" ? "guest with a private link" : "public visitor"}. Admin tools and member info are hidden.{" "}
            {!ctx.actor ? <Link className="text-[var(--accent)]" href={`/login?next=${encodeURIComponent(base)}`}>Sign in</Link> : null}
          </div>
        </div>
      ) : null}
      {ctx.league.isDemo ? (
        <div className="border-b border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_8%,transparent)] text-center text-xs">
          <div className="wrap py-1.5"><span className="font-bold text-warn">DEMO DATA</span> <span className="muted">— every name, score and result in this league is simulated.{ctx.can("demo.reset") ? <> Remove it in <Link className="underline" href={`${base}/admin/seasons`}>Commissioner → Seasons</Link>.</> : null}</span></div>
        </div>
      ) : null}
      <main id="main" className="wrap pt-5">{children}</main>
      <MobileNav items={items} home={base} extra={accountMenu} />
    </div>
  );
}
