"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { KeyStatus } from "@/db/schema";
import { reportBadKey, revokeLinks } from "@/lib/actions/links";
import { EmptyState, timeUntil } from "./ui";
import { LocalTime } from "./local-time";

type Row = {
  id: number;
  appName: string;
  keyHint: string;
  label: string | null;
  keyStatus: KeyStatus;
  expiresAt: string;
  revealedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

function state(r: Row, now: number) {
  if (r.keyStatus === "invalid") return { label: "Reported bad", cls: "text-danger" };
  if (r.revealedAt) return { label: "Claimed", cls: "text-accent" };
  if (r.revokedAt) return { label: "Revoked", cls: "text-muted" };
  if (new Date(r.expiresAt).getTime() < now) return { label: "Expired", cls: "text-muted" };
  const t = timeUntil(r.expiresAt, now);
  return { label: t === "no expiry" ? "Waiting · no expiry" : `Waiting · ${t} left`, cls: "text-ok" };
}

export function MyLinksTable({ rows, now }: { rows: Row[]; now: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  if (rows.length === 0) return <EmptyState title="No links yet">Create some from the Send page.</EmptyState>;

  function revoke(id: number) {
    if (!confirm("Revoke this link? The key goes back to the pool and the URL stops working.")) return;
    start(async () => {
      const r = await revokeLinks([id]);
      setMsg(r.ok ? "Revoked." : r.error);
      router.refresh();
    });
  }
  function report(id: number) {
    const note = prompt("What did the recipient report? (optional)");
    if (note === null) return;
    start(async () => {
      const r = await reportBadKey(id, note);
      setMsg(r.ok ? "Reported — the key is retired and the admin will see it." : r.error);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      {msg && <p className="text-sm text-accent">{msg}</p>}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-2 py-2">Game</th>
              <th className="px-2 py-2">For</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Created</th>
              <th className="px-2 py-2">Opened</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = state(r, now);
              const waiting = st.label.startsWith("Waiting");
              return (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-2 py-1.5">
                    {r.appName} <span className="font-mono text-xs text-muted">…{r.keyHint}</span>
                  </td>
                  <td className="px-2 py-1.5">{r.label ?? <span className="text-border">—</span>}</td>
                  <td className={`px-2 py-1.5 text-xs font-medium ${st.cls}`}>{st.label}</td>
                  <td className="px-2 py-1.5 text-xs text-muted"><LocalTime value={r.createdAt} /></td>
                  <td className="px-2 py-1.5 text-xs text-muted"><LocalTime value={r.revealedAt} /></td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap">
                    {waiting && (
                      <button className="btn btn-sm btn-danger" disabled={pending} onClick={() => revoke(r.id)}>
                        Revoke
                      </button>
                    )}
                    {r.revealedAt && r.keyStatus !== "invalid" && (
                      <button className="btn btn-sm" disabled={pending} onClick={() => report(r.id)} title="Recipient says the key did not work">
                        Report bad key
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
