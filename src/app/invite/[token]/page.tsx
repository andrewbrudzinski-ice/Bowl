import Link from "next/link";
import { acceptInviteAction } from "@/app/actions/auth";
import { Alert, Card } from "@/components/ui";
import { getStore } from "@/server/db";
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from "@/server/permissions";
import { getUser } from "@/server/session";
import { previewInvitation } from "@/server/services/leagues";

export const metadata = { title: "League invitation" };

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const { token } = await params;
  const { error } = await searchParams;
  const inv = previewInvitation(getStore(), token);
  const user = await getUser();
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10">
      <Card>
        <div className="grid gap-3 p-5">
          {!inv || inv.state !== "valid" ? (
            <>
              <h1 className="h-page">This invitation can't be used</h1>
              <p className="muted text-[13px]">{!inv ? "The link is invalid." : inv.state === "expired" ? "It has expired." : inv.state === "revoked" ? "The commissioner cancelled it." : "It was already used."} Ask the commissioner for a new invitation.</p>
              <Link href="/" className="btn">Go home</Link>
            </>
          ) : (
            <>
              <div className="eyebrow">You're invited to join</div>
              <h1 className="h-page">{inv.leagueName}</h1>
              <p className="text-[13px]"><b>{ROLE_LABELS[inv.role]}</b> — <span className="muted">{ROLE_DESCRIPTIONS[inv.role]}</span></p>
              {error ? <Alert tone="error">{error}</Alert> : null}
              {user ? (
                <form action={acceptInviteAction.bind(null, token)} className="grid gap-2"><p className="muted text-xs">Joining as {user.name} ({user.email}).</p><button className="btn btn-primary" type="submit">Join league</button></form>
              ) : (
                <div className="grid gap-2"><Link className="btn btn-primary" href={`/register?next=${encodeURIComponent(`/invite/${token}`)}`}>Create an account to join</Link><Link className="btn" href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>I already have an account</Link></div>
              )}
            </>
          )}
        </div>
      </Card>
    </main>
  );
}
