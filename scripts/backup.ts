/* Usage: npx tsx scripts/backup.ts
 * Copies the file-store database to data/backups/ with a timestamp, keeping the newest 30.
 * Only meaningful for the file-backed store; managed Postgres backups are configured in the provider (see docs/BACKUPS.md). */
import fs from "node:fs";
import path from "node:path";

const file = process.env.BOWL_DATA_FILE ?? path.join(process.cwd(), "data", "db.json");
if (!fs.existsSync(file)) {
  console.error(`No database at ${file}`);
  process.exit(1);
}
const dir = path.join(path.dirname(file), "backups");
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, `db-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.copyFileSync(file, out);
JSON.parse(fs.readFileSync(out, "utf8")); // verify the copy parses
const all = fs.readdirSync(dir).filter((f) => f.startsWith("db-")).sort();
for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.unlinkSync(path.join(dir, old));
console.log(`Backup written and verified: ${out}`);
