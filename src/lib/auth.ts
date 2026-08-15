import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User, type UserRole } from "@/db/schema";
import { env } from "./env";
import { hashToken, newToken, safeEqual } from "./crypto";
import { verifyPassword } from "./password";
import { rateLimitAll, rateLimitReset, retryText } from "./rate-limit";
import { audit } from "./audit";

export const SESSION_COOKIE = "sk_session";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export type SafeUser = Pick<
  User,
  "id" | "email" | "name" | "role" | "dailyLinkLimit" | "batchLinkLimit" | "disabledAt"
>;

const safeCols = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  dailyLinkLimit: users.dailyLinkLimit,
  batchLinkLimit: users.batchLinkLimit,
  disabledAt: users.disabledAt,
};

/**
 * Best-effort client IP. Prefer Cloudflare's header (set by the trusted edge in
 * front of this app), then the LAST X-Forwarded-For entry (appended by the
 * platform proxy, not attacker-controlled), then x-real-ip. Used for logging and
 * as a secondary throttle key only; auth limits are per-account/global as well.
 */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const cf = h.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return h.get("x-real-ip") || "unknown";
}

// Verified against when the email is unknown so response time does not reveal
// whether an account exists (same scrypt cost as a real check).
const DUMMY_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Resolve the current user from the session cookie. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SafeUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 20) return null;
  const [row] = await db
    .select(safeCols)
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, sql`now()`), isNull(users.disabledAt)))
    .limit(1);
  return row ?? null;
});

export async function isAuthenticated(): Promise<boolean> {
  return (await getCurrentUser()) !== null;
}

/** Any signed-in user (admin or dev). */
export async function requireUser(): Promise<SafeUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

/** Admins only. Devs are sent to their own home. */
export async function requireAdmin(): Promise<SafeUser> {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/send");
  return u;
}

export function homeFor(role: UserRole) {
  return role === "admin" ? "/" : "/send";
}

async function startSession(userId: number): Promise<void> {
  const token = newToken(32);
  const h = await headers();
  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    ip: await clientIp(),
  });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export type LoginResult = { ok: true; role: UserRole } | { ok: false; error: string };

export async function loginWithPassword(emailRaw: string, password: string): Promise<LoginResult> {
  const ip = await clientIp();
  const email = emailRaw.trim().toLowerCase();
  const WINDOW = 15 * 60 * 1000;
  // Per-account lockout (cannot be dodged by changing IPs) + per-IP + global.
  const rl = await rateLimitAll([
    { key: `login:acct:${email}`, limit: 8, windowMs: WINDOW },
    { key: `login:ip:${ip}`, limit: 20, windowMs: WINDOW },
    { key: "login:global", limit: 300, windowMs: WINDOW },
  ]);
  if (!rl.ok) return { ok: false, error: retryText(rl) };

  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  // Always run scrypt so timing does not reveal whether the email exists.
  const ok = await verifyPassword(password, u?.passwordHash ?? DUMMY_HASH);
  if (!u || !ok) {
    await audit("auth.login.failed", { ip, details: { email } });
    return { ok: false, error: "Wrong email or password." };
  }
  if (u.disabledAt) return { ok: false, error: "This account is disabled." };
  if (!u.passwordHash) return { ok: false, error: "This account has not accepted its invite yet." };

  await rateLimitReset(`login:acct:${email}`);
  await startSession(u.id);
  await audit("auth.login", { userId: u.id, ip });
  return { ok: true, role: u.role };
}

/**
 * Break-glass: the ADMIN_PASSWORD env var signs in as the oldest admin.
 * Keeps you from being locked out if you forget your account password.
 */
export async function loginWithRecoveryPassword(password: string): Promise<LoginResult> {
  const ip = await clientIp();
  // Per-IP and a global cap: spoofing IPs buys nothing.
  const rl = await rateLimitAll([
    { key: `recovery:ip:${ip}`, limit: 5, windowMs: 15 * 60 * 1000 },
    { key: "recovery:global", limit: 20, windowMs: 60 * 60 * 1000 },
  ]);
  if (!rl.ok) return { ok: false, error: retryText(rl) };
  if (!safeEqual(password, env.ADMIN_PASSWORD)) {
    await audit("auth.recovery.failed", { ip });
    return { ok: false, error: "Wrong recovery password." };
  }
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, "admin"), isNull(users.disabledAt)))
    .orderBy(users.id)
    .limit(1);
  if (!admin) return { ok: false, error: "No admin account exists yet. Complete setup first." };
  await startSession(admin.id);
  await audit("auth.recovery", { userId: admin.id, ip });
  return { ok: true, role: admin.role };
}

export async function logout(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** True when no users exist yet → show the first-run setup page. */
export async function needsSetup(): Promise<boolean> {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return n === 0;
}

/** Sign in freshly after setup / invite acceptance. */
export async function signInAs(userId: number): Promise<void> {
  await startSession(userId);
}
