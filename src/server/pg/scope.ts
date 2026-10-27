import type { Scope } from "../db";
import type { CollectionName } from "./codecs";

/** A WHERE clause (without the keyword) and its parameters. `null` means "no restriction: load the full table". */
export interface Filter {
  where: string;
  params: unknown[];
}

const SEASONS_OF = (p: string) => `select id from seasons where league_id = ${p}::uuid`;
const MATCHUPS_OF = (p: string) => `select m.id from matchups m join seasons s on s.id = m.season_id where s.league_id = ${p}::uuid`;

/**
 * Translates a scope into the row filter for one collection. Facets are OR-ed; a collection with no applicable facet
 * yields `false` (nothing is loaded), unless it is listed in `scope.all`.
 * `leagueId` must already be resolved (slug → id) by the caller.
 */
export function filterFor(collection: CollectionName, scope: Scope | undefined): Filter | null {
  if (!scope || scope.all?.includes(collection)) return null;
  const params: unknown[] = [];
  const p = (v: unknown) => `$${params.push(v)}`;
  const conds: string[] = [];
  const L = scope.leagueId;
  const U = scope.userIds?.length ? scope.userIds : undefined;
  const E = scope.emails?.length ? scope.emails : undefined;
  const T = scope.tokenHash;
  const S = scope.leagueSlug;

  switch (collection) {
    case "leagues":
      if (L) conds.push(`id = ${p(L)}::uuid`);
      if (S) conds.push(`slug = ${p(S)}`);
      if (U) conds.push(`id in (select league_id from memberships where user_id = any(${p(U)}::uuid[]))`);
      if (U) conds.push(`id in (select league_id from notifications where user_id = any(${p(U)}::uuid[]))`);
      if (T) conds.push(`id in (select league_id from invitations where token_hash = ${p(T)})`);
      if (scope.publicLeagues) conds.push(`(visibility = 'public' and archived_at is null)`);
      break;
    case "users":
      if (U) conds.push(`id = any(${p(U)}::uuid[])`);
      if (E) conds.push(`email = any(${p(E)}::text[])`);
      if (L) conds.push(`id in (select user_id from memberships where league_id = ${p(L)}::uuid)`);
      if (T) {
        const t = p(T);
        conds.push(`id in (select user_id from sessions where token_hash = ${t})`, `id in (select user_id from reset_tokens where token_hash = ${t})`);
      }
      break;
    case "sessions":
    case "resetTokens": {
      // Rows of the keyed token, of the given users, of the owners of the given emails, and (for sessions) of whoever
      // a reset token belongs to — a password reset signs that person out everywhere.
      if (T) {
        const t = p(T);
        conds.push(`token_hash = ${t}`);
        if (collection === "sessions") conds.push(`user_id in (select user_id from reset_tokens where token_hash = ${t})`);
      }
      if (U) conds.push(`user_id = any(${p(U)}::uuid[])`);
      if (E) conds.push(`user_id in (select id from profiles where email = any(${p(E)}::text[]))`);
      break;
    }
    case "memberships":
      if (L) conds.push(`league_id = ${p(L)}::uuid`);
      if (U) conds.push(`user_id = any(${p(U)}::uuid[])`);
      break;
    case "invitations":
      if (L) conds.push(`league_id = ${p(L)}::uuid`);
      if (T) conds.push(`token_hash = ${p(T)}`);
      break;
    case "seasons":
    case "teams":
    case "bowlers":
      if (U && scope.userLeagues?.includes(collection)) conds.push(`league_id in (select league_id from memberships where user_id = any(${p(U)}::uuid[]))`);
    // falls through
    case "announcements":
    case "commissionerAwards":
    case "templates":
    case "importLog":
    case "audit":
      if (L) conds.push(`league_id = ${p(L)}::uuid`);
      break;
    case "roster":
    case "weeks":
    case "matchups":
      if (L) conds.push(`season_id in (${SEASONS_OF(p(L))})`);
      break;
    case "scores":
      if (L) conds.push(`matchup_id in (${MATCHUPS_OF(p(L))})`);
      break;
    case "notifications":
      if (L) conds.push(`league_id = ${p(L)}::uuid`);
      if (U) conds.push(`user_id = any(${p(U)}::uuid[])`);
      break;
    case "idempotency":
      if (L) conds.push(`split_part(key, ':', 1) in (select id::text from (${MATCHUPS_OF(p(L))}) x)`);
      break;
  }
  return { where: conds.length ? conds.map((c) => `(${c})`).join(" or ") : "false", params };
}
