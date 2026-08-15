"use server";

import { redirect } from "next/navigation";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  homeFor,
  loginWithPassword,
  loginWithRecoveryPassword,
  logout,
  needsSetup,
  signInAs,
  clientIp,
} from "@/lib/auth";
import { env } from "@/lib/env";
import { hashToken, safeEqual } from "@/lib/crypto";
import { hashPassword, passwordProblem } from "@/lib/password";
import { audit } from "@/lib/audit";
import { rateLimitAll, retryText } from "@/lib/rate-limit";

export type FormState = { error?: string; values?: Record<string, string> };

function safeNext(next: unknown, fallback: string) {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const res = await loginWithPassword(email, password);
  if (!res.ok) return { error: res.error, values: { email } };
  redirect(safeNext(formData.get("next"), homeFor(res.role)));
}

export async function recoveryLoginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const password = String(formData.get("password") ?? "");
  const res = await loginWithRecoveryPassword(password);
  if (!res.ok) return { error: res.error };
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await logout();
  redirect("/login");
}

/** First run: create the initial admin, gated by ADMIN_PASSWORD. */
export async function setupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!(await needsSetup())) return { error: "Setup has already been completed." };
  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `setup:ip:${ip}`, limit: 5, windowMs: 15 * 60 * 1000 },
    { key: "setup:global", limit: 20, windowMs: 60 * 60 * 1000 },
  ]);
  if (!rl.ok) return { error: retryText(rl) };

  const setupCode = String(formData.get("setupCode") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const values = { email, name };
  if (!safeEqual(setupCode, env.ADMIN_PASSWORD)) return { error: "Setup code is wrong (it is the ADMIN_PASSWORD env var).", values };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email.", values };
  if (!name) return { error: "Name is required.", values };
  const pp = passwordProblem(password);
  if (pp) return { error: pp, values };

  const [u] = await db
    .insert(users)
    .values({ email, name, role: "admin", passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  await audit("user.setup", { userId: u.id, ip, details: { email } });
  await signInAs(u.id);
  redirect("/");
}

export type InviteInfo = { ok: true; name: string; email: string; isReset: boolean } | { ok: false; error: string };

export async function inviteInfo(token: string): Promise<InviteInfo> {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return { ok: false, error: "Invalid invite link." };
  const [u] = await db
    .select({ name: users.name, email: users.email, hasPassword: sql<boolean>`${users.passwordHash} is not null` })
    .from(users)
    .where(and(eq(users.inviteTokenHash, hashToken(token)), gt(users.inviteExpiresAt, sql`now()`), isNull(users.disabledAt)))
    .limit(1);
  if (!u) return { ok: false, error: "This invite link is invalid or has expired. Ask an admin for a new one." };
  return { ok: true, name: u.name, email: u.email, isReset: u.hasPassword };
}

/** Accept an invite (or password reset): set a password and sign in. */
export async function acceptInviteAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const ip = await clientIp();
  const rl = await rateLimitAll([
    { key: `invite:ip:${ip}`, limit: 10, windowMs: 15 * 60 * 1000 },
    { key: "invite:global", limit: 60, windowMs: 60 * 60 * 1000 },
  ]);
  if (!rl.ok) return { error: retryText(rl) };
  const pp = passwordProblem(password);
  if (pp) return { error: pp };
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return { error: "Invalid invite link." };

  const [u] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), inviteTokenHash: null, inviteExpiresAt: null })
    .where(and(eq(users.inviteTokenHash, hashToken(token)), gt(users.inviteExpiresAt, sql`now()`), isNull(users.disabledAt)))
    .returning({ id: users.id, role: users.role });
  if (!u) return { error: "This invite link is invalid or has expired." };
  await audit("user.invite.accepted", { userId: u.id, ip });
  await signInAs(u.id);
  redirect(homeFor(u.role));
}
