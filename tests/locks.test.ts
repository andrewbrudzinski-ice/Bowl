import { afterEach, describe, expect, it } from "vitest";
import type { Store } from "@/server/db";
import { TEST_BACKEND, mkStore, mkWorld } from "./world";

// Real concurrency needs several connections, so these run against a PostgreSQL server only.
process.env.BOWL_VERIFY_SCOPE = "";

type Hooks = { afterLock?: (i: { exclusive: boolean; keys: string[] }) => Promise<void> | void };
const setHooks = (store: Store, h: Hooks | undefined) => ((store as unknown as { opts: { hooks?: Hooks } }).opts.hooks = h);
const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { promise, open };
}

describe.skipIf(TEST_BACKEND !== "pg")("per-league write locks", () => {
  let store: Store;
  afterEach(() => setHooks(store, undefined));

  async function two() {
    store = await mkStore();
    const a = await mkWorld({ store, name: "Alpha League" });
    const b = await mkWorld({ store, name: "Beta League" });
    return { a, b };
  }
  const rename = (leagueId: string, suffix: string) =>
    store.transaction(
      (db) => {
        for (const t of db.teams) if (t.leagueId === leagueId) t.name += suffix;
      },
      { leagueId }
    );

  it("writers in different leagues run at the same time", async () => {
    const { a, b } = await two();
    const reached: string[] = [];
    const both = gate();
    setHooks(store, {
      afterLock: async (i) => {
        reached.push(i.keys.join());
        if (reached.length === 2) both.open();
        // Each holds its lock until the other has also acquired its own: only possible if they do not exclude each other.
        await Promise.race([both.promise, tick(4000)]);
      },
    });
    await Promise.all([rename(a.leagueId, "!"), rename(b.leagueId, "!")]);
    expect(reached).toHaveLength(2);
    await expect(both.promise).resolves.toBeUndefined();
    expect(reached.every((k) => k.includes("league:"))).toBe(true);
  });

  it("writers in the same league are serialized", async () => {
    const { a } = await two();
    const events: string[] = [];
    const release = gate();
    let n = 0;
    setHooks(store, {
      afterLock: async () => {
        const id = ++n;
        events.push(`enter${id}`);
        if (id === 1) await release.promise;
      },
    });
    const first = rename(a.leagueId, "1");
    await tick(300);
    const second = rename(a.leagueId, "2");
    await tick(500);
    expect(events).toEqual(["enter1"]); // the second is still waiting on the league lock
    release.open();
    await Promise.all([first, second]);
    expect(events).toEqual(["enter1", "enter2"]);
  });

  it("an unscoped writer waits for scoped writers, and they wait for it", async () => {
    const { a } = await two();
    const events: string[] = [];
    const release = gate();
    let n = 0;
    setHooks(store, {
      afterLock: async (i) => {
        events.push(i.exclusive ? "exclusive" : "scoped");
        if (++n === 1) await release.promise;
      },
    });
    const scoped = rename(a.leagueId, "s");
    await tick(300);
    const full = store.transaction((db) => void db.leagues.length); // no scope: exclusive
    await tick(500);
    expect(events).toEqual(["scoped"]);
    release.open();
    await Promise.all([scoped, full]);
    expect(events).toEqual(["scoped", "exclusive"]);
  });

  it("concurrent read-modify-write never loses an update, within and across leagues", async () => {
    const { a, b } = await two();
    const N = 12;
    await Promise.all(Array.from({ length: N }, (_, i) => rename(i % 2 ? a.leagueId : b.leagueId, "x")));
    const names = await store.read((db) => db.teams.map((t) => [t.leagueId, t.name] as const));
    for (const [lid, name] of names) expect((name.match(/x/g) ?? []).length).toBe(N / 2);
    expect(names.some(([l]) => l === a.leagueId)).toBe(true);
  });

  it("a scope too small for what the callback writes fails loudly instead of racing", async () => {
    const { a } = await two();
    // The user scope loads the user's leagues, but holds no lock on them.
    await expect(
      store.transaction(
        (db) => {
          db.leagues[0].name += "?";
        },
        { userIds: [a.owner.id] }
      )
    ).rejects.toThrow(/Write outside lock/);
    expect(await store.read((db) => db.leagues.some((l) => l.name.endsWith("?")))).toBe(false);
  });
});
