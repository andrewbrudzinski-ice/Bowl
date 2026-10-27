import Link from "next/link";
import { Plus, Sparkles } from "lucide-react";
import { createDemoAction, removeDemoAction } from "@/app/actions/leagues";
import { logoutAction } from "@/app/actions/auth";
import { Alert, Card, EmptyState } from "@/components/ui";
import { getStore } from "@/server/db";
import { getUser } from "@/server/session";
import { listPublicLeagues, listUserLeagues } from "@/server/services/leagues";
import { unreadCount } from "@/server/services/content";
import { ROLE_LABELS } from "@/server/permissions";

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const user = await getUser();
  const store = getStore();
  const mine = user ? await listUserLeagues(store, user.id) : [];
  const pub = (await listPublicLeagues(store)).filter((l) => !mine.some((m) => m.league.id === l.id));
  const unread = user ? await unreadCount(store, user.id) : 0;
  return (
    <div className="wrap py-8">
      <header className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--accent)] text-xl font-black text-[var(--accent-ink)]">B</span>
          <span className="text-xl font-bold tracking-tight">Bowl</span>
        </div>
        <nav className="flex items-center gap-2" aria-label="Account">
          {user ? (
            <>
              <Link href="/notifications" className="btn btn-sm">Notifications{unread ? ` (${unread})` : ""}</Link>
              <Link href="/account" className="btn btn-sm">{user.name.split(" ")[0]}</Link>
              <form action={logoutAction}><button className="btn btn-ghost btn-sm" type="submit">Sign out</button></form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Create account</Link>
            </>
          )}
        </nav>
      </header>
      <main id="main">
        {error ? <div className="mb-4"><Alert tone="error">{error}</Alert></div> : null}
        <section className="mb-8 max-w-2xl">
          <h1 className="text-[34px] font-extrabold leading-tight tracking-tight">Your league, run like a pro.</h1>
          <p className="muted mt-2 text-[15px]">Handicaps that follow your rules, matchup pages that read like game recaps, live standings, records and awards — for the league you actually bowl in.</p>
          {!user ? (
            <div className="mt-4 flex gap-2">
              <Link href="/register" className="btn btn-primary">Get started</Link>
              <Link href="/login" className="btn">Sign in</Link>
            </div>
          ) : null}
        </section>

        {user ? (
          <section aria-labelledby="mine" className="mb-8">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="mine" className="h-section">Your leagues</h2>
              <div className="flex gap-2">
                <form action={createDemoAction}><button className="btn btn-sm" type="submit"><Sparkles size={14} />Try a demo league</button></form>
                <Link href="/leagues/new" className="btn btn-primary btn-sm"><Plus size={14} />Create a league</Link>
              </div>
            </div>
            {mine.length === 0 ? (
              <Card>
                <EmptyState title="You're not in any leagues yet" action={<Link href="/leagues/new" className="btn btn-primary">Create your league</Link>}>
                  Create a league if you're the commissioner. If a friend runs it, open the invitation link they sent you. Want to look around first? Try the demo league — it's clearly labelled and removable.
                </EmptyState>
              </Card>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map(({ league, role }) => (
                  <li key={league.id} className="card card-link relative p-4">
                    <Link href={`/l/${league.slug}`} className="flex items-center gap-3 after:absolute after:inset-0">
                      <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black text-[#0a0d12]" style={{ background: league.accent }} aria-hidden>{league.logoText}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-bold">{league.name}</span>
                        <span className="muted block text-xs">{ROLE_LABELS[role]}{league.isDemo ? " · Demo data" : ""}</span>
                      </span>
                    </Link>
                    {league.isDemo && (role === "owner" || role === "commissioner") ? (
                      <form action={removeDemoAction.bind(null, league.id)} className="relative z-10 mt-3"><button className="btn btn-danger btn-sm" type="submit">Remove demo data</button></form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {pub.length ? (
          <section aria-labelledby="pub">
            <h2 id="pub" className="h-section mb-3">Public leagues</h2>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pub.map((l) => (
                <li key={l.id} className="card card-link p-4">
                  <Link href={`/l/${l.slug}`} className="flex items-center gap-3">
                    <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sm font-black text-[#0a0d12]" style={{ background: l.accent }} aria-hidden>{l.logoText}</span>
                    <span className="min-w-0"><span className="block truncate text-[15px] font-bold">{l.name}</span><span className="muted line-clamp-1 text-xs">{l.description || "Public standings and results"}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
