import type { DB } from "../db";
import { DEFAULT_PREFS } from "../db";
import type { SqlTx } from "./client";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = any;
type Row = Record<string, any>;

export type CollectionName = Exclude<keyof DB, "version" | "rev">;

export interface Codec {
  collection: CollectionName;
  table: string;
  /** JS property holding the primary key, and its SQL column. */
  pk: string;
  pkCol: string;
  order: string;
  cols: string[];
  toRow(rec: Rec): unknown[];
  fromRow(row: Row): Rec;
  /** Append-only tables are not loaded for writes: transactions only insert into them. */
  appendOnlyInTx?: boolean;
  /** Attach child rows (e.g. rule versions) to freshly loaded parents. */
  loadChildren?(tx: SqlTx, recs: Rec[]): Promise<void>;
  /** Persist child rows after the parent rows were inserted/updated. */
  syncChildren?(tx: SqlTx, change: { inserted: Rec[]; updated: { before: Rec; after: Rec }[] }): Promise<void>;
  /** Orders updates (e.g. demote before promote to respect partial unique indexes). */
  updateOrder?(a: Rec, b: Rec): number;
}

const iso = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const dateStr = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const num = (v: unknown): number | null => (v == null ? null : Number(v));
const json = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

/** Canonical JSON (sorted keys) so equal records compare equal regardless of key order. */
export function canon(v: unknown): string {
  return JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
}

function simple(collection: CollectionName, table: string, cols: [string, string, ("ts" | "date" | "num" | "json" | "int" | undefined)?][], extra: Partial<Codec> = {}): Codec {
  return {
    collection,
    table,
    pk: "id",
    pkCol: "id",
    order: "seq",
    cols: cols.map((c) => c[0]),
    toRow: (r) => cols.map(([, j, k]) => (k === "json" ? json(r[j]) : r[j] === undefined ? null : r[j])),
    fromRow: (row) => {
      const out: Rec = {};
      for (const [c, j, k] of cols) {
        const v = row[c];
        out[j] = k === "ts" ? iso(v) : k === "date" ? dateStr(v) : k === "num" ? num(v) : k === "int" ? num(v) : v;
      }
      return out;
    },
    ...extra,
  };
}

const users: Codec = {
  collection: "users",
  table: "profiles",
  pk: "id",
  pkCol: "id",
  order: "seq",
  cols: ["id", "email", "password_hash", "disabled", "failed_count", "failed_since", "display_name", "notification_prefs", "created_at"],
  toRow: (u) => [u.id, u.email, u.passwordHash, u.disabled, u.failed?.count ?? 0, u.failed?.since ?? null, u.name, json(u.prefs), u.createdAt],
  fromRow: (r) => ({
    id: r.id,
    email: r.email,
    name: r.display_name,
    passwordHash: r.password_hash,
    createdAt: iso(r.created_at),
    disabled: r.disabled,
    failed: Number(r.failed_count) > 0 || r.failed_since ? { count: Number(r.failed_count), since: iso(r.failed_since) } : null,
    prefs: { ...DEFAULT_PREFS, ...(r.notification_prefs ?? {}) },
  }),
};

const sessions: Codec = {
  collection: "sessions",
  table: "sessions",
  pk: "tokenHash",
  pkCol: "token_hash",
  order: "created_at, token_hash",
  cols: ["token_hash", "user_id", "created_at", "expires_at"],
  toRow: (s) => [s.tokenHash, s.userId, s.createdAt, s.expiresAt],
  fromRow: (r) => ({ tokenHash: r.token_hash, userId: r.user_id, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at) }),
};

const resetTokens: Codec = {
  collection: "resetTokens",
  table: "reset_tokens",
  pk: "tokenHash",
  pkCol: "token_hash",
  order: "expires_at, token_hash",
  cols: ["token_hash", "user_id", "expires_at", "used_at"],
  toRow: (s) => [s.tokenHash, s.userId, s.expiresAt, s.usedAt],
  fromRow: (r) => ({ tokenHash: r.token_hash, userId: r.user_id, expiresAt: iso(r.expires_at), usedAt: iso(r.used_at) }),
};

const leagues = simple("leagues", "leagues", [
  ["id", "id"], ["slug", "slug"], ["name", "name"], ["description", "description"], ["accent", "accent"], ["logo_text", "logoText"],
  ["visibility", "visibility"], ["share_token", "shareToken"], ["default_config", "defaultConfig", "json"], ["homepage", "homepage", "json"],
  ["awards_config", "awards", "json"], ["is_demo", "isDemo"], ["archived_at", "archivedAt", "ts"], ["created_by", "createdBy"], ["created_at", "createdAt", "ts"],
]);

const memberships = simple(
  "memberships",
  "memberships",
  [["id", "id"], ["league_id", "leagueId"], ["user_id", "userId"], ["role", "role"], ["status", "status"], ["bowler_id", "bowlerId"], ["joined_at", "joinedAt", "ts"]],
  // Ownership moves: demote the old owner before promoting the new one (one active owner per league).
  { updateOrder: (a, b) => Number(a.role === "owner") - Number(b.role === "owner") }
);

