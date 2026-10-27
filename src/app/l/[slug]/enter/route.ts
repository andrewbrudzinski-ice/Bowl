import { NextResponse, type NextRequest } from "next/server";
import { getStore } from "@/server/db";
import { leagueBySlug } from "@/server/access";
import { LINK_COOKIE_PREFIX } from "@/server/session";

/** Opens an unlisted league via its private link: validates the token, stores it in a cookie, then redirects inside the league. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const next = req.nextUrl.searchParams.get("next") ?? `/l/${slug}`;
  const league = getStore().read((db) => leagueBySlug(db, slug));
  const dest = next.startsWith(`/l/${slug}`) && !next.startsWith("//") ? next : `/l/${slug}`;
  const res = NextResponse.redirect(new URL(dest, req.url));
  if (league && league.visibility === "unlisted" && token === league.shareToken) {
    res.cookies.set(LINK_COOKIE_PREFIX + slug, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  }
  return res;
}
