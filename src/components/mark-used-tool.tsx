"use client";

import { useMemo, useState, useTransition } from "react";
import { markUsedFromText } from "@/lib/actions/keys";
import { parseKeysFromText } from "@/lib/parse-keys";

export function MarkUsedTool() {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<"used" | "invalid">("used");
  const [assignee, setAssignee] = useState("");
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ updated: number; notFound: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = useMemo(() => parseKeysFromText(text), [text]);

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold">Mark keys by pasting them</h2>
        <p className="text-sm text-muted">
          Already redeemed some keys yourself, or handed them out over Discord? Paste them here and they will be marked
          across every app. Keys not in the vault are listed back so nothing goes missing silently.
        </p>
      </div>
      <textarea
        className="input min-h-40 font-mono text-xs"
        placeholder="AAAAA-BBBBB-CCCCC&#10;AAAAA-BBBBB-DDDDD"
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Mark as</label>
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value as "used" | "invalid")}>
            <option value="used">Used</option>
            <option value="invalid">Invalid</option>
          </select>
        </div>
        <div className="flex-1">
          <label className="label">Assignee (optional)</label>
          <input className="input" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="who got them" />
        </div>
        <button
          className="btn btn-primary"
          disabled={pending || parsed.keys.length === 0}
          onClick={() =>
            start(async () => {
              setError(null);
              const r = await markUsedFromText({ text, status, assignee });
              if (!r.ok) return setError(r.error);
              setResult(r.data!);
            })
          }
        >
          {pending ? "Working…" : `Mark ${parsed.keys.length} as ${status}`}
        </button>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      {result && (
        <div className="rounded-md border border-border bg-surface-2 p-3 text-sm">
          <p>
            <b className="text-ok">{result.updated}</b> key(s) marked {status}.
          </p>
          {result.notFound.length > 0 && (
            <div className="mt-2">
              <p className="text-warn">{result.notFound.length} not found in the vault:</p>
              <pre className="mt-1 max-h-40 overflow-auto font-mono text-xs text-muted">{result.notFound.join("\n")}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
