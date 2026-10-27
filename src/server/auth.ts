import crypto from "node:crypto";
import { AppError, invalid } from "./errors";
import { DEFAULT_PREFS, type DB, type Store, type User } from "./db";
import { newId, newToken, now } from "./ids";
import { log } from "./log";

const SESSION_DAYS = 30;
const RESET_MINUTES = 60;
const MAX_FAILED = 6;
const LOCK_MINUTES = 15;

function pepper(): string {
  const s = process.env.SESSION_SECRET;
  if (!s && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set in production");
  return s ?? "dev-only-insecure-secret";
}

export const hashToken = (t: string) => crypto.createHmac("sha256", pepper()).update(t).digest("hex");

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const N = 16384;
  const hash = crypto.scryptSync(password, salt, 64, { N, r: 8, p: 1 });
  return `scrypt$${N}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: Number(n), r: 8, p: 1 });
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(pw: string) {
  if (pw.length < 8) throw invalid("Passwords need at least 8 characters.");
  if (pw.length > 200) throw invalid("That password is too long.");
}

export function validateEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) throw invalid("Enter a valid email address.");
}

export function registerUser(store: Store, input: { email: string; name: string; password: string }): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(input.email);
  validateEmail(email);
  validatePassword(input.password);
  const name = input.name.trim();
  if (!name || name.length > 80) throw invalid("Enter your name (up to 80 characters).");
  return store.transaction((db) => {
    if (db.users.some((u) => u.email === email)) throw invalid("An account with that email already exists. Try signing in.");
    const user: User = {
      id: newId("u"), email, name, passwordHash: hashPassword(input.password), createdAt: now(),
      disabled: false, failed: null, prefs: { ...DEFAULT_PREFS },
    };
    db.users.push(user);
    const token = createSession(db, user.id);
    return { user, token };
  });
}

export function createSession(db: DB, userId: string): string {
  const token = newToken();
  const t = new Date();
  db.sessions.push({
    tokenHash: hashToken(token),
    userId,
    createdAt: t.toISOString(),
    expiresAt: new Date(t.getTime() + SESSION_DAYS * 864e5).toISOString(),
  });
  // prune expired
  db.sessions = db.sessions.filter((s) => s.expiresAt > t.toISOString());
  return token;
}

export function login(store: Store, emailRaw: string, password: string): Promise<{ user: User; token: string }> {
  const email = normalizeEmail(emailRaw);
  return store.transaction((db) => {
    const user = db.users.find((u) => u.email === email);
    const generic = new AppError("unauthenticated", "Incorrect email or password.");
    if (!user || user.disabled) {
      // Burn comparable time so account existence isn't revealed by timing.
      verifyPassword(password, "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA$" + "A".repeat(86));
      throw generic;
    }
    const t = Date.now();
    if (user.failed && user.failed.count >= MAX_FAILED && t - Date.parse(user.failed.since) < LOCK_MINUTES * 60000)
      throw new AppError("rate_limited", `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes or reset your password.`);
    if (!verifyPassword(password, user.passwordHash)) throw generic; // failure is recorded by loginWithLockout
    user.failed = null;
    return { user, token: createSession(db, user.id) };
  });
}

/** login() cannot both throw and persist, so failed attempts are recorded through this wrapper. */
export async function loginWithLockout(store: Store, email: string, password: string) {
  try {
    return await login(store, email, password);
  } catch (e) {
    if (e instanceof AppError && e.code === "unauthenticated") {
      await store.transaction((db) => {
        const u = db.users.find((x) => x.email === normalizeEmail(email));
        if (!u) return;
        const t = Date.now();
        const fresh = !u.failed || t - Date.parse(u.failed.since) >= LOCK_MINUTES * 60000;
        u.failed = { count: fresh ? 1 : u.failed!.count + 1, since: fresh ? now() : u.failed!.since };
      });
    }
    throw e;
  }
}

export async function sessionUser(store: Store, token: string | undefined | null): Promise<User | null> {
  if (!token) return null;
  const h = hashToken(token);
  return store.read((db) => {
    const s = db.sessions.find((x) => x.tokenHash === h);
    if (!s || s.expiresAt < now()) return null;
    const u = db.users.find((x) => x.id === s.userId);
    return u && !u.disabled ? u : null;
  });
}

export async function logout(store: Store, token: string | undefined | null) {
  if (!token) return;
  const h = hashToken(token);
  await store.transaction((db) => {
    db.sessions = db.sessions.filter((s) => s.tokenHash !== h);
  });
}

/** Returns a reset token (null when the email is unknown — callers must respond identically either way). */
export function requestPasswordReset(store: Store, emailRaw: string): Promise<{ token: string; user: User } | null> {
  const email = normalizeEmail(emailRaw);
  return store.transaction((db) => {
    const user = db.users.find((u) => u.email === email && !u.disabled);
    if (!user) return null;
    const token = newToken();
    db.resetTokens = db.resetTokens.filter((r) => r.userId !== user.id && r.expiresAt > now());
    db.resetTokens.push({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_MINUTES * 60000).toISOString(), usedAt: null });
    return { token, user };
  });
}

export async function resetPassword(store: Store, token: string, newPassword: string) {
  validatePassword(newPassword);
  await store.transaction((db) => {
    const rec = db.resetTokens.find((r) => r.tokenHash === hashToken(token));
    if (!rec || rec.usedAt || rec.expiresAt < now()) throw invalid("This reset link is invalid or has expired. Request a new one.");
    const user = db.users.find((u) => u.id === rec.userId);
    if (!user) throw invalid("This reset link is invalid.");
    user.passwordHash = hashPassword(newPassword);
    user.failed = null;
    rec.usedAt = now();
    // Sign out everywhere after a reset.
    db.sessions = db.sessions.filter((s) => s.userId !== user.id);
  });
  log("info", "password_reset", {});
}

export async function changePassword(store: Store, userId: string, current: string, next: string) {
  validatePassword(next);
  await store.transaction((db) => {
    const u = db.users.find((x) => x.id === userId);
    if (!u || !verifyPassword(current, u.passwordHash)) throw invalid("Your current password is incorrect.");
    u.passwordHash = hashPassword(next);
  });
}
