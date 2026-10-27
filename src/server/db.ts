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

export interface Store {
  /** Read-only access. Callers must not mutate the returned object. */
  read<T>(fn: (db: Readonly<DB>) => T): T;
  /**
   * Runs `fn` against a private copy of the database. If `fn` throws, nothing is persisted (the copy is discarded);
   * otherwise the copy is written atomically (temp file + rename) and becomes the live state. Because `fn` is synchronous
   * and Node is single-threaded, transactions in one process cannot interleave.
   */
  transaction<T>(fn: (db: DB) => T): T;
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
  read<T>(fn: (db: Readonly<DB>) => T): T {
    this.refresh();
    return fn(this.db);
  }
  transaction<T>(fn: (db: DB) => T): T {
    this.refresh();
    const draft = structuredClone(this.db);
    const result = fn(draft);
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

const g = globalThis as unknown as { __bowlStore?: Store };
export function getStore(): Store {
  if (!g.__bowlStore) {
    const file = process.env.BOWL_DATA_FILE ?? path.join(process.cwd(), "data", "db.json");
    g.__bowlStore = createStore({ file });
  }
  return g.__bowlStore;
}
