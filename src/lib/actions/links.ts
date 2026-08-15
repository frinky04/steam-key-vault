"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { claimLinks, keys } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hashToken, newToken } from "@/lib/crypto";
import { NO_EXPIRY } from "@/lib/expiry";
import { auditMany, audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { headers } from "next/headers";
import type { ActionResult } from "./apps";

export type CreatedLink = { keyId: number; keyHint: string; url: string; token: string; expiresAt: string };

async function baseUrl(): Promise<string> {
  if (env.APP_URL) return env.APP_URL;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

function revalidateAll(appIds: Iterable<number>) {
  revalidatePath("/");
  revalidatePath("/links");
  revalidatePath("/send");
  revalidatePath("/my-links");
  for (const id of new Set(appIds)) revalidatePath(`/apps/${id}`);
}

/** Links a dev has created since midnight UTC (their daily quota window). */
type Executor = Pick<typeof db, "select">;
async function linksCreatedToday(userId: number, ex: Executor = db): Promise<number> {
  const [{ n }] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(claimLinks)
    .where(and(eq(claimLinks.createdByUserId, userId), gte(claimLinks.createdAt, sql`date_trunc('day', now() at time zone 'utc')`)));
  return n;
}

/**
 * Create claim links. Either pass explicit keyIds (admin table) or appId+count
 * to pull the next N available keys from the pool atomically. Devs may only use
 * appId+count and are bound by their per-batch / per-day / TTL limits.
 */
export async function createClaimLinks(input: {
  keyIds?: number[];
  appId?: number;
  count?: number;
  label?: string;
  ttlHours?: number;
}): Promise<ActionResult<CreatedLink[]>> {
  const user = await requireUser();
  const isDev = user.role !== "admin";
  const label = input.label?.trim() || null;

  // ttlHours 0 (or null) = never expires (stored as the far-future NO_EXPIRY sentinel).
  const rawTtl = input.ttlHours == null ? 48 : Math.floor(input.ttlHours);
  const ttlHours = rawTtl <= 0 ? 0 : Math.min(Math.max(rawTtl, 1), 24 * 365);
  const expiresAt = ttlHours === 0 ? NO_EXPIRY : new Date(Date.now() + ttlHours * 3600 * 1000);
  const base = await baseUrl();

  if (isDev && input.keyIds?.length) return { ok: false, error: "Not allowed." };
  if (isDev && input.appId && input.count && input.count > user.batchLinkLimit) {
    return { ok: false, error: `You can create at most ${user.batchLinkLimit} links at once.` };
  }

  const result = await db.transaction(async (tx): Promise<{ error: string } | { created: CreatedLink[]; appIds: number[] }> => {
    let selected: { id: number; keyHint: string; appId: number }[];

    if (isDev) {
      // Serialise per-user quota checks so two concurrent requests cannot both pass.
      await tx.execute(sql`select pg_advisory_xact_lock(${user.id})`);
      const used = await linksCreatedToday(user.id, tx);
      const remaining = user.dailyLinkLimit - used;
      const wanted = Math.floor(input.count ?? 0);
      if (wanted <= 0) return { error: "Choose how many links to create." };
      if (remaining <= 0) return { error: `You have used all ${user.dailyLinkLimit} links for today.` };
      if (wanted > remaining) return { error: `Only ${remaining} link${remaining === 1 ? "" : "s"} left today (limit ${user.dailyLinkLimit}/day).` };
    }

    if (input.keyIds?.length) {
      const ids = [...new Set(input.keyIds)];
      selected = await tx
        .select({ id: keys.id, keyHint: keys.keyHint, appId: keys.appId })
        .from(keys)
        .where(
          and(
            inArray(keys.id, ids),
            inArray(keys.status, ["available", "reserved"]),
            sql`not exists (select 1 from ${claimLinks} cl where cl.key_id = ${keys.id} and cl.revealed_at is null and cl.revoked_at is null and cl.expires_at > now())`,
          ),
        )
        .for("update");
    } else if (input.appId && input.count) {
      const n = Math.min(Math.max(Math.floor(input.count), 1), 500);
      selected = await tx
        .select({ id: keys.id, keyHint: keys.keyHint, appId: keys.appId })
        .from(keys)
        .where(and(eq(keys.appId, input.appId), eq(keys.status, "available")))
        .orderBy(keys.id)
        .limit(n)
        .for("update", { skipLocked: true });
    } else {
      return { error: "Provide keyIds or appId+count." };
    }

    if (selected.length === 0) return { error: "No eligible keys (none available, or already linked/claimed/used)." };
    if (isDev && input.count && selected.length < input.count) {
      // Don't silently hand out fewer than asked; devs should know the pool is short.
      return { error: `Only ${selected.length} key${selected.length === 1 ? "" : "s"} available for this game.` };
    }

    const rows = selected.map((k) => {
      const token = newToken();
      return { k, token, tokenHash: hashToken(token) };
    });

    await tx.insert(claimLinks).values(
      rows.map((r) => ({ keyId: r.k.id, tokenHash: r.tokenHash, label, expiresAt, createdByUserId: user.id })),
    );
    await tx
      .update(keys)
      .set({ status: "reserved", assignee: label ?? undefined, updatedAt: new Date() })
      .where(inArray(keys.id, selected.map((k) => k.id)));

    await auditMany(
      "link.create",
      rows.map((r) => ({ appId: r.k.appId, keyId: r.k.id, details: { label, ttlHours } })),
      { tx, userId: user.id },
    );

    return {
      created: rows.map<CreatedLink>((r) => ({
        keyId: r.k.id,
        keyHint: r.k.keyHint,
        token: r.token,
        url: `${base}/claim/${r.token}`,
        expiresAt: expiresAt.toISOString(),
      })),
      appIds: selected.map((k) => k.appId),
    };
  });

  if ("error" in result) return { ok: false, error: result.error };
  revalidateAll(result.appIds);
  return { ok: true, data: result.created };
}

/** Revoke outstanding links and return their keys to the pool. Devs can only revoke their own. */
export async function revokeLinks(linkIds: number[]): Promise<ActionResult<{ revoked: number }>> {
  const user = await requireUser();
  const ids = [...new Set(linkIds)];
  if (ids.length === 0) return { ok: false, error: "Nothing selected." };
  const out = await db.transaction(async (tx) => {
    const ownership = user.role === "admin" ? undefined : eq(claimLinks.createdByUserId, user.id);
    const rows = await tx
      .update(claimLinks)
      .set({ revokedAt: new Date() })
      .where(and(inArray(claimLinks.id, ids), isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt), ownership))
      .returning({ id: claimLinks.id, keyId: claimLinks.keyId });
    if (rows.length === 0) return { revoked: 0, appIds: [] as number[] };
    const keyIds = rows.map((r) => r.keyId);
    const released = await tx
      .update(keys)
      .set({ status: "available", assignee: null, updatedAt: new Date() })
      .where(
        and(
          inArray(keys.id, keyIds),
          eq(keys.status, "reserved"),
          sql`not exists (select 1 from ${claimLinks} cl where cl.key_id = ${keys.id} and cl.revealed_at is null and cl.revoked_at is null and cl.expires_at > now())`,
        ),
      )
      .returning({ appId: keys.appId });
    await auditMany("link.revoke", rows.map((r) => ({ keyId: r.keyId, details: { linkId: r.id } })), { tx, userId: user.id });
    return { revoked: rows.length, appIds: released.map((r) => r.appId) };
  });
  revalidateAll(out.appIds);
  return { ok: true, data: { revoked: out.revoked } };
}

/**
 * A recipient says the key did not work. Marks the key invalid so it is never
 * re-issued, and records who reported it. Devs may only report their own links.
 */
export async function reportBadKey(linkId: number, note?: string): Promise<ActionResult> {
  const user = await requireUser();
  const ownership = user.role === "admin" ? undefined : eq(claimLinks.createdByUserId, user.id);
  const [link] = await db
    .select({ id: claimLinks.id, keyId: claimLinks.keyId, revealedAt: claimLinks.revealedAt })
    .from(claimLinks)
    .where(and(eq(claimLinks.id, linkId), ownership))
    .limit(1);
  if (!link) return { ok: false, error: "Link not found." };
  if (!link.revealedAt) return { ok: false, error: "That link has not been opened yet, so the key was never seen." };
  const [k] = await db
    .update(keys)
    .set({ status: "invalid", note: note?.trim() ? `Reported bad: ${note.trim().slice(0, 200)}` : "Reported bad by recipient", updatedAt: new Date() })
    .where(eq(keys.id, link.keyId))
    .returning({ appId: keys.appId });
  await audit("key.reported_bad", { userId: user.id, keyId: link.keyId, appId: k?.appId, details: { linkId, note: note?.trim() || undefined } });
  revalidateAll(k ? [k.appId] : []);
  return { ok: true };
}

