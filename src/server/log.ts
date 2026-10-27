/** Structured JSON logging. Never pass passwords, tokens or full request bodies. */
const REDACT = /(password|token|secret|authorization|cookie|hash)/i;

function scrub(v: unknown, depth = 0): unknown {
  if (depth > 4) return "[depth]";
  if (v instanceof Error) return { name: v.name, message: v.message };
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrub(x, depth + 1));
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, REDACT.test(k) ? "[redacted]" : scrub(x, depth + 1)])
    );
  }
  return v;
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(scrub(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}
