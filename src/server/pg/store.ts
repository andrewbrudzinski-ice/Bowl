import { AppError } from "../errors";
import { log } from "../log";
import { assertSync, type DB, type Scope, type Store } from "../db";
import type { SqlClient, SqlTx } from "./client";
import { CODECS, CODEC_BY_NAME, canon, type Codec, type CollectionName } from "./codecs";
import { assertMigrated, migrate } from "./migrate";
import { acquireLocks, checkWrites, planLocks } from "./locks";
import { filterFor } from "./scope";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = any;

/** Thrown inside a draft when the callback touches a table that has not been loaded yet. */
class NeedCollection extends Error {
  constructor(public collection: CollectionName) {
    super(`need ${collection}`);
  }
}

type Plan = { codec: Codec; inserted: Rec[]; updated: { before: Rec; after: Rec }[]; deleted: Rec[] };

/** Canonical form for comparing two runs: ids, timestamps and random tokens differ between runs by design, so they are masked. */
function mask(str: string): string {
  return str
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, "<ts>")
    .replace(/\b[0-9a-f]{64}\b/g, "<hash>")
    .replace(/[A-Za-z0-9_-]{22,}/g, "<tok>");
}
// Mask before canonicalising: keys that are ids would otherwise be ordered by their (random) values.
function maskDeep(v: unknown): unknown {
  if (typeof v === "string") return mask(v);
  if (v instanceof Map) return maskDeep([...v.entries()]);
  if (v instanceof Set) return maskDeep([...v]);
  if (Array.isArray(v)) return v.map(maskDeep);
  // Entries (not an object) so two keys that mask to the same text are both kept; sorted so key order cannot matter.
  if (v && typeof v === "object") return Object.entries(v).map(([k, x]) => [mask(k), maskDeep(x)] as const).sort((p, q) => (canon(p) < canon(q) ? -1 : 1));
  return v;
}
function norm(v: unknown): string {
  return canon(maskDeep(v));
}
const summarize = (plans: Plan[]) =>
  plans
    .map((p) => ({
      t: p.codec.table,
      i: p.inserted.map((r) => norm(r)).sort(),
      u: p.updated.map((u) => norm(u.after)).sort(),
      d: p.deleted.map((r) => norm(r)).sort(),
    }))
    .sort((a, b) => (a.t < b.t ? -1 : 1));

const INSERT_CHUNK = 400;

export interface PgStoreOptions {
  /**
   * Test/CI safety net: run every *scoped* operation a second time against full tables and fail if the result or the
   * resulting changes differ. Catches a scope that is missing rows the operation actually needed.
   */
  verifyScope?: boolean;
  /** Test hooks. `afterLock` runs once a write transaction holds its locks, before it reads anything. */
  hooks?: { afterLock?(info: { exclusive: boolean; keys: string[] }): Promise<void> | void };
  /** Apply pending migrations on first use (local dev / PGlite). Production should run `npm run db:migrate` instead. */
  autoMigrate?: boolean;
}

/**
 * Postgres-backed Store.
 *
 * The services are written against a plain in-memory `db` object and a synchronous callback. This store keeps that contract:
 *  1. open a Postgres transaction (writers take a global advisory lock first);
 *  2. run the callback against a *draft*; when it touches a table that isn't loaded yet, load that whole table and re-run;
 *  3. diff the draft against what was loaded and write only the inserted/updated/deleted rows;
 *  4. commit — or roll back everything if the callback or any statement threw.
 *
 * Only the tables a request touches are read (the audit log is write-only inside transactions).
 * Authorization lives in the service layer; this connection is privileged and bypasses row-level security.
 */
export class PgStore implements Store {
  private ready: Promise<void> | null = null;

  constructor(
    private client: SqlClient,
    private opts: PgStoreOptions = {}
  ) {}

  private init(): Promise<void> {
    if (!this.ready) {
      this.ready = (this.opts.autoMigrate ? migrate(this.client).then(() => undefined) : assertMigrated(this.client)).then(() => this.sweep()).catch((e) => {
        this.ready = null; // retry next time (e.g. after the operator runs the migration)
        throw e;
      });
    }
    return this.ready;
  }

  /**
   * Scoped transactions only see (and so only prune) their own slice, so expired rows are removed here, once per process
   * start. Failure to sweep is harmless and must not stop the app.
   */
  private async sweep() {
    try {
      await this.client.transaction(async (tx) => {
        await tx.query("delete from sessions where expires_at < now()");
        await tx.query("delete from reset_tokens where expires_at < now() - interval '1 day'");
        await tx.query("delete from idempotency_keys where at < now() - interval '30 days'");
      });
    } catch {
      /* best effort */
    }
  }

  async read<T>(fn: (db: Readonly<DB>) => T, scope?: Scope): Promise<T> {
    await this.init();
    return this.wrap(() =>
      this.client.transaction(
        async (tx) => {
          const sc = await this.resolve(tx, scope);
          const run = await this.execute(tx, fn, false, sc);
          if (this.opts.verifyScope && sc) {
            const full = await this.execute(tx, fn, false, undefined);
            this.compare("read", norm(run.result), norm(full.result), scope);
          }
          return run.result;
        },
        { readOnly: true }
      )
    );
  }

