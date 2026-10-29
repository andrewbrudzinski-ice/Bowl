import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { registerAction } from "@/app/actions/auth";

export const metadata = { title: "Create account" };

export default async function Register({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="h-page mb-2">Create your account</h1>
      <p className="muted mb-6 text-[14px]">Joining a league? Make an account, then open your invitation link. You only need to create a league if you're the commissioner.</p>
      <ActionForm action={registerAction} submit="Create account">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div className="field"><label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required maxLength={80} className="input" /></div>
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required className="input" aria-describedby="pw-help" /><span id="pw-help" className="help">At least 8 characters.</span></div>
      </ActionForm>
      <p className="muted mt-6 text-[14px]">Already have an account? <Link href={`/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="text-[var(--accent-text)]">Sign in</Link></p>
    </>
  );
}
