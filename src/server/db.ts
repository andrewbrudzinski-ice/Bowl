import fs from "node:fs";
import path from "node:path";
import type {
  AuditEntry,
  Bowler,
  ConfigTemplateRecord,
  Id,
  League,
  Matchup,
  Role,
  RosterEntry,
  Score,
  Season,
  Team,
  Week,
} from "@/domain/types";

export interface NotificationPrefs {
  results: boolean;
  schedule: boolean;
  announcements: boolean;
  rules: boolean;
  invitations: boolean;
  playoffs: boolean;
  email: boolean;
}

export const DEFAULT_PREFS: NotificationPrefs = {
  results: true,
  schedule: true,
  announcements: true,
  rules: true,
  invitations: true,
  playoffs: true,
  email: false,
};

export interface User {
  id: Id;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: string;
  disabled: boolean;
  failed: { count: number; since: string } | null;
  prefs: NotificationPrefs;
}

export interface SessionRecord {
  tokenHash: string;
  userId: Id;
  createdAt: string;
  expiresAt: string;
}

export interface ResetToken {
  tokenHash: string;
  userId: Id;
  expiresAt: string;
  usedAt: string | null;
}

export interface Membership {
  id: Id;
  leagueId: Id;
  userId: Id;
  role: Role;
  status: "active" | "deactivated" | "removed";
  bowlerId: Id | null;
  joinedAt: string;
}

export interface Invitation {
  id: Id;
  leagueId: Id;
  email: string | null;
  role: Role;
  tokenHash: string;
  createdBy: Id;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  acceptedBy: Id | null;
  acceptedAt: string | null;
}

export interface Announcement {
  id: Id;
  leagueId: Id;
  title: string;
  body: string;
  category: "dates" | "schedule" | "rules" | "event" | "recap" | "playoffs" | "general";
  pinned: boolean;
  createdBy: Id;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
  updatedByName: string;
}

export interface Notification {
  id: Id;
  userId: Id;
  leagueId: Id;
  type: "results" | "schedule" | "announcements" | "rules" | "invitations" | "playoffs";
  title: string;
  body: string;
  href: string;
  dedupeKey: string;
  createdAt: string;
  readAt: string | null;
}

export interface CommissionerAwardRec {
  id: Id;
  leagueId: Id;
  seasonId: Id;
  title: string;
  recipientKind: "bowler" | "team";
  recipientId: Id;
  note: string;
  week: number | null;
  createdBy: Id;
  createdAt: string;
}

export interface ImportLogEntry {
  id: Id;
  leagueId: Id;
  at: string;
  userId: Id;
  kind: string;
  ok: boolean;
  rows: number;
  errors: string[];
}

export interface DB {
  version: number;
  rev: number;
  users: User[];
  sessions: SessionRecord[];
  resetTokens: ResetToken[];
  leagues: League[];
  memberships: Membership[];
  invitations: Invitation[];
  seasons: Season[];
  teams: Team[];
  bowlers: Bowler[];
  roster: RosterEntry[];
  weeks: Week[];
  matchups: Matchup[];
  scores: Score[];
  audit: AuditEntry[];
  announcements: Announcement[];
  notifications: Notification[];
  commissionerAwards: CommissionerAwardRec[];
  templates: ConfigTemplateRecord[];
  importLog: ImportLogEntry[];
  idempotency: { key: string; at: string; result: string }[];
}

export const COLLECTIONS = [
  "users", "sessions", "resetTokens", "leagues", "memberships", "invitations", "seasons", "teams", "bowlers",
  "roster", "weeks", "matchups", "scores", "audit", "announcements", "notifications", "commissionerAwards",
  "templates", "importLog", "idempotency",
] as const;

export function emptyDB(): DB {
  const db = { version: 1, rev: 0 } as DB;
  for (const c of COLLECTIONS) (db as unknown as Record<string, unknown[]>)[c] = [];
  return db;
}

/** Store callbacks must be synchronous: they may be re-run (Postgres) or applied to a copy (file). Fail loudly if one returns a promise. */
export function assertSync<T>(result: T): T {
  if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Store callbacks must be synchronous (do async work before or after calling the store).");
  return result;
}

/**
 * Tells a database-backed store which rows an operation may need, so it can load a slice instead of whole tables.
 * Facets are OR-ed together. Omit the scope entirely to load full tables (always correct, just slower).
 * With a scope, anything outside it is simply *absent* — which also means one league's callback cannot even see another league's rows.
 */
export interface Scope {
  /** Everything owned by this league: seasons, teams, bowlers, rosters, weeks, matchups, scores, announcements, audit…, plus its members' profiles. */
  leagueId?: string;
  /** Like leagueId, resolved from the URL slug. */
  leagueSlug?: string;
  /** These users' profiles, sessions, reset tokens, notifications and memberships (and the leagues they belong to). */
  userIds?: string[];
  /**
   * For every league `userIds` are members of, also load these league-owned collections (e.g. ["seasons"] for a picker that
   * lists the user's leagues with their latest season). Only collections keyed directly by `league_id` are supported.
   */
  userLeagues?: ("seasons" | "teams" | "bowlers")[];
  /** Profiles with these (lower-case) emails. */
  emails?: string[];
  /** The session / reset / invitation row with this token hash (and the user + league it points at). */
  tokenHash?: string;
  /** All public leagues. */
  publicLeagues?: boolean;
  /** Collections to load in full regardless of the other facets (e.g. ["leagues"] to check slug uniqueness). */
  all?: (keyof Omit<DB, "version" | "rev">)[];
}

