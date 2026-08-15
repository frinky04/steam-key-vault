import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { claimLinks, keys } from "@/db/schema";
import { audit } from "@/lib/audit";

/** Sweep expired, unrevealed links back to the pool. Called opportunistically from the links page. */
export async function releaseExpiredLinks(): Promise<number> {
  const rows = await db
    .select({ keyId: claimLinks.keyId })
    .from(claimLinks)
    .innerJoin(keys, eq(keys.id, claimLinks.keyId))
    .where(
      and(
        isNull(claimLinks.revealedAt),
        isNull(claimLinks.revokedAt),
        sql`${claimLinks.expiresAt} <= now()`,
        eq(keys.status, "reserved"),
      ),
    );
  if (rows.length === 0) return 0;
  const keyIds = [...new Set(rows.map((r) => r.keyId))];
  const updated = await db
    .update(keys)
    .set({ status: "available", assignee: null, updatedAt: new Date() })
    .where(
      and(
        inArray(keys.id, keyIds),
        eq(keys.status, "reserved"),
        sql`not exists (select 1 from ${claimLinks} cl where cl.key_id = ${keys.id} and cl.revealed_at is null and cl.revoked_at is null and cl.expires_at > now())`,
      ),
    )
    .returning({ id: keys.id });
  if (updated.length) await audit("link.expired.release", { details: { keyIds: updated.map((u) => u.id) } });
  return updated.length;
}
