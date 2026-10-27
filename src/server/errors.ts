export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "conflict"
  | "locked"
  | "rate_limited";

/** Errors safe to show to users. Anything else is logged and replaced by a generic message. */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export const forbidden = (msg = "You don't have permission to do that.") => new AppError("forbidden", msg);
export const notFound = (what = "That") => new AppError("not_found", `${what} was not found.`);
export const invalid = (msg: string, details?: unknown) => new AppError("validation", msg, details);
export const conflict = (msg: string, details?: unknown) => new AppError("conflict", msg, details);
