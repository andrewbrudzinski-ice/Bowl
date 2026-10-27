/* Usage: npx tsx scripts/recover-owner.ts <league-slug> <email>
 * Operator-only recovery: makes an existing account the owner of a league (e.g. if every admin account is lost).
 * Requires shell access to the server's data file, which is the trust boundary. Recorded in the audit log. */
import { getStore } from "../src/server/db";
import { recoverOwner } from "../src/server/services/leagues";

async function main() {
  const [slug, email] = process.argv.slice(2);
  if (!slug || !email) {
    console.error("Usage: recover-owner <league-slug> <email>");
    process.exit(1);
  }
  const store = getStore();
  await recoverOwner(store, slug, email);
  console.log(`${email} is now an owner of ${slug}. (Recorded in the league's audit log.)`);
  await store.close?.();
}
await main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
