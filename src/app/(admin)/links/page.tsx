import Link from "next/link";
import { listLinks, type LinkView } from "@/lib/queries";
import { releaseExpiredLinks } from "@/lib/links-maintenance";
import { LinksTable } from "@/components/links-table";

export const metadata = { title: "Links" };
export const dynamic = "force-dynamic";

const TABS: { view: LinkView; label: string; blurb: string }[] = [
  { view: "active", label: "Active", blurb: "Outstanding links — not yet opened, revoked or expired." },
  { view: "expired", label: "Expired, never opened", blurb: "Links that ran out before anyone opened them. Their keys are back in the pool; re-send if the person still needs one." },
  { view: "all", label: "All", blurb: "Everything (latest 500)." },
];

export default async function LinksPage({ searchParams }: PageProps<"/links">) {
  const sp = await searchParams;
  const view: LinkView = sp.view === "expired" ? "expired" : sp.view === "all" || sp.all === "1" ? "all" : "active";
  await releaseExpiredLinks(); // opportunistic sweep so expired reservations go back to the pool
  const links = await listLinks({ view, limit: 500 });
  const now = new Date().getTime();
  const tab = TABS.find((t) => t.view === view)!;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Claim links</h1>
          <p className="text-sm text-muted">{tab.blurb} Link URLs are not stored; if one is lost, revoke it and make a new one.</p>
        </div>
        <div className="flex gap-1">
          {TABS.map((t) => (
            <Link key={t.view} href={t.view === "active" ? "/links" : `/links?view=${t.view}`} className={`btn btn-sm ${view === t.view ? "border-accent text-accent" : ""}`}>
              {t.label}
            </Link>
          ))}
        </div>
      </div>
      <LinksTable
        now={now}
        rows={links.map((l) => ({
          ...l,
          appId: l.appId,
          expiresAt: l.expiresAt.toISOString(),
          revealedAt: l.revealedAt?.toISOString() ?? null,
          revokedAt: l.revokedAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
          createdByName: l.createdByName,
        }))}
      />
    </div>
  );
}
