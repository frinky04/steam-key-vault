import "server-only";
import { after } from "next/server";
import { env } from "./env";

/**
 * Discord webhook feed for the dev channel. Fire-and-forget: never blocks or
 * fails the request that triggered it. Configure with DISCORD_WEBHOOK_URL;
 * pick events with DISCORD_EVENTS (comma list; default "claim,report,stock").
 */

export type DiscordEvent = "claim" | "report" | "send" | "stock";

const COLORS = { claim: 0x66c0f4, report: 0xf87171, send: 0x8b98a9, stock: 0xfbbf24 } as const;

function enabledEvents(): Set<DiscordEvent> {
  const raw = process.env.DISCORD_EVENTS ?? "claim,report,stock";
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) as DiscordEvent[]);
}

export function discordEnabled(event: DiscordEvent): boolean {
  return !!process.env.DISCORD_WEBHOOK_URL && enabledEvents().has(event);
}

type Embed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

async function post(embed: Embed): Promise<void> {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const base = env.APP_URL;
  const body = {
    username: process.env.DISCORD_USERNAME || "Steam Key Vault",
    avatar_url: process.env.DISCORD_AVATAR_URL || (base ? `${base}/logo.png` : undefined),
    embeds: [{ footer: { text: "Steam Key Vault" }, timestamp: new Date().toISOString(), ...embed }],
  };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error("discord webhook failed:", res.status, await res.text().catch(() => ""));
  } catch (e) {
    console.error("discord webhook error:", e instanceof Error ? e.message : e);
  }
}

/** Queue a notification to run after the current response finishes. */
export function notify(event: DiscordEvent, embed: Embed): void {
  if (!discordEnabled(event)) return;
  const payload = { color: COLORS[event], ...embed };
  try {
    after(() => post(payload));
  } catch {
    // Not inside a request scope (e.g. script) — send directly.
    void post(payload);
  }
}

const esc = (s: string) => s.replace(/[*_`~|>]/g, (c) => `\\${c}`);

export function lowStockThreshold(): number {
  const n = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);
  return Number.isFinite(n) && n >= 0 ? n : 5;
}

/** A recipient opened a claim link. The headline event for the dev feed. */
export function notifyClaimed(p: {
  appName: string;
  label: string | null;
  senderName: string | null;
  keyHint: string;
  remaining: number;
}) {
  const who = p.label ? `**${esc(p.label)}**` : "Someone";
  const low = p.remaining <= lowStockThreshold();
  notify("claim", {
    title: `🔑 Key claimed · ${esc(p.appName)}`,
    description: `${who} opened their key${p.senderName ? ` (sent by ${esc(p.senderName)})` : ""}.`,
    fields: [
      { name: "Key", value: `\`…${p.keyHint}\``, inline: true },
      { name: "Left in pool", value: low ? `⚠️ **${p.remaining}**` : String(p.remaining), inline: true },
    ],
  });
}

/** A dev/admin flagged a claimed key as not working. */
export function notifyBadKey(p: { appName: string; keyHint: string; reporterName: string; label: string | null; note?: string }) {
  notify("report", {
    title: `⚠️ Bad key reported · ${esc(p.appName)}`,
    description: `${esc(p.reporterName)} reported \`…${p.keyHint}\`${p.label ? ` (sent to ${esc(p.label)})` : ""} as not working. It has been retired.`,
    fields: p.note ? [{ name: "Note", value: esc(p.note).slice(0, 500) }] : undefined,
  });
}

/** Someone created claim links. */
export function notifySent(p: { appName: string; count: number; senderName: string; label: string | null; remaining: number }) {
  notify("send", {
    title: `📨 ${p.count} link${p.count === 1 ? "" : "s"} created · ${esc(p.appName)}`,
    description: `${esc(p.senderName)}${p.label ? ` → ${esc(p.label)}` : ""} · ${p.remaining} left in pool`,
  });
}

/** Pool crossed the low-stock line (or ran dry). */
export function notifyLowStock(p: { appName: string; remaining: number }) {
  notify("stock", {
    title: p.remaining === 0 ? `🚫 Out of keys · ${esc(p.appName)}` : `📉 Low stock · ${esc(p.appName)}`,
    description: p.remaining === 0 ? "No available keys left. Import more before sending." : `Only **${p.remaining}** available key${p.remaining === 1 ? "" : "s"} left.`,
  });
}
