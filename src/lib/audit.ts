import "server-only";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  action: string,
  opts: {
    appId?: number | null;
    keyId?: number | null;
    userId?: number | null;
    details?: Record<string, unknown>;
    ip?: string | null;
    tx?: Tx;
  } = {},
) {
  const executor = opts.tx ?? db;
  await executor.insert(auditLog).values({
    action,
    appId: opts.appId ?? null,
    keyId: opts.keyId ?? null,
    userId: opts.userId ?? null,
    details: opts.details ?? null,
    ip: opts.ip ?? null,
  });
}

export async function auditMany(
  action: string,
  rows: { appId?: number | null; keyId?: number | null; details?: Record<string, unknown> }[],
  opts: { ip?: string | null; tx?: Tx; userId?: number | null } = {},
) {
  if (rows.length === 0) return;
  const executor = opts.tx ?? db;
  await executor.insert(auditLog).values(
    rows.map((r) => ({
      action,
      appId: r.appId ?? null,
      keyId: r.keyId ?? null,
      userId: opts.userId ?? null,
      details: r.details ?? null,
      ip: opts.ip ?? null,
    })),
  );
}
