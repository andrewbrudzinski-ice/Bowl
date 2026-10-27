/* Usage: npm run db:import-file -- [path/to/db.json]
 * One-time copy of a file-store database (BOWL_DATA_FILE) into Postgres (DATABASE_URL / BOWL_PGLITE_DIR).
 * - Old ids (e.g. "lg_AbC…") become deterministic UUIDs; relationships, notification links and dedupe keys are rewritten.
 * - Refuses to run against a database that already has accounts. Run `npm run db:migrate` first.
 * - Take a backup of the JSON file first (npm run db:backup). The source file is never modified. */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createStoreFromEnv, type DB } from "../src/server/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toUuid = (old: string): string => {
  if (UUID.test(old)) return old.toLowerCase();
  const h = crypto.createHash("sha1").update("bowl:" + old).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
};

const ID_KEYS = new Set(["id", "leagueId", "seasonId", "matchupId", "bowlerId", "teamId", "userId", "createdBy", "updatedBy", "finalizedBy", "acceptedBy", "championId", "recipientId", "sideA", "sideB"]);

async function main() {
  const file = process.argv[2] ?? process.env.BOWL_DATA_FILE ?? path.join(process.cwd(), "data", "db.json");
  if (!fs.existsSync(file)) throw new Error(`No file database at ${file}`);
  const src = JSON.parse(fs.readFileSync(file, "utf8")) as DB;
  const store = createStoreFromEnv({ ...process.env, BOWL_DATA_FILE: undefined });
  if (!process.env.DATABASE_URL && !process.env.BOWL_PGLITE_DIR) throw new Error("Set DATABASE_URL (or BOWL_PGLITE_DIR) to the target database.");

  // Collect every old id so links inside strings can be rewritten.
  const map = new Map<string, string>();
  const note = (id: unknown) => {
    if (typeof id === "string" && id && !UUID.test(id) && !map.has(id)) map.set(id, toUuid(id));
  };
  const walk = (rec: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(rec)) {
      if (ID_KEYS.has(k)) note(v);
      else if ((k === "lineupA" || k === "lineupB") && Array.isArray(v)) v.forEach(note);
      else if (k === "handicapSnapshot" && v && typeof v === "object") Object.keys(v).forEach(note);
    }
  };
  for (const [name, rows] of Object.entries(src)) if (Array.isArray(rows) && name !== "sessions") for (const r of rows as Record<string, unknown>[]) walk(r);
  const rewriteStr = (s: string) => {
    let out = s;
    for (const [o, n] of map) if (out.includes(o)) out = out.split(o).join(n);
    return out;
  };
  const m = (id: unknown) => (typeof id === "string" ? (map.get(id) ?? id) : id);
  const convert = (rec: Record<string, any>): Record<string, any> => {
    const out: Record<string, any> = { ...rec };
    for (const k of Object.keys(out)) {
      if (ID_KEYS.has(k)) out[k] = m(out[k]);
      else if ((k === "lineupA" || k === "lineupB") && Array.isArray(out[k])) out[k] = out[k].map(m);
      else if (k === "handicapSnapshot" && out[k]) out[k] = Object.fromEntries(Object.entries(out[k]).map(([b, v]) => [m(b), v]));
      else if ((k === "href" || k === "dedupeKey" || k === "entityId") && typeof out[k] === "string") out[k] = rewriteStr(out[k]);
    }
    return out;
  };

  const existing = await store.read((db) => db.users.length + db.leagues.length);
  if (existing > 0) throw new Error("The target database already contains accounts or leagues; refusing to import over it.");

  const counts: Record<string, number> = {};
  await store.transaction((db) => {
    const target = db as unknown as Record<string, any[]>;
    for (const [name, rows] of Object.entries(src)) {
      if (!Array.isArray(rows) || name === "idempotency") continue;
      const list = (rows as Record<string, any>[]).map((r) => {
        const c = convert(r);
        if (name === "seasons") c.ruleVersions = (r as any).ruleVersions.map((v: any) => ({ ...v, createdBy: m(v.createdBy) }));
        return c;
      });
      target[name].push(...list);
      counts[name] = list.length;
    }
  });
  console.log("Imported:", counts);
  console.log(`${map.size} ids were converted to UUIDs. Old notification links were rewritten; keep the JSON file as your backup.`);
  await store.close?.();
}
main().catch((e) => {
  console.error("Import failed:", e.message ?? e);
  process.exit(1);
});
