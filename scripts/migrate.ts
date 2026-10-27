/* Usage: npm run db:migrate
 * Applies pending SQL migrations from supabase/migrations to the database named by DATABASE_URL
 * (or the embedded PGlite database in BOWL_PGLITE_DIR). Safe to re-run; records what it applied in schema_migrations. */
import { createPgClient, createPgliteClient, type SqlClient } from "../src/server/pg/client";
import { migrate } from "../src/server/pg/migrate";

async function main() {
  let client: SqlClient;
  if (process.env.DATABASE_URL) {
    const ssl = process.env.DATABASE_SSL === "no-verify" ? "no-verify" : process.env.DATABASE_SSL === "require" ? "require" : undefined;
    client = await createPgClient(process.env.DATABASE_URL, { max: 1, ssl });
  } else if (process.env.BOWL_PGLITE_DIR) client = await createPgliteClient(process.env.BOWL_PGLITE_DIR);
  else {
    console.error("Set DATABASE_URL (or BOWL_PGLITE_DIR for embedded Postgres).");
    process.exit(1);
  }
  const r = await migrate(client);
  console.log(r.applied.length ? `Applied: ${r.applied.join(", ")}` : "Database is up to date.", `(latest: ${r.current})`);
  await client.end();
}
main().catch((e) => {
  console.error("Migration failed:", e.message ?? e);
  process.exit(1);
});
