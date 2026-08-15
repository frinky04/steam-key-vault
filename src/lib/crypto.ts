import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

const ALGO = "aes-256-gcm";

/** Normalise a key for hashing/dedup: uppercase, strip whitespace. Hyphens are kept. */
export function normalizeKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashKey(normalized: string): string {
  return createHash("sha256").update(normalized).digest("hex");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function encryptKey(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, env.MASTER_KEY, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ct].map((b) => b.toString("base64")).join(":");
}

export function decryptKey(payload: string): string {
  const [ivB, tagB, ctB] = payload.split(":");
  if (!ivB || !tagB || !ctB) throw new Error("Malformed ciphertext");
  const decipher = createDecipheriv(ALGO, env.MASTER_KEY, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Last group of a key, e.g. "3F9K2" for "AAAAA-BBBBB-3F9K2". */
export function keyHint(normalized: string): string {
  const parts = normalized.split("-");
  return parts[parts.length - 1]?.slice(-5) ?? "";
}

export function newToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
