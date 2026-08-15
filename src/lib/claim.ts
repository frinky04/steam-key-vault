import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { apps, claimLinks, keys } from "@/db/schema";
import { decryptKey, hashToken, safeEqual } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { notifyClaimed } from "@/lib/discord";
import { users } from "@/db/schema";

export const CLAIM_GRACE_MS = 24 * 60 * 60 * 1000; // re-view window after reveal

export type ClaimView =
  | { state: "not_found" }
  | { state: "expired"; appName: string }
  | { state: "revoked"; appName: string }
  | { state: "already_claimed"; appName: string; revealedAt: Date }
  | {
      state: "ready";
      appName: string;
      headerImage: string | null;
      steamAppId: number | null;
      label: string | null;
      expiresAt: Date;
    }
  | {
      state: "revealed";
      appName: string;
      headerImage: string | null;
      steamAppId: number | null;
      key: string;
      revealedAt: Date;
    };

function graceCookieName(tokenHash: string) {
  return `sk_claim_${tokenHash.slice(0, 16)}`;
}

async function loadLink(token: string) {
  const tokenHash = hashToken(token);
  const row = await db
    .select({
      id: claimLinks.id,
      keyId: claimLinks.keyId,
      label: claimLinks.label,
      expiresAt: claimLinks.expiresAt,
      revealedAt: claimLinks.revealedAt,
      revokedAt: claimLinks.revokedAt,
      keyCiphertext: keys.keyCiphertext,
      keyStatus: keys.status,
      appId: apps.id,
      appName: apps.name,
      headerImage: apps.headerImage,
      steamAppId: apps.steamAppId,
    })
    .from(claimLinks)
    .innerJoin(keys, eq(keys.id, claimLinks.keyId))
    .innerJoin(apps, eq(apps.id, keys.appId))
    .where(eq(claimLinks.tokenHash, tokenHash))
    .limit(1);
  return { tokenHash, link: row[0] ?? null };
}

export async function getClaimView(token: string): Promise<ClaimView> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { state: "not_found" };
  const { tokenHash, link } = await loadLink(token);
  if (!link) return { state: "not_found" };

  if (link.revealedAt) {
    // Grace period: same browser can re-view the key shortly after revealing it.
    const jar = await cookies();
    const c = jar.get(graceCookieName(tokenHash))?.value;
    const withinGrace = Date.now() - link.revealedAt.getTime() < CLAIM_GRACE_MS;
    if (c && withinGrace && safeEqual(c, token)) {
      return {
        state: "revealed",
        appName: link.appName,
        headerImage: link.headerImage,
        steamAppId: link.steamAppId,
        key: decryptKey(link.keyCiphertext),
        revealedAt: link.revealedAt,
      };
    }
    return { state: "already_claimed", appName: link.appName, revealedAt: link.revealedAt };
  }
  if (link.revokedAt) return { state: "revoked", appName: link.appName };
  if (link.expiresAt.getTime() < Date.now()) return { state: "expired", appName: link.appName };
  return {
    state: "ready",
    appName: link.appName,
    headerImage: link.headerImage,
    steamAppId: link.steamAppId,
    label: link.label,
    expiresAt: link.expiresAt,
  };
}

/**
 * Atomically consume the link and reveal the key. Exactly one caller wins the
 * UPDATE; everyone else sees `already_claimed`.
 */
export async function consumeClaim(
  token: string,
  meta: { ip: string; userAgent: string },
): Promise<ClaimView> {
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
      .returning({ id: claimLinks.id, keyId: claimLinks.keyId, label: claimLinks.label, createdByUserId: claimLinks.createdByUserId });
    if (!won) return null;

    const [k] = await tx
      .update(keys)
      .set({ status: "claimed", assignee: won.label ?? undefined, updatedAt: new Date() })
      .where(eq(keys.id, won.keyId))
      .returning({ appId: keys.appId, keyHint: keys.keyHint });
    await audit("link.claimed", {
      appId: k?.appId,
      keyId: won.keyId,
      ip: meta.ip,
      details: { linkId: won.id, label: won.label, ua: meta.userAgent.slice(0, 120) },
      tx,
    });

    // Feed data for the Discord notification (best-effort, inside the tx for consistency).
    let senderName: string | null = null;
    if (won.createdByUserId) {
      const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, won.createdByUserId));
      senderName = u?.name ?? null;
    }
    const [app] = k ? await tx.select({ name: apps.name }).from(apps).where(eq(apps.id, k.appId)) : [];
    const [{ remaining }] = k
      ? await tx
          .select({ remaining: sql<number>`count(*)::int` })
          .from(keys)
          .where(and(eq(keys.appId, k.appId), eq(keys.status, "available")))
      : [{ remaining: 0 }];
    return { ...won, appName: app?.name ?? "Unknown app", keyHint: k?.keyHint ?? "", senderName, remaining };
  });

  if (result) {
    notifyClaimed({
      appName: result.appName,
      label: result.label,
      senderName: result.senderName,
      keyHint: result.keyHint,
      remaining: result.remaining,
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
  headerImage: string | null;
  steamAppId: number | null;
  live: boolean; // still claimable
  expiresAt: Date | null;
};

/** Cookie-free lookup for metadata / OG images. Never reveals the key. */
export async function getClaimPreview(token: string): Promise<ClaimPreview | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const { link } = await loadLink(token);
  if (!link) return null;
  const live = !link.revealedAt && !link.revokedAt && link.expiresAt.getTime() > Date.now();
  return {
    appName: link.appName,
    headerImage: link.headerImage,
    steamAppId: link.steamAppId,
    live,
    expiresAt: live ? link.expiresAt : null,
  };
}
