import { ActionForm } from "@/components/action-form";
import { resetAction } from "@/app/actions/auth";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (
    <>
      <h1 className="h-page mb-1">Choose a new password</h1>
      <p className="muted mb-4 text-[13px]">You'll be signed out everywhere else.</p>
      <ActionForm action={resetAction} submit="Update password">
        <input type="hidden" name="token" value={token} />
        <div className="field"><label htmlFor="password">New password</label><input id="password" name="password" type="password" minLength={8} required autoComplete="new-password" className="input" /></div>
      </ActionForm>
    </>
  );
}
