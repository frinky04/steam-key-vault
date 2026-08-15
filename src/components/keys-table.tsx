"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { KeyStatus } from "@/db/schema";
import { bulkSetStatus, deleteKeys, revealKeys, updateKeyMeta } from "@/lib/actions/keys";
import { createClaimLinks, type CreatedLink } from "@/lib/actions/links";
import { StatusBadge, timeUntil, EmptyState } from "./ui";
import { LocalTime } from "./local-time";
import { CopyButton } from "./copy-button";
import { Modal } from "./modal";
import { LinksResult } from "./links-result";
import { ExpiryField } from "./expiry-field";

export type SerializedKeyRow = {
  id: number;
  keyHint: string;
  status: KeyStatus;
  assignee: string | null;
  note: string | null;
  batchId: number | null;
  batchName: string | null;
  createdAt: string;
  updatedAt: string;
  activeLinkId: number | null;
  activeLinkExpiresAt: string | null;
};

type Props = { rows: SerializedKeyRow[]; total: number; page: number; pageSize: number; now: number };

export function KeysTable({ rows, total, page, pageSize, now }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState<Map<number, string>>(new Map());
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [linkModal, setLinkModal] = useState(false);
  const [links, setLinks] = useState<CreatedLink[] | null>(null);
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("48");
  const [noExpiry, setNoExpiry] = useState(false);
  const [revealModal, setRevealModal] = useState<{ id: number; key: string }[] | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  // Clear selection when the page of rows changes (state reset during render, per React docs).
  const rowKey = rows.map((r) => r.id).join(",");
  const [prevRowKey, setPrevRowKey] = useState(rowKey);
  if (prevRowKey !== rowKey) {
    setPrevRowKey(rowKey);
    setSelected(new Set());
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const ids = useMemo(() => [...selected], [selected]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  function flash(m: string) {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  }

  function setStatus(status: KeyStatus) {
    let assignee: string | null | undefined;
    if (status === "reserved" || status === "used") {
      const a = prompt(`Mark ${ids.length} key(s) as ${status}. Who for? (optional)`);
      if (a === null) return;
      assignee = a.trim() || undefined;
    }
    if (status === "invalid" && !confirm(`Mark ${ids.length} key(s) as invalid?`)) return;
    start(async () => {
      const r = await bulkSetStatus({ keyIds: ids, status, assignee });
      if (!r.ok) return flash(r.error);
      flash(`Updated ${r.data?.updated} key(s).`);
      router.refresh();
    });
  }

  function reveal(idList: number[], modal = false) {
    start(async () => {
      const r = await revealKeys(idList);
      if (!r.ok) return flash(r.error);
      if (modal) setRevealModal(r.data ?? []);
      else
        setRevealed((m) => {
          const n = new Map(m);
          for (const k of r.data ?? []) n.set(k.id, k.key);
          return n;
        });
    });
  }

  function makeLinks(e: React.FormEvent) {
    e.preventDefault();
    setLinkError(null);
    start(async () => {
      const r = await createClaimLinks({ keyIds: ids, label, ttlHours: noExpiry ? 0 : Number(ttl) });
      if (!r.ok) return setLinkError(r.error);
      setLinks(r.data ?? []);
      router.refresh();
    });
  }

  function remove() {
    if (!confirm(`Permanently delete ${ids.length} key(s)? Consider marking them invalid instead.`)) return;
    start(async () => {
      const r = await deleteKeys(ids);
      if (!r.ok) return flash(r.error);
      flash(`Deleted ${r.data?.deleted}.`);
      router.refresh();
    });
  }

  function editMeta(row: SerializedKeyRow, field: "assignee" | "note") {
    const v = prompt(`${field === "assignee" ? "Assignee" : "Note"} for …${row.keyHint}`, row[field] ?? "");
    if (v === null) return;
    start(async () => {
      await updateKeyMeta({ keyId: row.id, [field]: v });
      router.refresh();
    });
  }

  function goPage(p: number) {
    const next = new URLSearchParams(sp.toString());
    if (p <= 1) next.delete("page");
    else next.set("page", String(p));
    router.push(`${pathname}${next.size ? `?${next}` : ""}`);
  }

  if (rows.length === 0) {
    return <EmptyState title="No keys match">Import a batch or loosen the filters.</EmptyState>;
  }

  return (
    <div className="space-y-2">
      {/* Bulk bar */}
      <div className="sticky top-12 z-10 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm">
        <span className="text-muted">
          {selected.size > 0 ? `${selected.size} selected` : `${total} keys`}
        </span>
        {selected.size > 0 && (
          <>
            <span className="text-border">|</span>
            <button className="btn btn-sm btn-primary" disabled={pending} onClick={() => { setLinks(null); setLinkError(null); setLinkModal(true); }}>
              Create links
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => setStatus("used")}>
              Mark used
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => setStatus("reserved")}>
              Reserve
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => setStatus("available")}>
              Release
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => setStatus("invalid")}>
              Invalid
            </button>
            <button className="btn btn-sm" disabled={pending} onClick={() => reveal(ids, true)}>
              Reveal
            </button>
            <button className="btn btn-sm btn-danger" disabled={pending} onClick={remove}>
              Delete
            </button>
          </>
        )}
        {msg && <span className="ml-auto text-accent">{msg}</span>}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="w-8 px-2 py-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
              </th>
              <th className="px-2 py-2">Key</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Assignee</th>
              <th className="px-2 py-2">Note</th>
              <th className="px-2 py-2">Batch</th>
              <th className="px-2 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const full = revealed.get(r.id);
              return (
                <tr key={r.id} className={`border-t border-border ${selected.has(r.id) ? "bg-accent/5" : "hover:bg-surface/60"}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs">
                    {full ? (
                      <span className="flex items-center gap-2">
                        <span className="select-all">{full}</span>
                        <CopyButton text={full} className="btn btn-sm" />
                        <button className="text-muted hover:text-foreground" onClick={() => setRevealed((m) => { const n = new Map(m); n.delete(r.id); return n; })}>
                          hide
                        </button>
                      </span>
                    ) : (
                      <button className="text-muted hover:text-accent" onClick={() => reveal([r.id])} title="Reveal (logged)">
                        •••••-•••••-{r.keyHint}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <StatusBadge status={r.status} />
                    {r.activeLinkExpiresAt && (
                      <span className="ml-1 text-xs text-muted" title={`Link expires ${new Date(r.activeLinkExpiresAt).toISOString()}`}>
                        link · {timeUntil(r.activeLinkExpiresAt, now)}
                      </span>
                    )}
                  </td>
                  <td className="cursor-text px-2 py-1.5" onClick={() => editMeta(r, "assignee")} title="Click to edit">
                    {r.assignee ?? <span className="text-border">—</span>}
                  </td>
                  <td className="max-w-56 cursor-text truncate px-2 py-1.5 text-muted" onClick={() => editMeta(r, "note")} title={r.note ?? "Click to edit"}>
                    {r.note ?? <span className="text-border">—</span>}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-muted">{r.batchName ?? "—"}</td>
                  <td className="px-2 py-1.5 text-xs text-muted"><LocalTime value={r.updatedAt} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-1">
            <button className="btn btn-sm" disabled={page <= 1} onClick={() => goPage(page - 1)}>
              ← Prev
            </button>
            <button className="btn btn-sm" disabled={page >= totalPages} onClick={() => goPage(page + 1)}>
              Next →
            </button>
          </div>
        </div>
      )}

      <Modal open={linkModal} onClose={() => setLinkModal(false)} title={links ? "Links created" : `Create ${ids.length} claim link(s)`} wide={!!links}>
        {links ? (
          <LinksResult links={links} onClose={() => setLinkModal(false)} />
        ) : (
          <form onSubmit={makeLinks} className="space-y-3">
            <p className="text-sm text-muted">
              One single-use link per selected key. Keys already claimed/used, or with a live link, are skipped.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Label (who)</label>
                <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
              </div>
              <ExpiryField ttl={ttl} setTtl={setTtl} noExpiry={noExpiry} setNoExpiry={setNoExpiry} />
            </div>
            {linkError && <p className="text-sm text-danger">{linkError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setLinkModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={pending}>
                {pending ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!revealModal} onClose={() => setRevealModal(null)} title="Revealed keys">
        {revealModal && (
          <div className="space-y-3">
            <textarea readOnly className="input min-h-40 font-mono text-xs" value={revealModal.map((k) => k.key).join("\n")} />
            <div className="flex justify-end gap-2">
              <CopyButton text={revealModal.map((k) => k.key).join("\n")} label={`Copy ${revealModal.length}`} className="btn" />
              <button className="btn btn-primary" onClick={() => setRevealModal(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
