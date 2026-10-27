import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { forgotAction } from "@/app/actions/auth";

export const metadata = { title: "Reset password" };

export default function Forgot() {
  return (
    <>
      <h1 className="h-page mb-1">Reset your password</h1>
      <p className="muted mb-4 text-[13px]">Enter your email and we'll send a reset link that works for an hour.</p>
      <ActionForm action={forgotAction} submit="Send reset link">
        <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" required autoComplete="email" className="input" /></div>
      </ActionForm>
      <p className="mt-4 text-[13px]"><Link href="/login" className="muted hover:text-fg">Back to sign in</Link></p>
    </>
  );
}
