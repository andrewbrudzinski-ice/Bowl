/** A tiny SQL interface so the store works with node-postgres (real servers, Supabase) and PGlite (embedded, tests). */
export interface SqlTx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Runs one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface SqlClient {
  /** Runs `fn` in a transaction: committed if it resolves, rolled back if it throws. */
  transaction<T>(fn: (tx: SqlTx) => Promise<T>, opts?: { readOnly?: boolean }): Promise<T>;
  end(): Promise<void>;
}

const BEGIN_RW = "BEGIN";
const BEGIN_RO = "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY";

/** node-postgres. `url` is a standard connection string (Supabase: use the pooled "Transaction" string on port 6543, or the direct one). */
export async function createPgClient(url: string, opts: { max?: number; ssl?: "disable" | "require" | "no-verify" } = {}): Promise<SqlClient> {
  const pg = await import("pg");
  // Return dates as plain strings; numerics stay strings and are parsed by the row codecs.
  pg.types.setTypeParser(1082, (v: string) => v);
  const ssl = opts.ssl === "no-verify" ? { rejectUnauthorized: false } : opts.ssl === "require" ? true : undefined;
  const pool = new pg.Pool({ connectionString: url, max: opts.max ?? 5, ssl, idleTimeoutMillis: 30_000 });
  pool.on("error", () => {
    /* idle client errors are surfaced on the next query */
  });
  return {
    async transaction(fn, o) {
      const client = await pool.connect();
      const tx: SqlTx = {
        query: (sql, params) => client.query(sql, params as unknown[]) as never,
        exec: async (sql) => {
          await client.query(sql);
        },
      };
      try {
        await client.query(o?.readOnly ? BEGIN_RO : BEGIN_RW);
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* connection already broken */
        }
        throw e;
      } finally {
        client.release();
      }
    },
    end: () => pool.end(),
  };
}

/** PGlite: real Postgres compiled to WASM, in memory or persisted to a directory. Single connection. */
export async function createPgliteClient(dir?: string): Promise<SqlClient> {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite(dir, { parsers: { 1082: (v: string) => v } });
  await db.waitReady;
  // PGlite serves one connection: serialize transactions ourselves.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    transaction(fn, o) {
      const run = async () => {
        await db.exec(o?.readOnly ? BEGIN_RO : BEGIN_RW);
        const tx: SqlTx = {
          query: (sql, params) => db.query(sql, params as unknown[]) as never,
          exec: async (sql) => {
            await db.exec(sql);
          },
        };
        try {
          const out = await fn(tx);
          await db.exec("COMMIT");
          return out;
        } catch (e) {
          try {
            await db.exec("ROLLBACK");
          } catch {
            /* ignore */
          }
          throw e;
        }
      };
      const next = tail.then(run, run);
      tail = next.catch(() => undefined);
      return next;
    },
    end: () => db.close(),
  };
}