const invitations = simple("invitations", "invitations", [
  ["id", "id"], ["league_id", "leagueId"], ["email", "email"], ["role", "role"], ["token_hash", "tokenHash"], ["created_by", "createdBy"],
  ["created_at", "createdAt", "ts"], ["expires_at", "expiresAt", "ts"], ["revoked_at", "revokedAt", "ts"], ["accepted_by", "acceptedBy"], ["accepted_at", "acceptedAt", "ts"],
]);

const seasons: Codec = {
  ...simple("seasons", "seasons", [
    ["id", "id"], ["league_id", "leagueId"], ["slug", "slug"], ["name", "name"], ["year", "year", "int"], ["start_date", "startDate", "date"],
    ["regular_weeks", "regularWeeks", "int"], ["status", "status"], ["champion_id", "championId"], ["is_demo", "isDemo"], ["created_at", "createdAt", "ts"],
  ]),
  async loadChildren(tx, recs) {
    const { rows } = await tx.query<Row>("select * from rule_versions order by season_id, version");
    const by = new Map<string, Rec[]>();
    for (const r of rows) {
      const v = { version: Number(r.version), effectiveFromWeek: Number(r.effective_from_week), config: r.config, createdAt: iso(r.created_at), createdBy: r.created_by, reason: r.reason };
      by.set(r.season_id, [...(by.get(r.season_id) ?? []), v]);
    }
    for (const s of recs) s.ruleVersions = by.get(s.id) ?? [];
  },
  async syncChildren(tx, { inserted, updated }) {
    const insertVersions = async (seasonId: string, versions: Rec[]) => {
      for (const v of versions)
        await tx.query(
          "insert into rule_versions (season_id, version, effective_from_week, config, reason, created_by, created_at) values ($1,$2,$3,$4,$5,$6,$7)",
          [seasonId, v.version, v.effectiveFromWeek, json(v.config), v.reason, v.createdBy, v.createdAt]
        );
    };
    for (const s of inserted) await insertVersions(s.id, s.ruleVersions);
    for (const { before, after } of updated) {
      const old = new Map<number, Rec>(before.ruleVersions.map((v: Rec) => [v.version, v]));
      for (const v of old.values()) {
        const now = after.ruleVersions.find((x: Rec) => x.version === v.version);
        if (!now || canon(now) !== canon(v)) throw new Error("Rule versions are immutable: a season's rule history can only be appended to.");
      }
      await insertVersions(after.id, after.ruleVersions.filter((v: Rec) => !old.has(v.version)));
    }
  },
};

const teams = simple("teams", "teams", [
  ["id", "id"], ["league_id", "leagueId"], ["name", "name"], ["short_name", "shortName"], ["color", "color"], ["logo", "logo"], ["active", "active"], ["is_demo", "isDemo"],
]);

const bowlers = simple("bowlers", "bowlers", [
  ["id", "id"], ["league_id", "leagueId"], ["name", "name"], ["nickname", "nickname"], ["avatar_color", "avatarColor"], ["avatar_url", "avatarUrl"],
  ["active", "active"], ["user_id", "userId"], ["notes", "notes"], ["is_demo", "isDemo"], ["created_at", "createdAt", "ts"],
]);

const roster = simple("roster", "season_rosters", [
  ["id", "id"], ["season_id", "seasonId"], ["bowler_id", "bowlerId"], ["team_id", "teamId"], ["entering_average", "enteringAverage", "num"],
  ["is_sub", "isSub"], ["from_week", "fromWeek", "int"], ["to_week", "toWeek", "int"],
]);

const weeks = simple("weeks", "weeks", [
  ["id", "id"], ["season_id", "seasonId"], ["number", "number", "int"], ["date", "date", "date"], ["status", "status"], ["phase", "phase"], ["label", "label"],
]);

