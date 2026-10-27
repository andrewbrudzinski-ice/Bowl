import { AppError } from "@/server/errors";
import { log } from "@/server/log";

export type ActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  issues?: string[];
  data?: unknown;
} | null;

/** Wraps a server action body: user-safe errors are returned, framework redirects pass through, anything else is logged and genericized. */
export async function run(fn: () => Promise<ActionState | void> | ActionState | void): Promise<ActionState> {
  try {
    const r = await fn();
    return r ?? { ok: true };
  } catch (e) {
    const digest = (e as { digest?: string } | null)?.digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND") || digest.startsWith("NEXT_HTTP_ERROR"))) throw e;
    if (e instanceof AppError) {
      const issues = Array.isArray(e.details) ? (e.details as { message?: string; severity?: string }[]).filter((i) => i.severity !== "warning").map((i) => i.message ?? "").filter(Boolean).slice(0, 20) : undefined;
      return { ok: false, error: e.message, issues };
    }
    log("error", "action_failed", { error: e });
    return { ok: false, error: "Something went wrong on our side. Nothing was changed — please try again." };
  }
}

export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const num = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? "").trim();
  return v === "" ? NaN : Number(v);
};
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";

/** Only allow same-site relative redirects after login. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  return next;
}