  async preview<T>(fn: (db: DB) => T, scope?: Scope): Promise<T> {
    await this.init();
    return this.wrap(() => this.client.transaction(async (tx) => (await this.execute(tx, fn, true, await this.resolve(tx, scope))).result, { readOnly: true }));
  }

  async transaction<T>(fn: (db: DB) => T, scope?: Scope): Promise<T> {
    await this.init();
    return this.wrap(() =>
      this.client.transaction(async (tx) => {
        const locks = await planLocks(tx, scope);
        await acquireLocks(tx, locks);
        await this.opts.hooks?.afterLock?.({ exclusive: locks.exclusive, keys: locks.keys });
        const sc = locks.scope;
        const run = await this.execute(tx, fn, true, sc);
        const plans = this.plan(run.arrays, run.loaded, run.virtual);
        checkWrites(locks, plans.map((p) => ({ collection: p.codec.collection, before: [...p.updated.map((u) => u.before), ...p.deleted] })), scope);
        if (this.opts.verifyScope && sc) {
          const full = await this.execute(tx, fn, true, undefined);
          this.compare("transaction", norm({ r: run.result, p: summarize(plans) }), norm({ r: full.result, p: summarize(this.plan(full.arrays, full.loaded, full.virtual)) }), scope);
        }
        await this.apply(tx, plans);
        return run.result;
      })
    );
  }

  /** Resolves a slug to a league id so every collection can filter on it. */
  private async resolve(tx: SqlTx, scope?: Scope): Promise<Scope | undefined> {
    if (!scope) return undefined;
    if (scope.leagueSlug && !scope.leagueId) {
      const { rows } = await tx.query<{ id: string }>("select id from leagues where slug = $1", [scope.leagueSlug]);
      if (rows[0]) return { ...scope, leagueId: rows[0].id };
    }
    return scope;
  }

  private compare(kind: string, scoped: string, full: string, scope?: Scope) {
    if (scoped === full) return;
    let i = 0;
    while (i < scoped.length && scoped[i] === full[i]) i++;
    throw new Error(`Scope mismatch in ${kind} (${JSON.stringify(scope)}): the scoped run differs from the full run near …${scoped.slice(Math.max(0, i - 60), i + 80)}… vs …${full.slice(Math.max(0, i - 60), i + 80)}…`);
  }

  close(): Promise<void> {
    return this.client.end();
  }

  // ------------------------------------------------------------------ execution

  private async execute<T>(tx: SqlTx, fn: (db: any) => T, write: boolean, scope: Scope | undefined) {
    const loaded = new Map<CollectionName, Rec[]>();
    for (let attempt = 0; attempt < CODECS.length + 2; attempt++) {
      const arrays = new Map<CollectionName, Rec[]>();
      const virtual = new Set<CollectionName>();
      const db = this.draft(loaded, arrays, virtual, write);
      try {
        return { result: assertSync(fn(db)), arrays, loaded, virtual };
      } catch (e) {
        if (e instanceof NeedCollection) {
          await this.load(tx, CODEC_BY_NAME.get(e.collection)!, loaded, scope);
          continue;
        }
        throw e;
      }
    }
    throw new Error("Store: too many table loads for one operation");
  }

  private async load(tx: SqlTx, codec: Codec, loaded: Map<CollectionName, Rec[]>, scope: Scope | undefined) {
    const f = filterFor(codec.collection, scope);
    const { rows } = await tx.query(`select * from ${codec.table}${f ? ` where ${f.where}` : ""} order by ${codec.order}`, f?.params);
    const recs = rows.map((r) => codec.fromRow(r));
    if (codec.loadChildren) await codec.loadChildren(tx, recs, !!f);
    loaded.set(codec.collection, recs);
  }

  private draft(loaded: Map<CollectionName, Rec[]>, arrays: Map<CollectionName, Rec[]>, virtual: Set<CollectionName>, write: boolean): any {
    const db: any = {};
    Object.defineProperty(db, "version", { value: 1, enumerable: true });
    Object.defineProperty(db, "rev", { value: 0, enumerable: true });
    for (const codec of CODECS) {
      const name = codec.collection;
      Object.defineProperty(db, name, {
        enumerable: true,
        configurable: true,
        get() {
          const have = arrays.get(name);
          if (have) return have;
          const orig = loaded.get(name);
          if (orig) {
            const copy = structuredClone(orig);
            arrays.set(name, copy);
            return copy;
          }
          if (write && codec.appendOnlyInTx) {
            const fresh: Rec[] = [];
            arrays.set(name, fresh);
            virtual.add(name);
            return fresh;
          }
          throw new NeedCollection(name);
        },
        set(v: Rec[]) {
          arrays.set(name, v);
        },
      });
    }
    return db;
  }

  // ------------------------------------------------------------------ persistence

