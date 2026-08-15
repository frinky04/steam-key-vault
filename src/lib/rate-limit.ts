/**
 * Tiny in-memory fixed-window rate limiter. Good enough for a single-instance
 * Railway service; swap for Redis if you ever scale horizontally.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  opts: { reset?: boolean } = {},
): { ok: true } | { ok: false; retryAfterMs: number } {
  const now = Date.now();
  if (opts.reset) {
    buckets.delete(key);
    return { ok: true };
  }
  // opportunistic cleanup
  if (buckets.size > 5000) {
    for (const [k, b] of buckets) if (b.resetAt < now) buckets.delete(k);
  }
  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  b.count += 1;
  if (b.count > limit) return { ok: false, retryAfterMs: b.resetAt - now };
  return { ok: true };
}
