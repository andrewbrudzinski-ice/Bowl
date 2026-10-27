"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BarChart3, BookOpen, CalendarDays, ClipboardList, History, Home, LayoutGrid, Megaphone, MoreHorizontal, ScrollText, Settings2, Shield, Trophy, Users, X } from "lucide-react";

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

export function DesktopNav({ items, home }: { items: NavItem[]; home: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="League" className="pill-nav hidden md:flex md:max-w-full">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="tab" aria-current={isActive(pathname, i, home) ? "page" : undefined}>
          {i.label}
        </Link>
      ))}
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
      <nav aria-label="Primary" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur md:hidden" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <ul className="mx-auto grid max-w-lg grid-cols-5">
          {primary.map((i) => {
            const Icon = ICONS[i.icon] ?? Home;
            const active = isActive(pathname, i, home);
            return (
              <li key={i.href}>
                <Link href={i.href} aria-current={active ? "page" : undefined} className={`flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active ? "text-fg" : "text-muted"}`}>
                  <Icon size={19} aria-hidden className={active ? "text-[var(--accent)]" : ""} />
                  {i.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} className={`flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${restActive ? "text-fg" : "text-muted"}`}>
              <MoreHorizontal size={19} aria-hidden className={restActive ? "text-[var(--accent)]" : ""} />
              More
            </button>
          </li>
        </ul>
      </nav>
      {open ? (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="More">
          <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} tabIndex={-1} />
          <div className="absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-3" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}>
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="eyebrow">More</span>
              <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <ul className="grid grid-cols-2 gap-2">
              {rest.map((i) => {
                const Icon = ICONS[i.icon] ?? Home;
                return (
                  <li key={i.href}>
                    <Link href={i.href} aria-current={isActive(pathname, i, home) ? "page" : undefined} className="card card-link flex items-center gap-2 px-3 py-3 text-[13px] font-semibold aria-[current=page]:border-[var(--accent)]">
                      <Icon size={16} aria-hidden className="text-muted" />
                      {i.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {extra ? <div className="mt-3 border-t border-line pt-3">{extra}</div> : null}
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
        className="select !h-8 !w-[96px] !pl-2 !pr-5 text-xs sm:!w-auto"
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
