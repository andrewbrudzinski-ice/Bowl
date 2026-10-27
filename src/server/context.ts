import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { normalizeConfig, type RuleConfig } from "@/domain/config";
import { buildSeasonModel, type SeasonData, type SeasonModel } from "@/domain/engine";
import type { League, Role, Season } from "@/domain/types";
import { currentSeason, leagueBySlug, leagueSeasons, resolveAccess, seasonData, type Access, type Actor } from "./access";
import { getStore } from "./db";
import { roleCan, type Permission } from "./permissions";
import { LINK_COOKIE_PREFIX, getActor } from "./session";

export interface LeagueCtx {
  actor: Actor | null;
  league: League;
  access: Access;
  role: Role | null;
  isMember: boolean;
  /** True when the viewer is reading through public/unlisted access rather than membership. */
  anonymousView: boolean;
  can: (p: Permission) => boolean;
  seasons: Season[];
  season: Season | null;
  data: SeasonData | null;
  model: SeasonModel | null;
  /** The rules currently in force for this season (latest version). */
  cfg: RuleConfig;
  /** Config in effect for the week being displayed on the page; same as cfg unless a page overrides it. */
  seasonQuery: string;
}

export interface LeagueCtxOpts {
  seasonSlug?: string | null;
  /** Page requires a given permission (admin pages). Non-permitted members get 404 rather than a hint. */
  need?: Permission;
  next?: string;
}

export const getLeagueCtx = cache(async (slug: string, seasonSlug?: string | null, need?: Permission): Promise<LeagueCtx> => {
  const store = getStore();
  const actor = await getActor();
  const jar = await cookies();
  const token = jar.get(LINK_COOKIE_PREFIX + slug)?.value ?? null;
  const resolved = await store.read((db) => {
    const league = leagueBySlug(db, slug);
    if (!league) return null;
    const access = resolveAccess(db, league, actor, token);
    if (!access.via) return { league, access, seasons: [] as Season[], season: null as Season | null, data: null as SeasonData | null };
    const seasons = leagueSeasons(db, league.id);
    const season = (seasonSlug ? seasons.find((s) => s.slug === seasonSlug) : currentSeason(db, league.id)) ?? null;
    const data = season ? seasonData(db, league.id, season.id) : null;
    return { league, access, seasons, season, data };
  });
  if (!resolved) notFound();
  if (!resolved.access.via) {
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/l/${slug}`)}`);
    notFound(); // private league: indistinguishable from a missing one
  }
  const role = resolved.access.role;
  const can = (p: Permission) => roleCan(role, p);
  if (need && !can(need)) {
    if (!actor) redirect(`/login?next=${encodeURIComponent(`/l/${slug}/admin`)}`);
    notFound();
  }
  const model = resolved.data ? buildSeasonModel(resolved.data) : null;
  const cfg = resolved.season ? normalizeConfig(resolved.season.ruleVersions[resolved.season.ruleVersions.length - 1].config) : resolved.league.defaultConfig;
  return {
    actor,
    league: resolved.league,
    access: resolved.access,
    role,
    isMember: resolved.access.via === "member",
    anonymousView: resolved.access.via !== "member",
    can,
    seasons: resolved.seasons,
    season: resolved.season,
    data: resolved.data,
    model,
    cfg,
    seasonQuery: seasonSlug ? `?season=${seasonSlug}` : "",
  };
});
