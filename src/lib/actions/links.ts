"use server";

import { revalidatePath } from "next/cache";
import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { apps, claimLinkKeys, claimLinks, keys } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { hashToken, newToken } from "@/lib/crypto";
import { NO_EXPIRY } from "@/lib/expiry";
import { keyHasNoLiveLink } from "@/lib/link-sql";
import { lowStockThreshold, notifyBadKey, notifyLowStock, notifySent } from "@/lib/discord";
import { auditMany, audit } from "@/lib/audit";
import { env } from "@/lib/env";
import { headers } from "next/headers";
import type { ActionResult } from "./apps";

export type CreatedLink = {
  linkId: number;
  keyIds: number[];
  keyHints: string[];
  url: string;
  token: string;
  expiresAt: string;
};

async function baseUrl(): Promise<string> {
  if (process.env.NODE_ENV === "production") return env.PUBLIC_BASE_URL;
  // Dev convenience only: reflect the request host so `pnpm dev -p 3111` works.
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

/** Keys a dev has handed out (via links) since midnight UTC — their daily quota. */
type Executor = Pick<typeof db, "select">;
async function keysIssuedToday(userId: number, ex: Executor = db): Promise<number> {
  const [{ n }] = await ex
    .select({ n: sql<number>`count(*)::int` })
    .from(claimLinkKeys)
    .innerJoin(claimLinks, eq(claimLinks.id, claimLinkKeys.linkId))
    .where(and(eq(claimLinks.createdByUserId, userId), gte(claimLinks.createdAt, sql`date_trunc('day', now() at time zone 'utc')`)));
  return n;
}

type Selected = { id: number; keyHint: string; appId: number };
type Stock = { appId: number; appName: string; remaining: number; taken: number };
type TxResult = { error: string } | { created: CreatedLink[]; appIds: number[]; stock: Stock[] };

/**
 * Create claim links.
 *  - keyIds (admin table): explicit keys. `bundle: true` puts them all on ONE link, otherwise one link per key.
 *  - appId + count: pull the next `count` available keys from the pool; `keysPerLink` groups them
 *    (count must be a multiple of keysPerLink; e.g. count=6, keysPerLink=2 → 3 links).
 * Devs may only use appId+count and are bound by per-batch / per-day limits (counted in keys).
 */
export async function createClaimLinks(input: {
  keyIds?: number[];
  bundle?: boolean;
  appId?: number;
  count?: number;
  keysPerLink?: number;
  label?: string;
  ttlHours?: number;
}): Promise<ActionResult<CreatedLink[]>> {
  const user = await requireUser();
  const isDev = user.role !== "admin";
  const label = input.label?.trim() || null;

  // ttlHours 0 = never expires.
  const rawTtl = input.ttlHours == null ? 48 : Math.floor(input.ttlHours);
  const ttlHours = rawTtl <= 0 ? 0 : Math.min(Math.max(rawTtl, 1), 24 * 365);
  const expiresAt = ttlHours === 0 ? NO_EXPIRY : new Date(Date.now() + ttlHours * 3600 * 1000);
  const base = await baseUrl();

  const perLink = Math.min(Math.max(Math.floor(input.keysPerLink ?? 1), 1), 20);
  const wantedKeys = Math.floor(input.count ?? 0);

  if (isDev && input.keyIds?.length) return { ok: false, error: "Not allowed." };
  if (isDev && wantedKeys > user.batchLinkLimit) {
    return { ok: false, error: `You can hand out at most ${user.batchLinkLimit} keys at once.` };
  }
  if (input.appId && wantedKeys > 0 && wantedKeys % perLink !== 0) {
    return { ok: false, error: `Key count must be a multiple of keys-per-link (${perLink}).` };
  }

  const result = await db.transaction(async (tx): Promise<TxResult> => {
    let selected: Selected[];

    if (isDev) {
      // Serialise per-user quota checks so two concurrent requests cannot both pass.
      await tx.execute(sql`select pg_advisory_xact_lock(${user.id})`);
      const used = await keysIssuedToday(user.id, tx);
      const remaining = user.dailyLinkLimit - used;
      if (wantedKeys <= 0) return { error: "Choose how many keys to send." };
      if (remaining <= 0) return { error: `You have used all ${user.dailyLinkLimit} keys for today.` };
      if (wantedKeys > remaining) return { error: `Only ${remaining} key${remaining === 1 ? "" : "s"} left today (limit ${user.dailyLinkLimit}/day).` };
    }

    if (input.keyIds?.length) {
      const ids = [...new Set(input.keyIds)];
      selected = await tx
        .select({ id: keys.id, keyHint: keys.keyHint, appId: keys.appId })
        .from(keys)
        .where(and(inArray(keys.id, ids), inArray(keys.status, ["available", "reserved"]), keyHasNoLiveLink))
        .for("update");
      selected.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    } else if (input.appId && wantedKeys > 0) {
      const n = Math.min(wantedKeys, 500);
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
    if (input.appId && selected.length < wantedKeys) {
      return { error: `Only ${selected.length} key${selected.length === 1 ? "" : "s"} available for this game.` };
    }

    // Group into links.
    const groups: Selected[][] = [];
    if (input.keyIds?.length) {
      if (input.bundle) groups.push(selected);
      else for (const k of selected) groups.push([k]);
    } else {
      for (let i = 0; i < selected.length; i += perLink) groups.push(selected.slice(i, i + perLink));
    }

    const created: CreatedLink[] = [];
    for (const g of groups) {
      const token = newToken();
      const [link] = await tx
        .insert(claimLinks)
        .values({ tokenHash: hashToken(token), label, expiresAt, createdByUserId: user.id })
        .returning({ id: claimLinks.id });
      await tx.insert(claimLinkKeys).values(g.map((k, i) => ({ linkId: link.id, keyId: k.id, position: i })));
      created.push({
        linkId: link.id,
        keyIds: g.map((k) => k.id),
        keyHints: g.map((k) => k.keyHint),
        token,
        url: `${base}/claim/${token}`,
        expiresAt: expiresAt.toISOString(),
      });
    }

    await tx
      .update(keys)
      .set({ status: "reserved", assignee: label ?? undefined, updatedAt: new Date() })
      .where(inArray(keys.id, selected.map((k) => k.id)));

    const appOf = new Map(selected.map((s) => [s.id, s.appId]));
    await auditMany(
      "link.create",
      created.flatMap((c) =>
        c.keyIds.map((keyId) => ({ appId: appOf.get(keyId), keyId, details: { linkId: c.linkId, label, ttlHours, keysOnLink: c.keyIds.length } })),
      ),
      { tx, userId: user.id },
    );

    const appIds = [...new Set(selected.map((k) => k.appId))];
    const stock: Stock[] = [];
    for (const appId of appIds) {
      const [row] = await tx
        .select({
          name: apps.name,
          remaining: sql<number>`(select count(*)::int from ${keys} k where k.app_id = "apps"."id" and k.status = 'available')`,
        })
        .from(apps)
        .where(eq(apps.id, appId));
      if (row) stock.push({ appId, appName: row.name, remaining: row.remaining, taken: selected.filter((k) => k.appId === appId).length });
    }
    return { created, appIds, stock };
  });

  if ("error" in result) return { ok: false, error: result.error };
  const threshold = lowStockThreshold();
  for (const s of result.stock) {
    notifySent({ appName: s.appName, count: s.taken, links: result.created.length, senderName: user.name, label, remaining: s.remaining });
    if (s.remaining <= threshold && s.remaining + s.taken > threshold) notifyLowStock({ appName: s.appName, remaining: s.remaining });
  }
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
      .returning({ id: claimLinks.id });
    if (rows.length === 0) return { revoked: 0, appIds: [] as number[] };
    const lk = await tx
      .select({ keyId: claimLinkKeys.keyId, linkId: claimLinkKeys.linkId })
      .from(claimLinkKeys)
      .where(inArray(claimLinkKeys.linkId, rows.map((r) => r.id)));
    const keyIds = [...new Set(lk.map((r) => r.keyId))];
    const released = keyIds.length
      ? await tx
          .update(keys)
          .set({ status: "available", assignee: null, updatedAt: new Date() })
          .where(and(inArray(keys.id, keyIds), eq(keys.status, "reserved"), keyHasNoLiveLink))
          .returning({ appId: keys.appId })
      : [];
    await auditMany("link.revoke", lk.map((r) => ({ keyId: r.keyId, details: { linkId: r.linkId } })), { tx, userId: user.id });
    return { revoked: rows.length, appIds: released.map((r) => r.appId) };
  });
  revalidateAll(out.appIds);
  return { ok: true, data: { revoked: out.revoked } };
}

