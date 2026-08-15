"use server";

import { revalidatePath } from "next/cache";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { batches, keys } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import { encryptKey, hashKey, keyHint, normalizeKey } from "@/lib/crypto";
import { parseKeysFromText } from "@/lib/parse-keys";
import { audit } from "@/lib/audit";
import type { ActionResult } from "./apps";

export type ImportSummary = {
  batchId: number;
  inserted: number;
  duplicatesInDb: number;
  duplicatesInInput: number;
  ignoredLines: number;
};

/**
 * Server-side dedup check used by the import preview: which of these keys
 * already exist in the DB (any app)?
 */
export async function checkExisting(keyList: string[]): Promise<string[]> {
  await requireAdmin();
  if (keyList.length === 0) return [];
  const hashes = keyList.map((k) => hashKey(normalizeKey(k)));
  const rows = await db
    .select({ keyHash: keys.keyHash })
    .from(keys)
    .where(inArray(keys.keyHash, hashes));
  const existing = new Set(rows.map((r) => r.keyHash));
  return keyList.filter((k) => existing.has(hashKey(normalizeKey(k))));
}

export async function importKeys(input: {
  appId: number;
  batchName: string;
  source?: string;
  notes?: string;
  text: string; // raw text; parsed server-side so the client can't smuggle malformed keys
  useContextAsNote?: boolean;
}): Promise<ActionResult<ImportSummary>> {
  const admin = await requireAdmin();
  const batchName = input.batchName.trim() || `Import ${new Date().toISOString().slice(0, 10)}`;
  const parsed = parseKeysFromText(input.text);
  if (parsed.keys.length === 0) return { ok: false, error: "No Steam keys found in the input." };

  const summary = await db.transaction(async (tx) => {
    const [batch] = await tx
      .insert(batches)
      .values({ appId: input.appId, name: batchName, source: input.source?.trim() || null, notes: input.notes?.trim() || null })
      .returning({ id: batches.id });

    const rows = parsed.keys.map((p) => {
      const norm = normalizeKey(p.key);
      return {
        appId: input.appId,
        batchId: batch.id,
        keyHash: hashKey(norm),
        keyCiphertext: encryptKey(norm),
        keyHint: keyHint(norm),
        note: input.useContextAsNote && p.context ? p.context.slice(0, 200) : null,
      };
    });

    // Insert in chunks; ON CONFLICT DO NOTHING enforces global dedup via the unique index.
    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const res = await tx
        .insert(keys)
        .values(rows.slice(i, i + CHUNK))
        .onConflictDoNothing({ target: keys.keyHash })
        .returning({ id: keys.id });
      inserted += res.length;
    }

    await audit("keys.import", { userId: admin.id,
      appId: input.appId,
      details: { batchId: batch.id, batchName, inserted, duplicatesInDb: rows.length - inserted },
      tx,
    });

    return {
      batchId: batch.id,
      inserted,
      duplicatesInDb: rows.length - inserted,
      duplicatesInInput: parsed.duplicateLines,
      ignoredLines: parsed.ignoredLines,
    };
  });

  revalidatePath("/");
  revalidatePath(`/apps/${input.appId}`);
  return { ok: true, data: summary };
}
