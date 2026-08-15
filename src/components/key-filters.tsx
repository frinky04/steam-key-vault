"use client";

import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import type { KeyStatus } from "@/db/schema";
import { STATUS_META } from "./ui";

type Props = {
  appId: number;
  counts: Record<KeyStatus, number>;
  batches: { id: number; name: string; count: number }[];
  current: { status: KeyStatus | "all"; batchId?: number; q: string };
};

export function KeyFilters({ counts, batches, current }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(current.q);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  function push(next: Partial<{ status: string; batch: string; q: string }>) {
    const sp = new URLSearchParams();
    const status = next.status ?? current.status;
    const batch = next.batch ?? (current.batchId ? String(current.batchId) : "");
    const query = next.q ?? q;
    if (status && status !== "all") sp.set("status", status);
    if (batch) sp.set("batch", batch);
    if (query) sp.set("q", query);
    router.push(`${pathname}${sp.size ? `?${sp}` : ""}`);
  }

  return (
    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="flex gap-1 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0">
        <button className={`btn btn-sm ${current.status === "all" ? "border-accent text-accent" : ""}`} onClick={() => push({ status: "all" })}>
          All <span className="text-muted">{total}</span>
        </button>
        {(Object.keys(STATUS_META) as KeyStatus[]).map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${current.status === s ? "border-accent text-accent" : ""}`}
            onClick={() => push({ status: s })}
          >
            {STATUS_META[s].label} <span className="text-muted">{counts[s]}</span>
          </button>
        ))}
      </div>
      <select
        className="input w-full sm:w-auto"
        value={current.batchId ?? ""}
        onChange={(e) => push({ batch: e.target.value })}
      >
        <option value="">All batches</option>
        {batches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name} ({b.count})
          </option>
        ))}
      </select>
      <form
        className="flex gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          push({ q });
        }}
      >
        <input className="input min-w-0 flex-1 sm:w-48" placeholder="Search assignee / note / hint" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-sm">Go</button>
        {current.q && (
          <button type="button" className="btn btn-sm" onClick={() => { setQ(""); push({ q: "" }); }}>
            ✕
          </button>
        )}
      </form>
    </div>
  );
}
