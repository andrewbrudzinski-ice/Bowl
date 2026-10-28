/* Usage: npm run check:bundle   (run after `npm run build`)
 * The database layer reads supabase/migrations at runtime. A serverless host (Vercel) only ships files Next's tracing found, and that
 * path is computed, so it must be listed in next.config.mjs (outputFileTracingIncludes). Without it every request fails with
 * "ENOENT scandir '/var/task/supabase/migrations'". This fails the build if the traced bundle of a database-backed route lacks the migrations. */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", ".next", "server");
const routes = ["app/api/health/route.js.nft.json", "app/page.js.nft.json", "app/l/[slug]/page.js.nft.json"];
let bad = 0;
for (const r of routes) {
  const file = path.join(root, r);
  if (!fs.existsSync(file)) {
    console.error(`✗ ${r}: no trace file (run npm run build first)`);
    bad++;
    continue;
  }
  const files = JSON.parse(fs.readFileSync(file, "utf8")).files;
  const have = files.filter((f) => /supabase\/migrations\/\d+.*\.sql$/.test(f));
  const need = fs.readdirSync(path.resolve(__dirname, "..", "supabase", "migrations")).filter((f) => /^\d+.*\.sql$/.test(f));
  if (have.length < need.length) {
    console.error(`✗ ${r}: bundle ships ${have.length} of ${need.length} migrations — add them to outputFileTracingIncludes in next.config.mjs`);
    bad++;
  } else console.log(`✓ ${r}: ships all ${need.length} migrations`);
}
process.exit(bad ? 1 : 0);
