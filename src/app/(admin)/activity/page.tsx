import Link from "next/link";
import { recentActivity } from "@/lib/queries";
import { EmptyState } from "@/components/ui";
import { LocalTime } from "@/components/local-time";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = {
  "app.create": "App created",
  "app.update": "App updated",
  "app.delete": "App deleted",
  "keys.import": "Keys imported",
  "keys.status.available": "Released to pool",
  "keys.status.reserved": "Reserved",
  "keys.status.claimed": "Claimed",
  "keys.status.used": "Marked used",
  "keys.status.invalid": "Marked invalid",
  "keys.reveal.admin": "Revealed (admin)",
  "keys.delete": "Keys deleted",
  "keys.export": "Exported",
  "link.create": "Link created",
  "link.revoke": "Link revoked",
  "link.claimed": "Link opened → key claimed",
  "link.expired.release": "Expired links released",
  "key.reported_bad": "Key reported bad",
  "auth.login": "Signed in",
  "auth.login.failed": "Failed sign-in",
  "auth.recovery": "Recovery sign-in",
  "auth.recovery.failed": "Failed recovery sign-in",
  "user.setup": "Admin account created",
  "user.invite": "User invited",
  "user.invite.accepted": "Invite accepted",
  "user.reset": "Password reset issued",
  "user.update": "User updated",
  "user.disable": "User disabled",
  "user.enable": "User enabled",
  "user.delete": "User deleted",
};

export default async function ActivityPage() {
  const rows = await recentActivity(300);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Activity</h1>
        <p className="text-sm text-muted">Latest 300 events. Every reveal, import, status change and claim is recorded.</p>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Nothing yet" />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-2 py-2">When</th>
                <th className="px-2 py-2">Event</th>
                <th className="px-2 py-2">Who</th>
                <th className="px-2 py-2">App</th>
                <th className="px-2 py-2">Key</th>
                <th className="px-2 py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 text-xs text-muted"><LocalTime value={r.createdAt} /></td>
                  <td className="px-2 py-1.5">{ACTION_LABEL[r.action] ?? r.action}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.userName ?? "—"}</td>
                  <td className="px-2 py-1.5">
                    {r.appId ? (
                      <Link href={`/apps/${r.appId}`} className="hover:text-accent">
                        {r.appName ?? `#${r.appId}`}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-muted">{r.keyHint ? `…${r.keyHint}` : "—"}</td>
                  <td className="max-w-md truncate px-2 py-1.5 font-mono text-xs text-muted" title={JSON.stringify(r.details)}>
                    {r.details ? summarize(r.details) : ""}
                    {r.ip && r.action === "link.claimed" ? ` · ${r.ip}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function summarize(d: Record<string, unknown>) {
  return Object.entries(d)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.length}]` : String(v)}`)
    .join(" ");
}
