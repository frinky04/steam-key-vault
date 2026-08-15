import "server-only";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { apps, claimLinkKeys, claimLinks, keys, users } from "@/db/schema";
import { decryptKey, hashToken, safeEqual } from "@/lib/crypto";
import { auditMany } from "@/lib/audit";
import { notifyClaimed } from "@/lib/discord";

export const CLAIM_GRACE_MS = 24 * 60 * 60 * 1000; // re-view window after reveal

/** One key as shown on the claim page. */
export type ClaimKey = { key: string; appName: string; steamAppId: number | null };

export type ClaimView =
  | { state: "not_found" }
  | { state: "expired"; appName: string }
  | { state: "revoked"; appName: string }
  | { state: "already_claimed"; appName: string; revealedAt: Date }
  | {
      state: "ready";
      appName: string; // primary app (first key)
      headerImage: string | null;
      steamAppId: number | null;
      label: string | null;
      expiresAt: Date;
      keyCount: number;
      appNames: string[]; // distinct, in order
    }
  | {
      state: "revealed";
      appName: string;
      headerImage: string | null;
      steamAppId: number | null;
      keys: ClaimKey[];
      revealedAt: Date;
    };

function graceCookieName(tokenHash: string) {
  return `sk_claim_${tokenHash.slice(0, 16)}`;
}

type LinkKeyRow = {
  keyId: number;
  keyCiphertext: string;
  keyHint: string;
  appId: number;
  appName: string;
  headerImage: string | null;
  steamAppId: number | null;
};

async function loadLinkKeys(linkId: number): Promise<LinkKeyRow[]> {
  return db
    .select({
      keyId: keys.id,
      keyCiphertext: keys.keyCiphertext,
      keyHint: keys.keyHint,
      appId: apps.id,
      appName: apps.name,
      headerImage: apps.headerImage,
      steamAppId: apps.steamAppId,
    })
    .from(claimLinkKeys)
    .innerJoin(keys, eq(keys.id, claimLinkKeys.keyId))
    .innerJoin(apps, eq(apps.id, keys.appId))
    .where(eq(claimLinkKeys.linkId, linkId))
    .orderBy(asc(claimLinkKeys.position), asc(claimLinkKeys.id));
}

async function loadLink(token: string) {
  const tokenHash = hashToken(token);
  const [link] = await db
    .select({
      id: claimLinks.id,
      label: claimLinks.label,
      expiresAt: claimLinks.expiresAt,
      revealedAt: claimLinks.revealedAt,
      revokedAt: claimLinks.revokedAt,
      createdByUserId: claimLinks.createdByUserId,
    })
    .from(claimLinks)
    .where(eq(claimLinks.tokenHash, tokenHash))
    .limit(1);
  if (!link) return { tokenHash, link: null, keys: [] as LinkKeyRow[] };
  return { tokenHash, link, keys: await loadLinkKeys(link.id) };
}

const distinct = <T,>(xs: T[]): T[] => [...new Set(xs)];

export async function getClaimView(token: string): Promise<ClaimView> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { state: "not_found" };
  const { tokenHash, link, keys: lk } = await loadLink(token);
  if (!link || lk.length === 0) return { state: "not_found" };
  const first = lk[0];

  if (link.revealedAt) {
    // Grace period: same browser can re-view the keys shortly after revealing them.
    const jar = await cookies();
    const c = jar.get(graceCookieName(tokenHash))?.value;
    const withinGrace = Date.now() - link.revealedAt.getTime() < CLAIM_GRACE_MS;
    if (c && withinGrace && safeEqual(c, token)) {
      return {
        state: "revealed",
        appName: first.appName,
        headerImage: first.headerImage,
        steamAppId: first.steamAppId,
        keys: lk.map((k) => ({ key: decryptKey(k.keyCiphertext), appName: k.appName, steamAppId: k.steamAppId })),
        revealedAt: link.revealedAt,
      };
    }
    return { state: "already_claimed", appName: first.appName, revealedAt: link.revealedAt };
  }
  if (link.revokedAt) return { state: "revoked", appName: first.appName };
  if (link.expiresAt.getTime() < Date.now()) return { state: "expired", appName: first.appName };
  return {
    state: "ready",
    appName: first.appName,
    headerImage: first.headerImage,
    steamAppId: first.steamAppId,
    label: link.label,
    expiresAt: link.expiresAt,
    keyCount: lk.length,
    appNames: distinct(lk.map((k) => k.appName)),
  };
}

