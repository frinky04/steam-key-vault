import { sql } from "drizzle-orm";
import { db } from "@/db";
import { rateLimits } from "@/db/schema";

export type RateResult = { ok: true } | { ok: false; retryAfterMs: number };

/**
 * Shared, DB-backed fixed-window limiter. Counts are stored in Postgres so every
 * replica sees the same budget. Use for anything security-relevant (auth).
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateResult> {
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, resetAt: sql`now() + make_interval(secs => ${windowMs / 1000})` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.resetAt} < now() then 1 else ${rateLimits.count} + 1 end`,
        resetAt: sql`case when ${rateLimits.resetAt} < now() then excluded.reset_at else ${rateLimits.resetAt} end`,
      },
    })
    .returning({ count: rateLimits.count, resetAt: rateLimits.resetAt });
  if (row.count > limit) return { ok: false, retryAfterMs: Math.max(1000, row.resetAt.getTime() - Date.now()) };
  return { ok: true };
}

/** Check several buckets at once; the first exhausted one wins. */
export async function rateLimitAll(buckets: { key: string; limit: number; windowMs: number }[]): Promise<RateResult> {
  for (const b of buckets) {
    const r = await rateLimit(b.key, b.limit, b.windowMs);
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function rateLimitReset(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.delete(rateLimits).where(sql`${rateLimits.key} in (${sql.join(keys.map((k) => sql`${k}`), sql`, `)})`);
}

/** Opportunistic cleanup of expired buckets; call from a low-traffic path. */
export async function rateLimitSweep(): Promise<void> {
  await db.delete(rateLimits).where(sql`${rateLimits.resetAt} < now() - interval '1 day'`);
}

/**
 * Per-process limiter for cheap, non-security paths (e.g. claim page abuse).
 * Not shared across replicas — do not use for auth.
 */
type Bucket = { count: number; resetAt: number };
const local = new Map<string, Bucket>();
export function localRateLimit(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  if (local.size > 5000) for (const [k, b] of local) if (b.resetAt < now) local.delete(k);
  const b = local.get(key);
  if (!b || b.resetAt < now) {
    local.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  b.count += 1;
  return b.count > limit ? { ok: false, retryAfterMs: b.resetAt - now } : { ok: true };
}

export function retryText(r: { retryAfterMs: number }) {
  const m = Math.ceil(r.retryAfterMs / 60000);
  return `Too many attempts. Try again in ${m} min.`;
}
