import Link from "next/link";
import { passwordAction, prefsAction, profileAction } from "@/app/actions/auth";
import { ActionForm } from "@/components/action-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardHead } from "@/components/ui";
import { requireActor, getUser } from "@/server/session";
import { getStore } from "@/server/db";
import { ROLE_LABELS } from "@/server/permissions";
import { listUserLeagues } from "@/server/services/leagues";

export const metadata = { title: "Account" };

const PREFS: [string, string, string][] = [
  ["results", "Weekly results finalized", "When every matchup in a week is final."],
  ["schedule", "Schedule changes", "New schedules, rescheduled or postponed weeks."],
  ["announcements", "Announcements", "Posts from the commissioner."],
  ["rules", "Rule changes", "When the league's rules are updated."],
  ["playoffs", "Playoffs & championship", "Brackets, rounds and the champion."],
  ["invitations", "League invitations", "When someone invites you to a league."],
];

export default async function Account() {
  await requireActor("/account");
  const user = (await getUser())!;
  const leagues = await listUserLeagues(getStore(), user.id);
  return (
    <main id="main" className="wrap max-w-3xl py-8">
      <Link href="/" className="muted text-[13px] hover:text-fg">← Home</Link>
      <h1 className="h-page mb-4 mt-2">Account</h1>
      <div className="grid gap-6 md:gap-8">
        <Card><CardHead title="Appearance" /><div className="grid gap-3 p-5"><p className="muted text-[14px]">Sweeper is dark by default. Switch to light, or choose Auto to follow your phone or computer setting. This applies to this device only.</p><div><ThemeToggle /></div></div></Card>
        <Card><CardHead title="Profile" /><div className="p-5"><ActionForm action={profileAction} submit="Save profile"><div className="field"><label htmlFor="name">Display name</label><input id="name" name="name" defaultValue={user.name} className="input" required maxLength={80} /></div><div className="field"><label htmlFor="acct-email">Email</label><input id="acct-email" className="input" value={user.email} readOnly aria-readonly /><span className="help">Your sign-in email can't be changed here.</span></div></ActionForm></div></Card>
        <Card><CardHead title="Notifications" /><div className="p-5"><ActionForm action={prefsAction} submit="Save notification settings">
          {PREFS.map(([k, label, help]) => <label key={k} className="check items-start"><input type="checkbox" name={k} defaultChecked={(user.prefs as unknown as Record<string, boolean>)[k]} className="mt-0.5" /><span><span className="font-semibold">{label}</span><span className="help block">{help}</span></span></label>)}
          <label className="check items-start border-t border-line pt-3"><input type="checkbox" name="email" defaultChecked={user.prefs.email} className="mt-0.5" /><span><span className="font-semibold">Also send by email</span><span className="help block">Only works when the site operator has configured an email provider; in-app notifications always work.</span></span></label>
        </ActionForm></div></Card>
        <Card><CardHead title="Change password" /><div className="p-5"><ActionForm action={passwordAction} submit="Change password"><div className="field"><label htmlFor="current">Current password</label><input id="current" name="current" type="password" autoComplete="current-password" required className="input" /></div><div className="field"><label htmlFor="next">New password</label><input id="next" name="next" type="password" autoComplete="new-password" minLength={8} required className="input" /></div></ActionForm></div></Card>
        <Card><CardHead title="Your leagues" /><ul className="divide-y divide-line">{leagues.length === 0 ? <li className="muted px-4 py-3 text-[13px]">You're not in any leagues.</li> : leagues.map(({ league, role }) => <li key={league.id} className="flex items-center justify-between px-4 py-2.5 text-[13px]"><Link className="font-semibold hover:underline" href={`/l/${league.slug}`}>{league.name}</Link><span className="muted">{ROLE_LABELS[role]}</span></li>)}</ul></Card>
      </div>
    </main>
  );
}
