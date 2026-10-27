import type { LeagueCtx } from "@/server/context";

export const L = {
  home: (slug: string) => `/l/${slug}`,
  to: (slug: string, path: string, season?: string | null) => `/l/${slug}${path}${season ? `?season=${season}` : ""}`,
  week: (slug: string, seasonSlug: string, n: number) => `/l/${slug}/season/${seasonSlug}/week/${n}`,
  matchup: (slug: string, id: string) => `/l/${slug}/matchup/${id}`,
  bowler: (slug: string, id: string, season?: string | null) => `/l/${slug}/bowlers/${id}${season ? `?season=${season}` : ""}`,
  team: (slug: string, id: string, season?: string | null) => `/l/${slug}/teams/${id}${season ? `?season=${season}` : ""}`,
};

export function seasonParam(ctx: LeagueCtx, explicit?: string | null) {
  // Only carry ?season when viewing a non-current season.
  const cur = ctx.seasons.find((s) => s.status === "active") ?? ctx.seasons[0];
  const s = explicit ?? ctx.season?.slug;
  return s && cur && s !== cur.slug ? s : null;
}
