import Link from "next/link";
import { Bell } from "lucide-react";
import { logoutAction } from "@/app/actions/auth";
import { ThemeToggle } from "@/components/theme-toggle";

/** Header controls for a signed-in person outside a league: the notification bell and an account menu (profile, sign out, light/dark). */
export function AccountMenu({ name, unread }: { name: string; unread: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <div className="flex items-center gap-2">
      <Link href="/notifications" className="btn btn-ghost btn-sm relative !px-2.5" aria-label={unread ? `${unread} unread notifications` : "Notifications"}>
        <Bell size={18} aria-hidden />
        {unread ? <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[10px] font-extrabold text-[var(--accent-ink)]">{unread > 9 ? "9+" : unread}</span> : null}
      </Link>
      <details className="relative">
        <summary className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong bg-raised text-[14px] font-bold shadow-sm transition-colors hover:bg-hover" aria-label="Account menu">
          {initial}
        </summary>
        <div className="card absolute right-0 top-12 z-40 w-64 p-3 !shadow-[var(--shadow-lg)]">
          <div className="muted px-1 pb-3 text-[13px]">Signed in as <span className="font-semibold text-fg">{name}</span></div>
          <div className="grid gap-2">
            <Link href="/account" className="btn btn-sm justify-start">Account & notifications</Link>
            <form action={logoutAction}><button className="btn btn-sm w-full justify-start" type="submit">Sign out</button></form>
          </div>
          <div className="mt-3 border-t border-line px-1 pt-3">
            <div className="eyebrow mb-2">Appearance</div>
            <ThemeToggle />
          </div>
        </div>
      </details>
    </div>
  );
}
