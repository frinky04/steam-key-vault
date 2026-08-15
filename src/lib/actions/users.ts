"use server";

import { revalidatePath } from "next/cache";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { claimLinkKeys, claimLinks, keys, sessions, users, type UserRole } from "@/db/schema";
import { keyHasNoLiveLink } from "@/lib/link-sql";
import { requireAdmin } from "@/lib/auth";
import { hashToken, newToken } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { headers } from "next/headers";
import type { ActionResult } from "./apps";

const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

async function baseUrl(): Promise<string> {
  if (process.env.NODE_ENV === "production") return env.PUBLIC_BASE_URL;
  // Dev convenience only: reflect the request host so `pnpm dev -p 3111` works.
  if (env.APP_URL) return env.APP_URL;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

async function issueInvite(userId: number): Promise<{ url: string; expiresAt: Date }> {
  const token = newToken(32);
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await db.update(users).set({ inviteTokenHash: hashToken(token), inviteExpiresAt: expiresAt }).where(eq(users.id, userId));
  return { url: `${await baseUrl()}/invite/${token}`, expiresAt };
}

export type Limits = { dailyLinkLimit: number; batchLinkLimit: number };

function cleanLimits(l: Partial<Limits>): Limits {
  const clamp = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.floor(n))) : d;
  };
  return {
    dailyLinkLimit: clamp(l.dailyLinkLimit, 0, 10000, 20),
    batchLinkLimit: clamp(l.batchLinkLimit, 1, 500, 10),
  };
}

/** Create a user and return a one-time invite link (shown once). */
export async function inviteUser(input: {
  email: string;
  name: string;
  role: UserRole;
  limits?: Partial<Limits>;
}): Promise<ActionResult<{ id: number; url: string; expiresAt: string }>> {
  const admin = await requireAdmin();
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
  if (!name) return { ok: false, error: "Name is required." };
  const role: UserRole = input.role === "admin" ? "admin" : "dev";
  try {
    const [u] = await db
      .insert(users)
      .values({ email, name, role, ...cleanLimits(input.limits ?? {}) })
      .returning({ id: users.id });
    const inv = await issueInvite(u.id);
    await audit("user.invite", { userId: admin.id, details: { targetUserId: u.id, email, role } });
    revalidatePath("/users");
    return { ok: true, data: { id: u.id, url: inv.url, expiresAt: inv.expiresAt.toISOString() } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("users_email_uq")) return { ok: false, error: "A user with that email already exists." };
    return { ok: false, error: msg };
  }
}

/** New invite / password-reset link for an existing user. Also ends their sessions. */
export async function resetUserPassword(userId: number): Promise<ActionResult<{ url: string; expiresAt: string }>> {
  const admin = await requireAdmin();
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!u) return { ok: false, error: "User not found." };
  const inv = await issueInvite(userId);
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await audit("user.reset", { userId: admin.id, details: { targetUserId: userId } });
  revalidatePath("/users");
  return { ok: true, data: { url: inv.url, expiresAt: inv.expiresAt.toISOString() } };
}

export async function setUserDisabled(userId: number, disabled: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "You cannot disable yourself." };
  await db.update(users).set({ disabledAt: disabled ? new Date() : null }).where(eq(users.id, userId));
  if (disabled) await db.delete(sessions).where(eq(sessions.userId, userId));
  await audit(disabled ? "user.disable" : "user.enable", { userId: admin.id, details: { targetUserId: userId } });
  revalidatePath("/users");
  return { ok: true };
}

export async function updateUser(
  userId: number,
  input: { name?: string; role?: UserRole; limits?: Partial<Limits> },
): Promise<ActionResult> {
  const admin = await requireAdmin();
  const set: Partial<typeof users.$inferInsert> = {};
  if (input.name !== undefined) {
    const n = input.name.trim();
    if (!n) return { ok: false, error: "Name is required." };
    set.name = n;
  }
  if (input.role !== undefined) {
    if (userId === admin.id && input.role !== "admin") return { ok: false, error: "You cannot demote yourself." };
    set.role = input.role === "admin" ? "admin" : "dev";
  }
  if (input.limits) Object.assign(set, cleanLimits({ ...(await currentLimits(userId)), ...input.limits }));
  if (Object.keys(set).length === 0) return { ok: true };
  await db.update(users).set(set).where(eq(users.id, userId));
  await audit("user.update", { userId: admin.id, details: { targetUserId: userId, ...set } });
  revalidatePath("/users");
  return { ok: true };
}

async function currentLimits(userId: number): Promise<Limits> {
  const [u] = await db
    .select({ dailyLinkLimit: users.dailyLinkLimit, batchLinkLimit: users.batchLinkLimit })
    .from(users)
    .where(eq(users.id, userId));
  return u ?? cleanLimits({});
}

export async function deleteUser(userId: number): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (userId === admin.id) return { ok: false, error: "You cannot delete yourself." };
  // Keep at least one admin around.
  const [{ admins }] = await db
    .select({ admins: sql<number>`count(*)::int` })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, userId)));
  if (admins === 0) return { ok: false, error: "Cannot delete the last admin." };
  const revokedCount = await db.transaction(async (tx) => {
    // Revoke the user's unopened links and return those keys to the pool.
    const revoked = await tx
      .update(claimLinks)
      .set({ revokedAt: new Date() })
      .where(and(eq(claimLinks.createdByUserId, userId), sql`${claimLinks.revealedAt} is null`, sql`${claimLinks.revokedAt} is null`))
      .returning({ id: claimLinks.id });
    if (revoked.length) {
      const lk = await tx
        .select({ keyId: claimLinkKeys.keyId })
        .from(claimLinkKeys)
        .where(sql`${claimLinkKeys.linkId} in (${sql.join(revoked.map((r) => sql`${r.id}`), sql`, `)})`);
      if (lk.length) {
        await tx
          .update(keys)
          .set({ status: "available", assignee: null, updatedAt: new Date() })
          .where(
            and(
              sql`${keys.id} in (${sql.join(lk.map((r) => sql`${r.keyId}`), sql`, `)})`,
              eq(keys.status, "reserved"),
              keyHasNoLiveLink,
            ),
          );
      }
    }
    await tx.delete(users).where(eq(users.id, userId));
    return revoked.length;
  });
  await audit("user.delete", { userId: admin.id, details: { targetUserId: userId, revokedLinks: revokedCount } });
  revalidatePath("/links");
  revalidatePath("/");
  revalidatePath("/users");
  return { ok: true };
}
