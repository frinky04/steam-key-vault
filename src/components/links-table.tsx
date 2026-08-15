"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { KeyStatus } from "@/db/schema";
import { revokeLinks } from "@/lib/actions/links";
import { EmptyState, StatusBadge, timeUntil } from "./ui";
import { LocalTime } from "./local-time";

type Row = {
  id: number;
  keyIds: number[];
  keyHints: string[];
  keyStatuses: KeyStatus[];
  keyCount: number;
  appNames: string[];
  appId: number;
  appName: string;
  label: string | null;
  expiresAt: string;
  revealedAt: string | null;
  revokedAt: string | null;
  revealIp: string | null;
  createdAt: string;
  createdByName: string | null;
};

function linkState(r: Row, now: number) {
  if (r.revealedAt) return { label: "Claimed", cls: "text-accent" };
  if (r.revokedAt) return { label: "Revoked", cls: "text-muted" };
  if (new Date(r.expiresAt).getTime() < now) return { label: "Expired", cls: "text-muted" };
  return { label: `Live · ${timeUntil(r.expiresAt, now)}`, cls: "text-ok" };
}

export function LinksTable({ rows, now }: { rows: Row[]; now: number }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const active = rows.filter((r) => !r.revealedAt && !r.revokedAt && new Date(r.expiresAt).getTime() > now);
  const ids = [...selected];

  if (rows.length === 0) return <EmptyState title="No links">Generate links from an app page.</EmptyState>;

  function revoke(list: number[]) {
    if (!confirm(`Revoke ${list.length} link(s)? Their keys return to the pool.`)) return;
    start(async () => {
      const r = await revokeLinks(list);
      if (!r.ok) alert(r.error);
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {active.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <button
            className="btn btn-sm"
            onClick={() => setSelected(selected.size === active.length ? new Set() : new Set(active.map((r) => r.id)))}
          >
            {selected.size === active.length ? "Deselect all" : `Select all live (${active.length})`}
          </button>
          {ids.length > 0 && (
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => revoke(ids)}>
              Revoke {ids.length}
            </button>
          )}
        </div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 px-2 py-2" />
              <th className="px-2 py-2">App</th>
              <th className="px-2 py-2">Key</th>
              <th className="px-2 py-2">For</th>
              <th className="px-2 py-2">By</th>
              <th className="px-2 py-2">Link</th>
              <th className="px-2 py-2">Key status</th>
              <th className="px-2 py-2">Created</th>
              <th className="px-2 py-2">Opened</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = linkState(r, now);
              const isActive = st.label.startsWith("Live");
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    {isActive && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={() =>
                          setSelected((s) => {
                            const n = new Set(s);
                            if (n.has(r.id)) n.delete(r.id);
                            else n.add(r.id);
                            return n;
                          })
                        }
                      />
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <Link href={`/apps/${r.appId}`} className="hover:text-accent">
                      {r.appNames.length > 1 ? r.appNames.join(" + ") : r.appName}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-muted" title={r.keyHints.map((h) => `…${h}`).join(", ")}>
                    {r.keyCount > 1 ? `${r.keyCount} keys` : `…${r.keyHints[0]}`}
                  </td>
                  <td className="px-2 py-1.5">{r.label ?? <span className="text-border">—</span>}</td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.createdByName ?? "—"}</td>
                  <td className={`px-2 py-1.5 text-xs font-medium ${st.cls}`}>{st.label}</td>
                  <td className="px-2 py-1.5">
                    {[...new Set(r.keyStatuses)].map((s) => (
                      <StatusBadge key={s} status={s} />
                    ))}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted"><LocalTime value={r.createdAt} /></td>
                  <td className="px-2 py-1.5 text-xs text-muted" title={r.revealIp ?? undefined}>
                    <LocalTime value={r.revealedAt} />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    {isActive && (
                      <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => revoke([r.id])}>
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
