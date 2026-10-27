import { AppError } from "../errors";
import { log } from "../log";
import { assertSync, type DB, type Store } from "../db";
import type { SqlClient, SqlTx } from "./client";
import { CODECS, CODEC_BY_NAME, canon, type Codec, type CollectionName } from "./codecs";
import { assertMigrated, migrate } from "./migrate";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Rec = any;

/** Thrown inside a draft when the callback touches a table that has not been loaded yet. */
class NeedCollection extends Error {
  constructor(public collection: CollectionName) {
    super(`need ${collection}`);
  }
}

/** One global writer lock: transactions serialize across every app instance, so read-modify-write is safe. */
const WRITE_LOCK = 7283561;
const INSERT_CHUNK = 400;

export interface PgStoreOptions {
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
      this.ready = (this.opts.autoMigrate ? migrate(this.client).then(() => undefined) : assertMigrated(this.client)).catch((e) => {
        this.ready = null; // retry next time (e.g. after the operator runs the migration)
        throw e;
      });
    }
    return this.ready;
  }

  async read<T>(fn: (db: Readonly<DB>) => T): Promise<T> {
    await this.init();
    return this.wrap(() => this.client.transaction(async (tx) => (await this.execute(tx, fn, false)).result, { readOnly: true }));
  }

  async preview<T>(fn: (db: DB) => T): Promise<T> {
    await this.init();
    return this.wrap(() => this.client.transaction(async (tx) => (await this.execute(tx, fn, true)).result, { readOnly: true }));
  }

  async transaction<T>(fn: (db: DB) => T): Promise<T> {
    await this.init();
    return this.wrap(() =>
      this.client.transaction(async (tx) => {
        await tx.query("select pg_advisory_xact_lock($1)", [WRITE_LOCK]);
        const { result, arrays, loaded, virtual } = await this.execute(tx, fn, true);
        await this.persist(tx, arrays, loaded, virtual);
        return result;
      })
    );
  }

  close(): Promise<void> {
    return this.client.end();
  }

  // ------------------------------------------------------------------ execution

  private async execute<T>(tx: SqlTx, fn: (db: any) => T, write: boolean) {
    const loaded = new Map<CollectionName, Rec[]>();
    for (let attempt = 0; attempt < CODECS.length + 2; attempt++) {
      const arrays = new Map<CollectionName, Rec[]>();
      const virtual = new Set<CollectionName>();
      const db = this.draft(loaded, arrays, virtual, write);
      try {
        return { result: assertSync(fn(db)), arrays, loaded, virtual };
      } catch (e) {
        if (e instanceof NeedCollection) {
          await this.load(tx, CODEC_BY_NAME.get(e.collection)!, loaded);
          continue;
        }
        throw e;
      }
    }
    throw new Error("Store: too many table loads for one operation");
  }

  private async load(tx: SqlTx, codec: Codec, loaded: Map<CollectionName, Rec[]>) {
    const { rows } = await tx.query(`select * from ${codec.table} order by ${codec.order}`);
    const recs = rows.map((r) => codec.fromRow(r));
    if (codec.loadChildren) await codec.loadChildren(tx, recs);
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

  private async persist(tx: SqlTx, arrays: Map<CollectionName, Rec[]>, loaded: Map<CollectionName, Rec[]>, virtual: Set<CollectionName>) {
    type Plan = { codec: Codec; inserted: Rec[]; updated: { before: Rec; after: Rec }[]; deleted: Rec[] };
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
