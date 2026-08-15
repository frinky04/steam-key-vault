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
import { rateLimit } from "./rate-limit";
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

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}

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
  const rl = rateLimit(`login:${ip}`, 8, 15 * 60 * 1000);
  if (!rl.ok) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} min.` };

  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const ok = u ? await verifyPassword(password, u.passwordHash) : false;
  if (!u || !ok) {
    await audit("auth.login.failed", { ip, details: { email } });
    return { ok: false, error: "Wrong email or password." };
  }
  if (u.disabledAt) return { ok: false, error: "This account is disabled." };
  if (!u.passwordHash) return { ok: false, error: "This account has not accepted its invite yet." };

  rateLimit(`login:${ip}`, 8, 15 * 60 * 1000, { reset: true });
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
  const rl = rateLimit(`recovery:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.ok) return { ok: false, error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfterMs / 60000)} min.` };
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
