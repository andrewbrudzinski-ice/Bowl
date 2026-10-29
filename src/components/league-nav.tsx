"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, BookOpen, CalendarDays, ChevronDown, ClipboardList, History, Home, LayoutGrid, Megaphone, MoreHorizontal, ScrollText, Settings2, Shield, Trophy, Users, X } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  primary?: boolean;
  match?: string[];
}

const ICONS: Record<string, typeof Home> = {
  home: Home, schedule: CalendarDays, standings: Trophy, bowlers: Users, teams: Shield, stats: BarChart3, results: ClipboardList,
  history: History, rules: BookOpen, news: Megaphone, admin: Settings2, more: MoreHorizontal, timeline: ScrollText, grid: LayoutGrid,
};

function isActive(pathname: string, item: NavItem, home: string) {
  if (item.href === home) return pathname === home;
  const bases = [item.href, ...(item.match ?? [])];
  return bases.some((b) => pathname === b || pathname.startsWith(b + "/"));
}

/**
 * Desktop tabs: the first pages inline and the rest under a "More" menu, so the bar never overflows. Three tabs show on laptop widths,
 * five on wide screens (tablets in portrait use the bottom tab bar instead); the pages that aren't inline at the current width are listed in the menu.
 */
export function DesktopNav({ items, home }: { items: NavItem[]; home: string }) {
  const pathname = usePathname();
  const ALWAYS = 3;
  const WIDE = 5;
  const rest = items.slice(ALWAYS);
  const moreActive = rest.some((i) => isActive(pathname, i, home));
  const moreRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (moreRef.current) moreRef.current.open = false;
  }, [pathname]);
  return (
    <nav aria-label="League" className="hidden items-center gap-1 lg:flex lg:max-w-full">
      {items.slice(0, WIDE).map((i, idx) => (
        <Link key={i.href} href={i.href} className={`tab ${idx >= ALWAYS ? "hidden xl:inline-flex" : ""}`} aria-current={isActive(pathname, i, home) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
      {rest.length ? (
        <details ref={moreRef} className="relative">
          <summary className="tab" data-active={moreActive ? "true" : undefined}>
            More
            <ChevronDown size={14} aria-hidden className="ml-1 text-faint" />
          </summary>
          <div className="card absolute left-0 top-12 z-40 w-56 p-2 !shadow-[var(--shadow-lg)]">
            {rest.map((i, idx) => {
              const Icon = ICONS[i.icon] ?? Home;
              return (
                <Link key={i.href} href={i.href} aria-current={isActive(pathname, i, home) ? "page" : undefined} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-muted transition-colors hover:bg-hover hover:text-fg aria-[current=page]:bg-raised aria-[current=page]:text-fg ${ALWAYS + idx < WIDE ? "xl:hidden" : ""}`}>
                  <Icon size={16} aria-hidden />
                  {i.label}
                </Link>
              );
            })}
          </div>
        </details>
      ) : null}
    </nav>
  );
}

export function MobileNav({ items, home, extra }: { items: NavItem[]; home: string; extra?: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const primary = items.filter((i) => i.primary);
  const rest = items.filter((i) => !i.primary);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);
  const restActive = rest.some((i) => isActive(pathname, i, home));
  return (
    <>
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/85 backdrop-blur-xl lg:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="mx-auto grid max-w-lg grid-cols-5 px-1">
          {primary.map((i) => {
            const Icon = ICONS[i.icon] ?? Home;
            const active = isActive(pathname, i, home);
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined} className={`flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${active ? "text-fg" : "text-muted"}`}>
                  <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${active ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent-text)]" : ""}`}><Icon size={20} aria-hidden /></span>
                  {i.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`flex h-16 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold transition-colors ${restActive ? "text-fg" : "text-muted"}`}>
              <span className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors ${restActive ? "bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-[var(--accent-text)]" : ""}`}><MoreHorizontal size={20} aria-hidden /></span>
              More
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-[var(--overlay)]" aria-label="Close menu" onClick={() => setOpen(false)} tabIndex={-1} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-3xl border-t border-line bg-surface p-4 shadow-[var(--shadow-lg)]" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
            <div className="mb-3 flex items-center justify-between px-1">
              <span className="eyebrow">More</span>
              <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-3">
              {rest.map((i) => {
                const Icon = ICONS[i.icon] ?? Home;
                return (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={isActive(pathname, i, home) ? "page" : undefined} className="card card-link flex items-center gap-3 px-4 py-3.5 text-sm font-semibold aria-[current=page]:border-[var(--accent)]">
                      <Icon size={16} aria-hidden className="text-muted" />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {extra ? <div className="mt-4 border-t border-line pt-4">{extra}</div> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

export function SeasonSwitcher({ seasons, current, slug }: { seasons: { slug: string; name: string }[]; current: string | null; slug: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const pathSeason = pathname.match(/^\/l\/[^/]+\/season\/([^/]+)/)?.[1];
  const value = pathSeason ?? params.get("season") ?? current ?? "";
  if (seasons.length < 2) return current ? <span className="muted hidden text-xs sm:inline">{seasons.find((s) => s.slug === current)?.name}</span> : null;
  return (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Season</span>
      <select
        className="select !h-9 !w-[100px] !rounded-[10px] !pl-2.5 !pr-6 text-[13px] sm:!w-auto"
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          // Week pages carry the season in the path; everything else uses ?season=
          const m = pathname.match(/^(\/l\/[^/]+)\/season\/[^/]+(\/week\/\d+)?/);
          if (m) router.push(`/l/${slug}/schedule?season=${next}`);
          else {
            const sp = new URLSearchParams(params.toString());
            sp.set("season", next);
            router.push(`${pathname}?${sp.toString()}`);
          }
        }}
      >
        {seasons.map((s) => (
          <option key={s.slug} value={s.slug}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