const matchups: Codec = {
  ...simple("matchups", "matchups", [
    ["id", "id"], ["season_id", "seasonId"], ["week_number", "weekNumber", "int"], ["kind", "kind"], ["side_a", "sideA"], ["side_b", "sideB"], ["state", "state"],
    ["forfeit_by", "forfeitBy"], ["rule_version", "ruleVersion", "int"], ["playoff_round", "playoffRound", "int"], ["notes", "notes"], ["revision", "revision", "int"],
    ["finalized_at", "finalizedAt", "ts"], ["finalized_by", "finalizedBy"], ["updated_at", "updatedAt", "ts"], ["updated_by", "updatedBy"], ["is_demo", "isDemo"],
  ]),
  async loadChildren(tx, recs) {
    const lineups = (await tx.query<Row>("select matchup_id, side, position, bowler_id from matchup_lineups order by matchup_id, side, position")).rows;
    const snaps = (await tx.query<Row>("select matchup_id, bowler_id, average, handicap, note from matchup_handicaps")).rows;
    const lm = new Map<string, { A: string[]; B: string[] }>();
    for (const r of lineups) {
      const e = lm.get(r.matchup_id) ?? { A: [], B: [] };
      (r.side === "A" ? e.A : e.B).push(r.bowler_id);
      lm.set(r.matchup_id, e);
    }
    const sm = new Map<string, Record<string, Rec>>();
    for (const r of snaps) {
      const e = sm.get(r.matchup_id) ?? {};
      e[r.bowler_id] = { average: num(r.average), handicap: Number(r.handicap), note: r.note };
      sm.set(r.matchup_id, e);
    }
    for (const m of recs) {
      m.lineupA = lm.get(m.id)?.A ?? [];
      m.lineupB = lm.get(m.id)?.B ?? [];
      m.handicapSnapshot = sm.get(m.id) ?? null;
    }
  },
  async syncChildren(tx, { inserted, updated }) {
    const write = async (m: Rec, replace: boolean) => {
      if (replace) {
        await tx.query("delete from matchup_lineups where matchup_id = $1", [m.id]);
        await tx.query("delete from matchup_handicaps where matchup_id = $1", [m.id]);
      }
      for (const [side, list] of [["A", m.lineupA], ["B", m.lineupB]] as const)
        for (const [i, b] of (list as string[]).entries()) await tx.query("insert into matchup_lineups (matchup_id, side, position, bowler_id) values ($1,$2,$3,$4)", [m.id, side, i + 1, b]);
      for (const [b, h] of Object.entries((m.handicapSnapshot ?? {}) as Record<string, Rec>))
        await tx.query("insert into matchup_handicaps (matchup_id, bowler_id, average, handicap, note) values ($1,$2,$3,$4,$5)", [m.id, b, h.average, h.handicap, h.note ?? ""]);
    };
    for (const m of inserted) await write(m, false);
    for (const { before, after } of updated) {
      if (canon([before.lineupA, before.lineupB, before.handicapSnapshot]) !== canon([after.lineupA, after.lineupB, after.handicapSnapshot])) await write(after, true);
    }
  },
};

const scores = simple("scores", "scores", [
  ["id", "id"], ["matchup_id", "matchupId"], ["bowler_id", "bowlerId"], ["side", "side"], ["game", "game", "int"], ["scratch", "scratch", "int"], ["kind", "kind"],
  ["updated_at", "updatedAt", "ts"], ["updated_by", "updatedBy"],
]);

const audit = simple(
  "audit",
  "audit_log",
  [
    ["id", "id"], ["league_id", "leagueId"], ["season_id", "seasonId"], ["at", "at", "ts"], ["user_id", "userId"], ["user_name", "userName"], ["action", "action"],
    ["entity_type", "entityType"], ["entity_id", "entityId"], ["before", "before", "json"], ["after", "after", "json"], ["note", "note"],
  ],
  { appendOnlyInTx: true }
);

const announcements = simple("announcements", "announcements", [
  ["id", "id"], ["league_id", "leagueId"], ["title", "title"], ["body", "body"], ["category", "category"], ["pinned", "pinned"], ["created_by", "createdBy"],
  ["created_by_name", "createdByName"], ["created_at", "createdAt", "ts"], ["updated_at", "updatedAt", "ts"], ["updated_by_name", "updatedByName"],
]);

const notifications = simple("notifications", "notifications", [
  ["id", "id"], ["user_id", "userId"], ["league_id", "leagueId"], ["type", "type"], ["title", "title"], ["body", "body"], ["href", "href"],
  ["dedupe_key", "dedupeKey"], ["created_at", "createdAt", "ts"], ["read_at", "readAt", "ts"],
]);

const commissionerAwards = simple("commissionerAwards", "commissioner_awards", [
  ["id", "id"], ["league_id", "leagueId"], ["season_id", "seasonId"], ["title", "title"], ["recipient_kind", "recipientKind"], ["recipient_id", "recipientId"],
  ["note", "note"], ["week", "week", "int"], ["created_by", "createdBy"], ["created_at", "createdAt", "ts"],
]);

const templates = simple("templates", "templates", [
  ["id", "id"], ["league_id", "leagueId"], ["name", "name"], ["description", "description"], ["config", "config", "json"], ["created_at", "createdAt", "ts"],
]);

const importLog = simple("importLog", "import_log", [
  ["id", "id"], ["league_id", "leagueId"], ["at", "at", "ts"], ["user_id", "userId"], ["kind", "kind"], ["ok", "ok"], ["rows", "rows", "int"], ["errors", "errors", "json"],
]);

const idempotency: Codec = {
  collection: "idempotency",
  table: "idempotency_keys",
  pk: "key",
  pkCol: "key",
  order: "seq",
  cols: ["key", "at", "result"],
  toRow: (r) => [r.key, r.at, r.result],
  fromRow: (r) => ({ key: r.key, at: iso(r.at), result: r.result }),
};

/** Parent tables first: inserts/updates run in this order, deletes in reverse. */
export const CODECS: Codec[] = [
  users, leagues, bowlers, teams, memberships, invitations, seasons, roster, weeks, matchups, scores, audit,
  announcements, notifications, commissionerAwards, templates, importLog, sessions, resetTokens, idempotency,
];

export const CODEC_BY_NAME = new Map(CODECS.map((c) => [c.collection, c]));
