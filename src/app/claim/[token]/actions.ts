"use server";

import { headers } from "next/headers";
import { consumeClaim, type ClaimView } from "@/lib/claim";
import { localRateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/auth";

export async function revealAction(token: string): Promise<ClaimView | { state: "rate_limited" }> {
  const h = await headers();
  const ip = await clientIp();
  // Tokens are 192-bit random so guessing is hopeless, but keep abuse cheap to stop.
  const rl = localRateLimit(`claim:${ip}`, 30, 10 * 60 * 1000);
  if (!rl.ok) return { state: "rate_limited" };
  const view = await consumeClaim(token, { ip, userAgent: h.get("user-agent") ?? "" });
  return JSON.parse(JSON.stringify(view));
}
