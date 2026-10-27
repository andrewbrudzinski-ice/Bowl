/* Usage: npx tsx scripts/seed-demo.ts <email> [name]
 * Creates a demo league (flagged as demo, removable) owned by the given account, creating the account if needed.
 * Refuses to run in production. The generated password is printed once. */
import crypto from "node:crypto";
import { getStore } from "../src/server/db";
import { registerUser } from "../src/server/auth";
import { createDemoLeague } from "../src/server/demo";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}
async function main() {
  const email = (process.argv[2] ?? "demo@example.com").toLowerCase();
  const name = process.argv[3] ?? "Demo Commissioner";
  const store = getStore();
  let user = await store.read((db) => db.users.find((u) => u.email === email));
  let password: string | null = null;
  if (!user) {
    password = crypto.randomBytes(9).toString("base64url");
    await registerUser(store, { email, name, password });
    user = (await store.read((db) => db.users.find((u) => u.email === email)))!;
  }
  const { slug } = await createDemoLeague(store, { id: user.id, name: user.name, email: user.email });
  console.log(`Demo league created: /l/${slug}`);
  if (password) console.log(`New account ${email} — password: ${password}  (shown once; change it after signing in)`);
  await store.close?.();
}
await main().catch((e) => { console.error(e); process.exit(1); });