  private plan(arrays: Map<CollectionName, Rec[]>, loaded: Map<CollectionName, Rec[]>, virtual: Set<CollectionName>): Plan[] {
    const plans: Plan[] = [];
    for (const codec of CODECS) {
      const next = arrays.get(codec.collection);
      if (!next) continue;
      const orig = virtual.has(codec.collection) ? [] : (loaded.get(codec.collection) ?? []);
      const origBy = new Map<string, Rec>(orig.map((r) => [String(r[codec.pk]), r]));
      const nextBy = new Map<string, Rec>();
      for (const r of next) {
        const k = String(r[codec.pk]);
        if (nextBy.has(k)) throw new Error(`Duplicate ${codec.table} key ${k} in one transaction`);
        nextBy.set(k, r);
      }
      const inserted = next.filter((r) => !origBy.has(String(r[codec.pk])));
      const deleted = virtual.has(codec.collection) ? [] : orig.filter((r) => !nextBy.has(String(r[codec.pk])));
      const updated: Plan["updated"] = [];
      for (const [k, before] of origBy) {
        const after = nextBy.get(k);
        if (after && canon(after) !== canon(before)) updated.push({ before, after });
      }
      if (codec.updateOrder) updated.sort((a, b) => codec.updateOrder!(a.after, b.after));
      if (inserted.length || updated.length || deleted.length) plans.push({ codec, inserted, updated, deleted });
    }
    return plans;
  }

  private async apply(tx: SqlTx, plans: Plan[]) {
    if (!plans.length) return;

    // Declare which matchups' scores this (already authorized) transaction writes, and any demo league being purged,
    // so the database's own protection triggers can tell a service-layer write from a stray one.
    const scorePlan = plans.find((p) => p.codec.collection === "scores");
    if (scorePlan) {
      const ids = new Set<string>();
      for (const r of scorePlan.inserted) ids.add(r.matchupId);
      for (const r of scorePlan.deleted) ids.add(r.matchupId);
      for (const u of scorePlan.updated) ids.add(u.after.matchupId);
      await tx.query("select set_config('app.score_writes', $1, true)", [[...ids].join(",")]);
    }
    const leaguePlan = plans.find((p) => p.codec.collection === "leagues");
    if (leaguePlan?.deleted.length) {
      const demoIds = leaguePlan.deleted.filter((l) => l.isDemo).map((l) => l.id);
      await tx.query("select set_config('app.purge_demo', $1, true)", [demoIds.join(",")]);
      // The audit trigger only permits this while the (demo) league row still exists, so purge before the cascade runs.
      if (demoIds.length) await tx.query("delete from audit_log where league_id::text = any($1::text[])", [demoIds]);
    }

    for (const p of [...plans].reverse()) {
      if (!p.deleted.length) continue;
      await tx.query(`delete from ${p.codec.table} where ${p.codec.pkCol}::text = any($1::text[])`, [p.deleted.map((r) => String(r[p.codec.pk]))]);
    }
    for (const p of plans) {
      const { codec } = p;
      const setCols = codec.cols.filter((c) => c !== codec.pkCol);
      const pkIdx = codec.cols.indexOf(codec.pkCol);
      for (const { after } of p.updated) {
        const row = codec.toRow(after);
        const params = [...codec.cols.map((c, i) => [c, row[i]] as const).filter(([c]) => c !== codec.pkCol).map(([, v]) => v), row[pkIdx]];
        await tx.query(`update ${codec.table} set ${setCols.map((c, i) => `${c} = $${i + 1}`).join(", ")} where ${codec.pkCol} = $${setCols.length + 1}`, params);
      }
      for (let i = 0; i < p.inserted.length; i += INSERT_CHUNK) {
        const chunk = p.inserted.slice(i, i + INSERT_CHUNK);
        const params: unknown[] = [];
        const tuples = chunk.map((r) => {
          const vals = codec.toRow(r);
          return `(${vals.map((v) => `$${params.push(v)}`).join(",")})`;
        });
        await tx.query(`insert into ${codec.table} (${codec.cols.join(",")}) values ${tuples.join(",")}`, params);
      }
      if (codec.syncChildren) await codec.syncChildren(tx, { inserted: p.inserted, updated: p.updated });
    }
  }

  /** Translates database constraint failures into errors the UI can show. Unexpected errors are logged and re-thrown. */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = e as { code?: string; constraint?: string; message?: string };
      if (err instanceof AppError) throw err;
      if (err.code === "23505") throw new AppError("conflict", "That conflicts with something that already exists (a duplicate was blocked by the database).", { constraint: err.constraint });
      if (err.code === "23514") throw new AppError("validation", "A value was outside what the database allows.", { constraint: err.constraint });
      if (err.code === "23503") throw new AppError("conflict", "That refers to something that no longer exists.", { constraint: err.constraint });
      if (err.code === "P0001" && /finalized/.test(err.message ?? "")) throw new AppError("locked", "This result is finalized and protected.");
      log("error", "pg_store_error", { code: err.code, constraint: err.constraint, message: err.message });
      throw e;
    }
  }
}