export interface Store {
  /** Read-only access to a consistent snapshot. Callers must not mutate the object they are given. */
  read<T>(fn: (db: Readonly<DB>) => T, scope?: Scope): Promise<T>;
  /**
   * Runs `fn` against a private copy of the database. If `fn` throws, nothing is persisted; otherwise all of its
   * changes are committed atomically. `fn` is synchronous and may be run more than once (the Postgres store re-runs it
   * after loading tables it touched), so it must not have side effects outside `db`.
   */
  transaction<T>(fn: (db: DB) => T, scope?: Scope): Promise<T>;
  /** Dry run: executes `fn` on a private copy and always discards the changes. */
  preview<T>(fn: (db: DB) => T, scope?: Scope): Promise<T>;
  /** Releases connections (scripts call this before exiting). */
  close?(): Promise<void>;
}

export interface StoreOptions {
  /** null = in-memory only (tests). */
  file: string | null;
}

class FileStore implements Store {
  private db: DB;
  private mtime = 0;
  constructor(private opts: StoreOptions) {
    this.db = this.load();
  }
  private load(): DB {
    const f = this.opts.file;
    if (!f || !fs.existsSync(f)) return emptyDB();
    const raw = fs.readFileSync(f, "utf8");
    const parsed = JSON.parse(raw) as DB;
    const base = emptyDB();
    this.mtime = fs.statSync(f).mtimeMs;
    return { ...base, ...parsed };
  }
  private refresh() {
    const f = this.opts.file;
    if (!f || !fs.existsSync(f)) return;
    const m = fs.statSync(f).mtimeMs;
    if (m !== this.mtime) this.db = this.load();
  }
  async read<T>(fn: (db: Readonly<DB>) => T, _scope?: Scope): Promise<T> {
    this.refresh();
    return assertSync(fn(this.db));
  }
  async preview<T>(fn: (db: DB) => T, _scope?: Scope): Promise<T> {
    this.refresh();
    return assertSync(fn(structuredClone(this.db)));
  }
  async transaction<T>(fn: (db: DB) => T, _scope?: Scope): Promise<T> {
    this.refresh();
    const draft = structuredClone(this.db);
    const result = assertSync(fn(draft));
    draft.rev = this.db.rev + 1;
    const f = this.opts.file;
    if (f) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(draft), { mode: 0o600 });
      fs.renameSync(tmp, f);
      this.mtime = fs.statSync(f).mtimeMs;
    }
    this.db = draft;
    return result;
  }
}

export function createStore(opts: StoreOptions): Store {
  return new FileStore(opts);
}

/** Defers building the real store (which may need async setup) until first use. */
function lazyStore(build: () => Promise<Store>): Store {
  let real: Promise<Store> | null = null;
  const get = () => (real ??= build());
  return {
    read: async (fn, scope) => (await get()).read(fn, scope),
    transaction: async (fn, scope) => (await get()).transaction(fn, scope),
    preview: async (fn, scope) => (await get()).preview(fn, scope),
    close: async () => {
      if (real) await (await real).close?.();
    },
  };
}

/**
 * Picks the storage backend from the environment:
 *   DATABASE_URL         → PostgreSQL / Supabase (run `npm run db:migrate` first)
 *   BOWL_PGLITE_DIR      → embedded Postgres (PGlite) persisted in that directory — real Postgres semantics, no server
 *   otherwise            → file store at BOWL_DATA_FILE (single instance only)
 */
export function createStoreFromEnv(env: NodeJS.ProcessEnv = process.env): Store {
  if (env.DATABASE_URL) {
    return lazyStore(async () => {
      const { createPgClient } = await import("./pg/client");
      const { PgStore } = await import("./pg/store");
      const ssl = env.DATABASE_SSL === "no-verify" ? "no-verify" : env.DATABASE_SSL === "require" ? "require" : undefined;
      return new PgStore(await createPgClient(env.DATABASE_URL!, { max: Number(env.DATABASE_POOL_MAX ?? 5), ssl }), { autoMigrate: env.BOWL_AUTO_MIGRATE === "1", verifyScope: env.BOWL_VERIFY_SCOPE === "1" });
    });
  }
  if (env.BOWL_PGLITE_DIR) {
    return lazyStore(async () => {
      const { createPgliteClient } = await import("./pg/client");
      const { PgStore } = await import("./pg/store");
      return new PgStore(await createPgliteClient(env.BOWL_PGLITE_DIR), { autoMigrate: true, verifyScope: env.BOWL_VERIFY_SCOPE === "1" });
    });
  }
  return createStore({ file: env.BOWL_DATA_FILE ?? path.join(process.cwd(), "data", "db.json") });
}

const g = globalThis as unknown as { __bowlStore?: Store };
export function getStore(): Store {
  return (g.__bowlStore ??= createStoreFromEnv());
}
