import Link from "next/link";
import { listAppsWithCounts } from "@/lib/queries";
import { ImportWizard } from "@/components/import-wizard";

export const metadata = { title: "Import" };
export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: PageProps<"/import">) {
  const sp = await searchParams;
  const preselect = typeof sp.app === "string" ? Number(sp.app) : undefined;
  const apps = await listAppsWithCounts();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Import keys</h1>
        <p className="text-sm text-muted">
          Paste text or drop .txt/.csv files. Any <span className="font-mono">XXXXX-XXXXX-XXXXX</span> pattern on a line is picked
          up; everything else on the line is kept as context. Duplicates (in the paste or already in the vault) are skipped.
        </p>
      </div>
      {apps.length === 0 ? (
        <div className="card text-sm">
          You need an app first.{" "}
          <Link href="/apps/new" className="text-accent hover:underline">
            Create one →
          </Link>
        </div>
      ) : (
        <ImportWizard apps={apps.map((a) => ({ id: a.id, name: a.name, steamAppId: a.steamAppId }))} preselect={preselect} />
      )}
    </div>
  );
}
