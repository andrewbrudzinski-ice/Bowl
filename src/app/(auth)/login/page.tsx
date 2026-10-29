import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Alert } from "@/components/ui";
import { loginAction } from "@/app/actions/auth";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="h-page mb-2">Sign in</h1>
      <p className="muted mb-6 text-[14px]">Welcome back. Pick up where your league left off.</p>
      {sp.reset ? <div className="mb-3"><Alert tone="ok">Password updated. Sign in with your new password.</Alert></div> : null}
      <ActionForm action={loginAction} submit="Sign in">
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required className="input" /></div>
        <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required className="input" /></div>
      </ActionForm>
      <div className="mt-6 flex justify-between text-[14px]">
        <Link href="/forgot" className="muted hover:text-fg">Forgot password?</Link>
        <Link href={`/register${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ""}`} className="font-semibold text-[var(--accent-text)] underline underline-offset-4">Create an account</Link>
      </div>
    </>
  );
}
