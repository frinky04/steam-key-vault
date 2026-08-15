import { requireUser } from "@/lib/auth";
import { listLinks } from "@/lib/queries";
import { releaseExpiredLinks } from "@/lib/links-maintenance";
import Link from "next/link";
import { MyLinksTable } from "@/components/my-links-table";
import type { LinkView } from "@/lib/queries";

export const metadata = { title: "My links" };
export const dynamic = "force-dynamic";

export default async function MyLinksPage({ searchParams }: PageProps<"/my-links">) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: LinkView = sp.view === "expired" ? "expired" : sp.view === "active" ? "active" : "all";
  await releaseExpiredLinks();
  const links = await listLinks({ createdByUserId: user.id, limit: 300, view });
  const now = new Date().getTime();
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
        <h1 className="text-xl font-semibold">My links</h1>
        <p className="text-sm text-muted">
          Links you created. URLs are not stored — if you lose one, revoke it and send a new one. If someone says their key
          did not work, use <b>Report bad key</b> so it is retired and the admin sees it.
        </p>
        </div>
        <div className="flex gap-1">
          {([["all", "All"], ["active", "Waiting"], ["expired", "Expired, never opened"]] as const).map(([v, label]) => (
            <Link key={v} href={v === "all" ? "/my-links" : `/my-links?view=${v}`} className={`btn btn-sm ${view === v ? "border-accent text-accent" : ""}`}>
              {label}
            </Link>
          ))}
        </div>
      </div>
      <MyLinksTable
        now={now}
        rows={links.map((l) => ({
          id: l.id,
          appName: l.appName,
          keyHint: l.keyHint,
          label: l.label,
          keyStatus: l.keyStatus,
          expiresAt: l.expiresAt.toISOString(),
          revealedAt: l.revealedAt?.toISOString() ?? null,
          revokedAt: l.revokedAt?.toISOString() ?? null,
          createdAt: l.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
