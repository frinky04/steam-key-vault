import { ImageResponse } from "next/og";
import { getClaimPreview } from "@/lib/claim";
import { SENDER_NAME, siteName } from "@/lib/env";

export const alt = "Steam key";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Prefer Steam's 1920×620 hero art over the 460×215 header when it exists. */
async function bestArtwork(steamAppId: number | null, fallback: string | null): Promise<string | null> {
  if (steamAppId) {
    const hero = `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steamAppId}/library_hero.jpg`;
    try {
      const r = await fetch(hero, { method: "HEAD", next: { revalidate: 86400 } });
      if (r.ok) return hero;
    } catch {}
  }
  return fallback;
}

function hoursLeft(d: Date | null) {
  if (!d || d.getUTCFullYear() >= 9000) return null;
  const h = Math.max(0, Math.round((d.getTime() - Date.now()) / 3600000));
  return h >= 48 ? `${Math.round(h / 24)} days` : `${h} hours`;
}

export default async function Image({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const p = await getClaimPreview(token);
  const art = p ? await bestArtwork(p.steamAppId, p.headerImage) : null;

  const title = p ? p.appNames.join(" + ") : "Steam key";
  const subtitle = !p
    ? "This link is not valid"
    : p.live
      ? `${SENDER_NAME} sent you ${p.keyCount > 1 ? `${p.keyCount} Steam keys` : "a Steam key"} · ${hoursLeft(p.expiresAt) ? `expires in ${hoursLeft(p.expiresAt)}` : "no expiry"}`
      : "This key link has already been used or expired";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "linear-gradient(135deg, #1b2838 0%, #0b0f14 100%)",
          color: "#e6edf3",
          fontFamily: "sans-serif",
          position: "relative",
        }}
      >
        {/* artwork */}
        {art ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={art}
            alt=""
            width={1200}
            height={630}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.55 }}
          />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(11,15,20,0.15) 0%, rgba(11,15,20,0.55) 45%, rgba(11,15,20,0.97) 100%)",
          }}
        />

        {/* key badge */}
        <div
          style={{
            position: "absolute",
            top: 40,
            left: 48,
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "10px 18px 10px 12px",
            borderRadius: 14,
            background: "rgba(11,15,20,0.75)",
            border: "2px solid rgba(102,192,244,0.45)",
            fontSize: 26,
            fontWeight: 700,
          }}
        >
          <svg width="40" height="40" viewBox="0 0 64 64">
            <rect width="64" height="64" rx="14" fill="#101823" />
            <g transform="rotate(-45 32 32)" fill="none" stroke="#66c0f4" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="20" cy="32" r="8.5" />
              <path d="M28.5 32H51" />
              <path d="M45 32v7" />
              <path d="M37.5 32v5.5" />
            </g>
          </svg>
          {siteName()}
        </div>

        {/* text */}
        <div style={{ position: "absolute", left: 48, right: 48, bottom: 48, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 30, color: "#8fd6ff", fontWeight: 600, letterSpacing: 1 }}>
            {p && p.keyCount > 1 ? `${p.keyCount} STEAM KEYS` : "STEAM KEY"}{p?.live ? " · SINGLE USE" : ""}
          </div>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1.05, textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}>{title}</div>
          <div style={{ fontSize: 32, color: "#c9d4e0" }}>{subtitle}</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
