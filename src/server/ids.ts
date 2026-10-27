import crypto from "node:crypto";

/** Row ids are UUIDs (they are primary keys in Postgres). The prefix argument is kept only for readability at call sites. */
export const newId = (_kind: string): string => crypto.randomUUID();
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const now = () => new Date().toISOString();

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "league"
  );
}

export function uniqueSlug(base: string, taken: (s: string) => boolean): string {
  let s = slugify(base);
  if (!taken(s)) return s;
  for (let i = 2; i < 1000; i++) {
    const c = `${s}-${i}`;
    if (!taken(c)) return c;
  }
  return `${s}-${crypto.randomBytes(3).toString("hex")}`;
}
