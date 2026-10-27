"use server";
import { redirect } from "next/navigation";
import { changePassword, loginWithLockout, logout, registerUser, requestPasswordReset, resetPassword } from "@/server/auth";
import { getStore } from "@/server/db";
import { cookies } from "next/headers";
import { acceptInvitation } from "@/server/services/leagues";
import { markNotificationsRead, updatePrefs, updateProfile } from "@/server/services/content";
import { appUrl, sendMail } from "@/server/mailer";
import { SESSION_COOKIE, clearSessionCookie, requireActor, setSessionCookie } from "@/server/session";
import { run, safeNext, str, bool, type ActionState } from "./util";

export async function registerAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const { token } = registerUser(getStore(), { email: str(fd, "email"), name: str(fd, "name"), password: String(fd.get("password") ?? "") });
    await setSessionCookie(token);
    redirect(safeNext(str(fd, "next"), "/"));
  });
}

export async function loginAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const { token } = loginWithLockout(getStore(), str(fd, "email"), String(fd.get("password") ?? ""));
    await setSessionCookie(token);
    redirect(safeNext(str(fd, "next"), "/"));
  });
}

export async function logoutAction() {
  const jar = await cookies();
  logout(getStore(), jar.get(SESSION_COOKIE)?.value);
  await clearSessionCookie();
  redirect("/");
}

export async function forgotAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const res = requestPasswordReset(getStore(), str(fd, "email"));
    if (res) await sendMail({ to: res.user.email, subject: "Reset your Bowl password", text: `Use this link within 60 minutes to choose a new password:\n\n${appUrl(`/reset/${res.token}`)}\n\nIf you didn't ask for this, ignore this email.` });
    // Identical response whether or not the account exists.
    return { ok: true, message: "If an account exists for that email, a reset link is on its way. In development the link is printed in the server console." };
  });
}

export async function resetAction(_: ActionState, fd: FormData) {
  return run(async () => {
    resetPassword(getStore(), str(fd, "token"), String(fd.get("password") ?? ""));
    redirect("/login?reset=1");
  });
}

export async function acceptInviteAction(token: string) {
  const actor = await requireActor(`/invite/${token}`);
  let slug = "";
  const r = await run(async () => {
    slug = acceptInvitation(getStore(), actor, token).slug;
  });
  if (r?.error) redirect(`/invite/${token}?error=${encodeURIComponent(r.error)}`);
  redirect(`/l/${slug}`);
}

export async function profileAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const actor = await requireActor();
    updateProfile(getStore(), actor.id, str(fd, "name"));
    return { ok: true, message: "Profile updated." };
  });
}

export async function passwordAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const actor = await requireActor();
    changePassword(getStore(), actor.id, String(fd.get("current") ?? ""), String(fd.get("next") ?? ""));
    return { ok: true, message: "Password changed." };
  });
}

export async function prefsAction(_: ActionState, fd: FormData) {
  return run(async () => {
    const actor = await requireActor();
    updatePrefs(getStore(), actor.id, {
      results: bool(fd, "results"), schedule: bool(fd, "schedule"), announcements: bool(fd, "announcements"),
      rules: bool(fd, "rules"), invitations: bool(fd, "invitations"), playoffs: bool(fd, "playoffs"), email: bool(fd, "email"),
    });
    return { ok: true, message: "Notification settings saved." };
  });
}

export async function markReadAction() {
  const actor = await requireActor();
  markNotificationsRead(getStore(), actor.id);
  redirect("/notifications");
}