/**
 * Atomically consume the link and reveal its keys. Exactly one caller wins the
 * UPDATE; everyone else sees `already_claimed`.
 */
export async function consumeClaim(token: string, meta: { ip: string; userAgent: string }): Promise<ClaimView> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { state: "not_found" };
  const tokenHash = hashToken(token);

  const result = await db.transaction(async (tx) => {
    const [won] = await tx
      .update(claimLinks)
      .set({ revealedAt: new Date(), revealIp: meta.ip, revealUserAgent: meta.userAgent.slice(0, 300) })
      .where(
        and(
          eq(claimLinks.tokenHash, tokenHash),
          isNull(claimLinks.revealedAt),
          isNull(claimLinks.revokedAt),
          sql`${claimLinks.expiresAt} > now()`,
        ),
      )
      .returning({ id: claimLinks.id, label: claimLinks.label, createdByUserId: claimLinks.createdByUserId });
    if (!won) return null;

    const lk = await tx.select({ keyId: claimLinkKeys.keyId }).from(claimLinkKeys).where(eq(claimLinkKeys.linkId, won.id));
    const keyIds = lk.map((k) => k.keyId);
    const updated = keyIds.length
      ? await tx
          .update(keys)
          .set({ status: "claimed", assignee: won.label ?? undefined, updatedAt: new Date() })
          .where(inArray(keys.id, keyIds))
          .returning({ id: keys.id, appId: keys.appId, keyHint: keys.keyHint })
      : [];

    await auditMany(
      "link.claimed",
      updated.map((k) => ({ appId: k.appId, keyId: k.id, details: { linkId: won.id, label: won.label, ua: meta.userAgent.slice(0, 120) } })),
      { tx, ip: meta.ip },
    );

    let senderName: string | null = null;
    if (won.createdByUserId) {
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, won.createdByUserId));
      senderName = u?.name ?? null;
    }
    const appIds = distinct(updated.map((k) => k.appId));
    const appRows = appIds.length
      ? await tx
          .select({
            id: apps.id,
            name: apps.name,
            remaining: sql<number>`(select count(*)::int from ${keys} k where k.app_id = "apps"."id" and k.status = 'available')`,
          })
          .from(apps)
          .where(inArray(apps.id, appIds))
      : [];
    return { won, updated, senderName, appRows };
  });

  if (result) {
    const primary = result.appRows.find((a) => a.id === result.updated[0]?.appId) ?? result.appRows[0];
    notifyClaimed({
      appName: result.appRows.length > 1 ? result.appRows.map((a) => a.name).join(" + ") : (primary?.name ?? "Unknown app"),
      label: result.won.label,
      senderName: result.senderName,
      keyHints: result.updated.map((k) => k.keyHint),
      remaining: primary?.remaining ?? 0,
    });
    const jar = await cookies();
    jar.set(graceCookieName(tokenHash), token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: `/claim/${token}`,
      maxAge: CLAIM_GRACE_MS / 1000,
    });
  }
  // Re-read for a consistent view (handles the lost-race path too).
  return getClaimView(token);
}

export type ClaimPreview = {
  appName: string;
  appNames: string[];
  keyCount: number;
  headerImage: string | null;
  steamAppId: number | null;
  live: boolean; // still claimable
  expiresAt: Date | null;
};

/** Cookie-free lookup for metadata / OG images. Never reveals the keys. */
export async function getClaimPreview(token: string): Promise<ClaimPreview | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { link, keys: lk } = await loadLink(token);
  if (!link || lk.length === 0) return null;
  const live = !link.revealedAt && !link.revokedAt && link.expiresAt.getTime() > Date.now();
  return {
    appName: lk[0].appName,
    appNames: distinct(lk.map((k) => k.appName)),
    keyCount: lk.length,
    headerImage: lk[0].headerImage,
    steamAppId: lk[0].steamAppId,
    live,
    expiresAt: live ? link.expiresAt : null,
  };
}
