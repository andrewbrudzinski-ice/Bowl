import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_BACKEND, mkStore } from "./world";

// getStore() reads the environment on first use; make sure a real DATABASE_URL on the machine is never touched.
beforeAll(() => {
  delete process.env.DATABASE_URL;
  delete process.env.BOWL_PGLITE_DIR;
  process.env.BOWL_DATA_FILE = path.join(os.tmpdir(), `bowl-health-${process.pid}.json`);
});
afterEach(() => {
  delete (globalThis as { __bowlStore?: unknown }).__bowlStore;
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("returns 200 {ok:true} with the store reachable, uncached", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 without leaking the reason when the database fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { __bowlStore?: unknown }).__bowlStore = { read: async () => { throw new Error("password authentication failed for user secret-user"); } };
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(JSON.parse(body)).toEqual({ ok: false });
    expect(body).not.toMatch(/password|secret/i);
  });

  it.skipIf(TEST_BACKEND === "file")("passes against the Postgres store too (migrated, nothing loaded)", async () => {
    (globalThis as { __bowlStore?: unknown }).__bowlStore = await mkStore();
    const { GET } = await import("@/app/api/health/route");
    expect((await GET()).status).toBe(200);
  });
});
