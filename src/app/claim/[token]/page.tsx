import type { Metadata } from "next";
import { getClaimPreview, getClaimView } from "@/lib/claim";
import { siteName } from "@/lib/env";
import { ClaimCard } from "./claim-card";

export const dynamic = "force-dynamic";

// Rich, non-sensitive preview for Discord/Slack/iMessage. The key itself is
// never in the page until the visitor clicks Reveal, so this is safe to expose.
export async function generateMetadata({ params }: PageProps<"/claim/[token]">): Promise<Metadata> {
  const { token } = await params;
  const p = await getClaimPreview(token);
  const base: Metadata = {
    robots: { index: false, follow: false },
    other: { "theme-color": "#66c0f4" },
  };
  if (!p) {
    return { ...base, title: "Steam key link", description: "This link is not valid." };
  }
  const what = p.keyCount > 1 ? `${p.keyCount} Steam keys` : "Steam key";
  const name = p.appNames.join(" + ");
  const title = p.live ? `Your ${what} for ${name}` : `${what} for ${name}`;
  // No description on purpose: the generated image carries the message.
  return {
    ...base,
    title,
    openGraph: {
      title,
      siteName: siteName(),
      type: "website",
      // Next also auto-injects the generated /opengraph-image for this route.
    },
    twitter: { card: "summary_large_image", title },
  };
}

export default async function ClaimPage({ params }: PageProps<"/claim/[token]">) {
  const { token } = await params;
  const view = await getClaimView(token);
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <ClaimCard token={token} initial={JSON.parse(JSON.stringify(view))} />
    </main>
  );
}