/**
 * A recipient says a key did not work. Marks it invalid so it is never re-issued.
 * For multi-key links pass keyId; if omitted and the link has one key, that key is used.
 * Devs may only report their own links.
 */
export async function reportBadKey(linkId: number, note?: string, keyId?: number): Promise<ActionResult> {
  const user = await requireUser();
  const ownership = user.role === "admin" ? undefined : eq(claimLinks.createdByUserId, user.id);
  const [link] = await db
    .select({ id: claimLinks.id, revealedAt: claimLinks.revealedAt, label: claimLinks.label })
    .from(claimLinks)
    .where(and(eq(claimLinks.id, linkId), ownership))
    .limit(1);
  if (!link) return { ok: false, error: "Link not found." };
  if (!link.revealedAt) return { ok: false, error: "That link has not been opened yet, so the key was never seen." };
  const lk = await db.select({ keyId: claimLinkKeys.keyId }).from(claimLinkKeys).where(eq(claimLinkKeys.linkId, linkId));
  const target = keyId ?? (lk.length === 1 ? lk[0].keyId : undefined);
  if (!target || !lk.some((r) => r.keyId === target)) return { ok: false, error: "Choose which key on this link was bad." };
  const [k] = await db
    .update(keys)
    .set({ status: "invalid", note: note?.trim() ? `Reported bad: ${note.trim().slice(0, 200)}` : "Reported bad by recipient", updatedAt: new Date() })
    .where(eq(keys.id, target))
    .returning({ appId: keys.appId, keyHint: keys.keyHint });
  await audit("key.reported_bad", { userId: user.id, keyId: target, appId: k?.appId, details: { linkId, note: note?.trim() || undefined } });
  if (k) {
    const [app] = await db.select({ name: apps.name }).from(apps).where(eq(apps.id, k.appId));
    notifyBadKey({ appName: app?.name ?? "Unknown app", keyHint: k.keyHint, reporterName: user.name, label: link.label, note: note?.trim() || undefined });
  }
  revalidateAll(k ? [k.appId] : []);
  return { ok: true };
}
