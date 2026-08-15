/**
 * "Never expires" is stored as a far-future timestamp so every
 * `expires_at > now()` check keeps working unchanged.
 */
export const NO_EXPIRY = new Date("9999-12-31T00:00:00.000Z");
const NO_EXPIRY_THRESHOLD_MS = Date.UTC(9000, 0, 1);

export function isNoExpiry(d: Date | string | number | null | undefined): boolean {
  if (!d) return false;
  const t = typeof d === "number" ? d : new Date(d).getTime();
  return t >= NO_EXPIRY_THRESHOLD_MS;
}
