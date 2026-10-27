import type { Scope } from "../db";
import type { CollectionName } from "./codecs";
import type { SqlTx } from "./client";

/**
 * Write locking.
 *
 * Every write transaction first takes the *global* advisory lock: **shared** when its scope names what it touches (so scoped
 * writers run side by side), **exclusive** when it has no scope or opts into a full table (`scope.all`), which waits for
 * every scoped writer and blocks new ones. Scoped writers then take one exclusive lock per league and per user they touch,
 * always in sorted order so two transactions can never wait on each other.
 *
 * A row may only be modified by a transaction holding the lock for its owner (league or user); `checkWrites` enforces that,
 * so a call site annotated with too small a scope fails loudly instead of racing silently. Rows created by the transaction are exempt.
 */
const GLOBAL = 7283561;

export interface LockPlan {
  /** True when the transaction holds the global lock exclusively (no scope, or a full-table load). */
  exclusive: boolean;
  /** Named locks taken after the global one, sorted. */
  keys: string[];
  leagues: Set<string>;
  users: Set<string>;
  /** The scope with `leagueSlug` resolved to `leagueId`. */
  scope?: Scope;
}

const uniq = (xs: (string | undefined | null)[]) => [...new Set(xs.filter((x): x is string => !!x))];

/** Works out which locks a scope needs, resolving slugs, emails and tokens to the ids that own the rows. */
export async function planLocks(tx: SqlTx, scope?: Scope): Promise<LockPlan> {
  if (!scope || scope.all?.length) return { exclusive: true, keys: [], leagues: new Set(), users: new Set(), scope };
  let resolved = scope;
  const leagues = new Set<string>();
  const users = new Set<string>(scope.userIds ?? []);
  const keys = new Set<string>();

  if (scope.leagueId) leagues.add(scope.leagueId);
  if (scope.leagueSlug && !scope.leagueId) {
    const { rows } = await tx.query<{ id: string }>("select id from leagues where slug = $1", [scope.leagueSlug]);
    if (rows[0]) {
      leagues.add(rows[0].id);
      resolved = { ...scope, leagueId: rows[0].id };
    }
  }
  if (scope.emails?.length) {
    const { rows } = await tx.query<{ id: string }>("select id from profiles where email = any($1::text[])", [scope.emails]);
    for (const r of rows) users.add(r.id);
    // Serializes two registrations of the same new address (there is no user id to lock yet).
    for (const e of scope.emails) keys.add(`email:${e}`);
  }
  if (scope.tokenHash) {
    const owners = await tx.query<{ user_id: string }>(
      "select user_id from sessions where token_hash = $1 union select user_id from reset_tokens where token_hash = $1",
      [scope.tokenHash]
    );
    for (const r of owners.rows) users.add(r.user_id);
    const inv = await tx.query<{ league_id: string }>("select league_id from invitations where token_hash = $1", [scope.tokenHash]);
    for (const r of inv.rows) leagues.add(r.league_id);
    keys.add(`token:${scope.tokenHash}`);
  }
  for (const l of leagues) keys.add(`league:${l}`);
  for (const u of users) keys.add(`user:${u}`);
  return { exclusive: false, keys: [...keys].sort(), leagues, users, scope: resolved };
}

export async function acquireLocks(tx: SqlTx, plan: LockPlan) {
  if (plan.exclusive) await tx.query("select pg_advisory_xact_lock($1)", [GLOBAL]);
  else await tx.query("select pg_advisory_xact_lock_shared($1)", [GLOBAL]);
  for (const k of plan.keys) await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [k]);
}

type Rec = Record<string, unknown>;
interface Change {
  collection: CollectionName;
  before: Rec[];
}

/** Which league / user owns a row of this collection, where that is recorded on the row itself. */
function owners(collection: CollectionName, r: Rec): { leagues: string[]; users: string[] } | null {
  const s = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (collection) {
    case "leagues":
      return { leagues: uniq([s(r.id)]), users: [] };
    case "users":
      return { leagues: [], users: uniq([s(r.id)]) };
    case "sessions":
    case "resetTokens":
      return { leagues: [], users: uniq([s(r.userId)]) };
    case "memberships":
    case "notifications":
      // A membership belongs to its league and its user; either lock protects it. Same for a notification.
      return { leagues: uniq([s(r.leagueId)]), users: uniq([s(r.userId)]) };
    case "invitations":
    case "seasons":
    case "teams":
    case "bowlers":
    case "announcements":
    case "commissionerAwards":
    case "templates":
    case "importLog":
      return { leagues: uniq([s(r.leagueId)]), users: [] };
    default:
      return null; // owned through a season/matchup; loaded only through a league scope
  }
}

/** Throws if a scoped transaction would modify or delete a row whose owner it does not hold the lock for. */
export function checkWrites(plan: LockPlan, changes: Change[], scope?: Scope) {
  if (plan.exclusive) return;
  for (const c of changes) {
    for (const r of c.before) {
      const o = owners(c.collection, r);
      if (!o) continue;
      const held = o.leagues.some((l) => plan.leagues.has(l)) || o.users.some((u) => plan.users.has(u));
      if (!held) {
        throw new Error(
          `Write outside lock: this transaction modified a ${c.collection} row it does not hold the lock for. Add the owning league or user to its scope: ${JSON.stringify(scope)}`
        );
      }
    }
  }
}
