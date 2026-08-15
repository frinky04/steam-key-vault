import Link from "next/link";
import { notFound } from "next/navigation";
import { appStatusCounts, getApp, listBatches, listKeys } from "@/lib/queries";
import { KEY_STATUSES, type KeyStatus } from "@/db/schema";
import { StatusPills } from "@/components/ui";
import { KeysTable } from "@/components/keys-table";
import { AppHeaderActions } from "@/components/app-header-actions";
import { KeyFilters } from "@/components/key-filters";

export const dynamic = "force-dynamic";

export default async function AppPage({ params, searchParams }: PageProps<"/apps/[id]">) {
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isInteger(id)) notFound();
  const app = await getApp(id);
  if (!app) notFound();

  const sp = await searchParams;
  const status = typeof sp.status === "string" && (KEY_STATUSES as readonly string[]).includes(sp.status) ? (sp.status as KeyStatus) : "all";
  const batchId = typeof sp.batch === "string" && Number(sp.batch) ? Number(sp.batch) : undefined;
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = typeof sp.page === "string" && Number(sp.page) ? Number(sp.page) : 1;

  const now = new Date().getTime();
  const [counts, batches, keyPage] = await Promise.all([
    appStatusCounts(id),
    listBatches(id),
    listKeys(id, { status, batchId, q, page, pageSize: 100 }),
  ]);

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-4 sm:flex-row">
        <div className="w-full shrink-0 overflow-hidden rounded-md bg-surface-2 sm:w-56">
          {app.headerImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={app.headerImage} alt="" className="aspect-[460/215] w-full object-cover" />
          ) : (
            <div className="flex aspect-[460/215] items-center justify-center text-4xl font-bold text-border">
              {app.name.slice(0, 1).toUpperCase()}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold">{app.name}</h1>
              <p className="text-xs text-muted">
                {app.steamAppId ? (
                  <a className="hover:text-accent" href={`https://store.steampowered.com/app/${app.steamAppId}/`} target="_blank" rel="noreferrer">
                    Steam App {app.steamAppId} ↗
                  </a>
                ) : (
                  "No Steam App ID"
                )}
                {" · "}
                <Link href={`/import?app=${app.id}`} className="hover:text-accent">
                  Import keys →
                </Link>
              </p>
            </div>
            <AppHeaderActions app={app} counts={counts} />
          </div>
          <StatusPills counts={counts} />
          {app.notes && <p className="whitespace-pre-wrap text-sm text-muted">{app.notes}</p>}
        </div>
      </div>

      <KeyFilters
        appId={id}
        counts={counts}
        batches={batches.map((b) => ({ id: b.id, name: b.name, count: b.count }))}
        current={{ status, batchId, q }}
      />

      <KeysTable
        now={now}
        rows={keyPage.rows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          activeLinkExpiresAt: r.activeLinkExpiresAt ? new Date(r.activeLinkExpiresAt).toISOString() : null,
        }))}
        total={keyPage.total}
        page={keyPage.page}
        pageSize={keyPage.pageSize}
      />
    </div>
  );
}
