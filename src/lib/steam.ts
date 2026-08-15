import "server-only";

export type SteamAppInfo = {
  appId: number;
  name: string;
  headerImage: string | null;
  type: string;
};

/** Public store endpoint, no API key needed. Returns null for unknown / unreleased apps. */
export async function fetchSteamApp(appId: number): Promise<SteamAppInfo | null> {
  if (!Number.isInteger(appId) || appId <= 0) return null;
  try {
    const res = await fetch(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&filters=basic`,
      { next: { revalidate: 60 * 60 * 24 }, headers: { "User-Agent": "steam-key-vault" } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<
      string,
      { success: boolean; data?: { name: string; header_image?: string; type?: string } }
    >;
    const entry = json[String(appId)];
    if (!entry?.success || !entry.data) return null;
    return {
      appId,
      name: entry.data.name,
      headerImage: entry.data.header_image ?? null,
      type: entry.data.type ?? "game",
    };
  } catch {
    return null;
  }
}

export function steamStoreUrl(appId: number) {
  return `https://store.steampowered.com/app/${appId}/`;
}

/** Deep link that opens the Steam key redemption page with the key prefilled. */
export function steamRedeemUrl(key: string) {
  return `https://store.steampowered.com/account/registerkey?key=${encodeURIComponent(key)}`;
}
