import { Wordmark } from "@/components/brand";
import { resolveAccent } from "@/components/theme";
import { SweeperIntro } from "@/components/sweeper-intro";
import Link from "next/link";
import { Calculator, ChevronRight, Newspaper, Plus, Sparkles, Trophy } from "lucide-react";
import { createDemoAction, removeDemoAction } from "@/app/actions/leagues";
import { AccountMenu } from "@/components/account-menu";
import { ThemeToggle } from "@/components/theme-toggle";
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
    <div className="wrap pb-16 pt-6 md:pt-8">
      <header className="mb-10 flex items-center justify-between gap-3 md:mb-14">
        <Wordmark className="text-xl" size={36} />
        <nav className="flex items-center gap-2" aria-label="Account">
          {user ? (
            <AccountMenu name={user.name} unread={unread} />
          ) : (
            <>
              <Link href="/login" className="btn btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Create account</Link>
            </>
          )}
        </nav>
      </header>
      <main id="main">
        {error ? <div className="mb-6"><Alert tone="error">{error}</Alert></div> : null}

        {!user ? (
          <>
            <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-14">
              <div>
                <div className="eyebrow !text-[var(--accent-text)]">Bowling league management</div>
                <h1 className="h-display mt-4">Your league, run like a pro.</h1>
                <p className="lede mt-5 max-w-xl">Sweeper clears up the bookkeeping: handicaps that follow your rules, matchup pages that read like game recaps, live standings, records and awards — for the league you actually bowl in.</p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/register" className="btn btn-primary btn-lg">Get started</Link>
                  <Link href="/login" className="btn btn-lg">Sign in</Link>
                </div>
              </div>
              <div className="stage"><SweeperIntro className="mx-auto w-full" /></div>
            </section>

            <section aria-label="What you get" className="mt-16 grid gap-4 md:mt-24 md:grid-cols-3 md:gap-5">
              {[
                { Icon: Calculator, title: "Handicaps that follow your rules", body: "Base, percentage, caps and new-bowler policies are yours to set, with every calculation shown so nobody has to take it on faith." },
                { Icon: Newspaper, title: "Matchups that read like recaps", body: "Each week gets a box score, the story of the night and how the result was decided, ready to share with the whole league." },
                { Icon: Trophy, title: "Standings, records and awards", body: "Live standings with tie-breaks explained, a record book, bowler profiles and weekly awards, all computed from the scores you enter." },
              ].map(({ Icon, title, body }) => (
                <div key={title} className="card feature">
                  <span className="feature-icon"><Icon size={20} aria-hidden /></span>
                  <h2 className="h-section text-[17px]">{title}</h2>
                  <p className="muted mt-2 text-[14px]">{body}</p>
                </div>
              ))}
            </section>
          </>
        ) : (
          <section className="mb-10">
            <div className="eyebrow">Welcome back</div>
            <h1 className="h-page mt-1">{user.name.split(" ")[0]}, pick up where you left off.</h1>
          </section>
        )}

        {user ? (
          <section aria-labelledby="mine" className="mb-12">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 id="mine" className="h-section text-[20px]">Your leagues</h2>
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
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map(({ league, role }) => (
                  <li key={league.id} className="card card-link relative p-5">
                    <Link href={`/l/${league.slug}`} className="flex items-center gap-4 after:absolute after:inset-0 after:rounded-[20px]">
                      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-[#241707] shadow-sm" style={{ background: resolveAccent(league.accent) }} aria-hidden>{league.logoText}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] font-bold tracking-tight">{league.name}</span>
                        <span className="muted block text-[13px]">{ROLE_LABELS[role]}{league.isDemo ? " · Demo data" : ""}</span>
                      </span>
                      <ChevronRight size={18} aria-hidden className="shrink-0 text-faint" />
                    </Link>
                    {league.isDemo && (role === "owner" || role === "commissioner") ? (
                      <form action={removeDemoAction.bind(null, league.id)} className="relative z-10 mt-4"><button className="btn btn-danger btn-sm" type="submit">Remove demo data</button></form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {pub.length ? (
          <section aria-labelledby="pub" className={user ? "" : "mt-16 md:mt-24"}>
            <h2 id="pub" className="h-section mb-5 text-[20px]">Public leagues</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {pub.map((l) => (
                <li key={l.id} className="card card-link p-5">
                  <Link href={`/l/${l.slug}`} className="flex items-center gap-4">
                    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-sm font-extrabold text-[#241707] shadow-sm" style={{ background: resolveAccent(l.accent) }} aria-hidden>{l.logoText}</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-[16px] font-bold tracking-tight">{l.name}</span><span className="muted line-clamp-1 text-[13px]">{l.description || "Public standings and results"}</span></span>
                    <ChevronRight size={18} aria-hidden className="shrink-0 text-faint" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="muted text-[13px]">Sweeper · built for league night</p>
        <ThemeToggle compact />
      </footer>
    </div>
  );
}
