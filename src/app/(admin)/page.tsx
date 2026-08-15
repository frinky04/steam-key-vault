import Link from "next/link";
import { listAppsWithCounts, globalCounts } from "@/lib/queries";
import { EmptyState, StatusPills } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [apps, totals] = await Promise.all([listAppsWithCounts(), globalCounts()]);
  const totalKeys = totals.available + totals.reserved + totals.claimed + totals.used + totals.invalid;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Apps</h1>
          <p className="text-sm text-muted">
            {totalKeys} keys across {apps.length} app{apps.length === 1 ? "" : "s"} · {totals.available} available ·{" "}
            {totals.activeLinks} live link{totals.activeLinks === 1 ? "" : "s"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/import" className="btn">
            Import keys
          </Link>
          <Link href="/apps/new" className="btn btn-primary">
            + New app
          </Link>
        </div>
      </div>

      {apps.length === 0 ? (
        <EmptyState title="No apps yet">
          Create an app (by Steam App ID) and then import a batch of keys into it.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {apps.map((a) => (
            <Link key={a.id} href={`/apps/${a.id}`} className="card group overflow-hidden p-0 transition hover:border-accent/60">
              <div className="aspect-[460/215] w-full bg-surface-2">
                {a.headerImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.headerImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-4xl font-bold text-border">
                    {a.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
              <div className="space-y-2 p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 className="truncate font-medium group-hover:text-accent">{a.name}</h2>
                  <span className="shrink-0 text-xs text-muted">{a.steamAppId ? `#${a.steamAppId}` : "no app id"}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-ok">{a.counts.available} available</span>
                  <span className="text-muted">{a.total} total</span>
                </div>
                <StatusPills counts={a.counts} compact />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
