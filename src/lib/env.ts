function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

function masterKey(): Buffer {
  const hex = required("MASTER_KEY");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("MASTER_KEY must be 64 hex characters (32 bytes). Run: pnpm gen-secrets");
  }
  return Buffer.from(hex, "hex");
}

// Getters are lazy so `next build` does not need real secrets present.
export const env = {
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get ADMIN_PASSWORD() {
    return required("ADMIN_PASSWORD");
  },
  get SESSION_SECRET() {
    return required("SESSION_SECRET");
  },
  get MASTER_KEY() {
    return masterKey();
  },
  /** Public base URL used to build claim links. Falls back to Railway's domain. */
  get APP_URL(): string | undefined {
    if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
    if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
    return undefined;
  },
};

/** Name shown to recipients ("<SENDER_NAME> sent you a Steam key"). */
export const SENDER_NAME = process.env.SENDER_NAME || "Someone";

/** Short site label for link previews, e.g. "keys.example.com". */
export function siteName(): string {
  if (process.env.SITE_NAME) return process.env.SITE_NAME;
  const url = env.APP_URL;
  if (url) {
    try {
      return new URL(url).host;
    } catch {}
  }
  return "Steam Keys";
}
