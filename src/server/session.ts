import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { sessionUser } from "./auth";
import { getStore, type User } from "./db";
import type { Actor } from "./access";

export const SESSION_COOKIE = "bowl_session";

export const getUser = cache(async (): Promise<User | null> => {
  const jar = await cookies();
  return sessionUser(getStore(), jar.get(SESSION_COOKIE)?.value);
});

export async function getActor(): Promise<Actor | null> {
  const u = await getUser();
  return u ? { id: u.id, name: u.name, email: u.email } : null;
}

export async function requireActor(next?: string): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return a;
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export const LINK_COOKIE_PREFIX = "bowl_link_";

export { notFound };
