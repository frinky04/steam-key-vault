"use server";

import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { claimLinks, keys, type KeyStatus, KEY_STATUSES } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { decryptKey, hashKey, normalizeKey } from "@/lib/crypto";
import { parseKeysFromText } from "@/lib/parse-keys";
import { audit, auditMany } from "@/lib/audit";
import type { ActionResult } from "./apps";

function revalidateKeyViews(appIds: Iterable<number>) {
  revalidatePath("/");
  revalidatePath("/links");
  for (const id of new Set(appIds)) revalidatePath(`/apps/${id}`);
}

/** Bulk status change. Moving to `available` also revokes any outstanding claim links. */
export async function bulkSetStatus(input: {
  keyIds: number[];
  status: KeyStatus;
  assignee?: string | null;
}): Promise<ActionResult<{ updated: number }>> {
  const admin = await requireAdmin();
  if (!KEY_STATUSES.includes(input.status)) return { ok: false, error: "Invalid status." };
  const ids = [...new Set(input.keyIds)].filter((n) => Number.isInteger(n));
  if (ids.length === 0) return { ok: false, error: "No keys selected." };

  const updated = await db.transaction(async (tx) => {
    const set: Partial<typeof keys.$inferInsert> = { status: input.status, updatedAt: new Date() };
    if (input.assignee !== undefined) set.assignee = input.assignee?.trim() || null;
    if (input.status === "available") set.assignee = null;

    const rows = await tx
      .update(keys)
      .set(set)
      .where(inArray(keys.id, ids))
      .returning({ id: keys.id, appId: keys.appId });

    if (input.status === "available") {
      await tx
        .update(claimLinks)
        .set({ revokedAt: new Date() })
        .where(and(inArray(claimLinks.keyId, ids), isNull(claimLinks.revealedAt), isNull(claimLinks.revokedAt)));
    }

    await auditMany(
      `keys.status.${input.status}`,
      rows.map((r) => ({ appId: r.appId, keyId: r.id, details: { assignee: set.assignee ?? undefined } })),
      { tx, userId: admin.id },
    );
    revalidateKeyViews(rows.map((r) => r.appId));
    return rows.length;
  });

  return { ok: true, data: { updated } };
}

/**
 * Paste a list of keys you already redeemed / handed out elsewhere and mark
 * them used. Returns keys that were not found in the DB so nothing is silent.
 */
export async function markUsedFromText(input: {
  text: string;
  status?: Extract<KeyStatus, "used" | "invalid">;
  assignee?: string;
}): Promise<ActionResult<{ updated: number; notFound: string[] }>> {
  const admin = await requireAdmin();
  const parsed = parseKeysFromText(input.text);
  if (parsed.keys.length === 0) return { ok: false, error: "No Steam keys found in the input." };
  const status = input.status ?? "used";
  const byHash = new Map(parsed.keys.map((p) => [hashKey(normalizeKey(p.key)), p.key]));

  const rows = await db
    .update(keys)
    .set({ status, assignee: input.assignee?.trim() || undefined, updatedAt: new Date() })
    .where(inArray(keys.keyHash, [...byHash.keys()]))
    .returning({ id: keys.id, appId: keys.appId, keyHash: keys.keyHash });

  for (const r of rows) byHash.delete(r.keyHash);
  await auditMany(
    `keys.status.${status}`,
    rows.map((r) => ({ appId: r.appId, keyId: r.id, details: { via: "paste" } })),
    { userId: admin.id },
  );
  revalidateKeyViews(rows.map((r) => r.appId));
  return { ok: true, data: { updated: rows.length, notFound: [...byHash.values()] } };
}

export async function updateKeyMeta(input: {
  keyId: number;
  assignee?: string | null;
  note?: string | null;
}): Promise<ActionResult> {
  await requireAdmin();
  const [row] = await db
    .update(keys)
    .set({
      assignee: input.assignee === undefined ? undefined : input.assignee?.trim() || null,
      note: input.note === undefined ? undefined : input.note?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(keys.id, input.keyId))
    .returning({ appId: keys.appId });
  if (row) revalidateKeyViews([row.appId]);
  return { ok: true };
}

/** Admin-side reveal (decrypt). Logged. */
export async function revealKeys(keyIds: number[]): Promise<ActionResult<{ id: number; key: string }[]>> {
  const admin = await requireAdmin();
  const ids = [...new Set(keyIds)];
  if (ids.length === 0) return { ok: true, data: [] };
  const rows = await db
    .select({ id: keys.id, appId: keys.appId, ct: keys.keyCiphertext })
    .from(keys)
    .where(inArray(keys.id, ids));
  await auditMany(
    "keys.reveal.admin",
    rows.map((r) => ({ appId: r.appId, keyId: r.id })),
    { userId: admin.id },
  );
  return { ok: true, data: rows.map((r) => ({ id: r.id, key: decryptKey(r.ct) })) };
}

export async function deleteKeys(keyIds: number[]): Promise<ActionResult<{ deleted: number }>> {
  const admin = await requireAdmin();
  const ids = [...new Set(keyIds)];
  if (ids.length === 0) return { ok: false, error: "No keys selected." };
  const rows = await db.delete(keys).where(inArray(keys.id, ids)).returning({ id: keys.id, appId: keys.appId });
  await audit("keys.delete", { userId: admin.id, details: { count: rows.length, ids: rows.map((r) => r.id) } });
  revalidateKeyViews(rows.map((r) => r.appId));
  return { ok: true, data: { deleted: rows.length } };
}

/** Export decrypted keys for an app (optionally filtered by status) as text. Logged. */
export async function exportKeys(input: {
  appId: number;
  statuses?: KeyStatus[];
}): Promise<ActionResult<{ text: string; count: number }>> {
  const admin = await requireAdmin();
  const where = input.statuses?.length
    ? and(eq(keys.appId, input.appId), inArray(keys.status, input.statuses))
    : eq(keys.appId, input.appId);
  const rows = await db
    .select({ id: keys.id, ct: keys.keyCiphertext, status: keys.status, assignee: keys.assignee })
    .from(keys)
    .where(where)
    .orderBy(keys.id);
  await audit("keys.export", { userId: admin.id, appId: input.appId, details: { count: rows.length, statuses: input.statuses } });
  const text = rows
    .map((r) => [decryptKey(r.ct), r.status, r.assignee ?? ""].join("\t"))
    .join("\n");
  return { ok: true, data: { text, count: rows.length } };
}
