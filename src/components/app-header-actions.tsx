"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { App, KeyStatus } from "@/db/schema";
import { deleteApp, refreshAppFromSteam } from "@/lib/actions/apps";
import { createClaimLinks, type CreatedLink } from "@/lib/actions/links";
import { exportKeys } from "@/lib/actions/keys";
import { AppForm } from "./app-form";
import { Modal } from "./modal";
import { LinksResult } from "./links-result";
import { ExpiryField } from "./expiry-field";

export function AppHeaderActions({ app, counts }: { app: App; counts: Record<KeyStatus, number> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [linkModal, setLinkModal] = useState(false);
  const [links, setLinks] = useState<CreatedLink[] | null>(null);
  const [count, setCount] = useState("1");
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("48");
  const [noExpiry, setNoExpiry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createClaimLinks({ appId: app.id, count: Number(count), label, ttlHours: noExpiry ? 0 : Number(ttl) });
      if (!res.ok) return setError(res.error);
      setLinks(res.data ?? []);
      router.refresh();
    });
  }

  function doExport() {
    start(async () => {
      const res = await exportKeys({ appId: app.id });
      if (!res.ok) return alert(res.error);
      const blob = new Blob([res.data!.text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${app.name.replace(/[^a-z0-9]+/gi, "_")}_keys.tsv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-primary btn-sm" onClick={() => { setLinks(null); setLinkModal(true); }} disabled={counts.available === 0}>
        Generate links
      </button>
      <button className="btn btn-sm" onClick={() => setEditing(true)}>
        Edit
      </button>
      {app.steamAppId && (
        <button className="btn btn-sm" disabled={pending} onClick={() => start(async () => { const r = await refreshAppFromSteam(app.id); if (!r.ok) alert(r.error); router.refresh(); })}>
          Refresh from Steam
        </button>
      )}
      <button className="btn btn-sm" disabled={pending} onClick={doExport} title="Download all keys (decrypted) as TSV. Logged.">
        Export
      </button>
      <button
        className="btn btn-danger btn-sm"
        onClick={() => {
          if (confirm(`Delete "${app.name}" and ALL its keys? This cannot be undone.`)) start(() => deleteApp(app.id));
        }}
      >
        Delete
      </button>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit app">
        <AppForm mode="edit" initial={app} onDone={() => setEditing(false)} />
      </Modal>

      <Modal open={linkModal} onClose={() => setLinkModal(false)} title={links ? "Links created" : "Generate claim links"} wide={!!links}>
        {links ? (
          <LinksResult links={links} onClose={() => setLinkModal(false)} />
        ) : (
          <form onSubmit={generate} className="space-y-3">
            <p className="text-sm text-muted">
              Pulls the next available keys from the pool and creates one single-use link per key. Keys are marked
              <b> reserved</b> until the link is opened (→ claimed), revoked, or expires (→ back to available).
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="label">How many</label>
                <input className="input" type="number" min={1} max={Math.min(500, counts.available)} value={count} onChange={(e) => setCount(e.target.value)} />
                <p className="mt-1 text-xs text-muted">{counts.available} available</p>
              </div>
              <div>
                <label className="label">Label (who)</label>
                <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
              </div>
              <ExpiryField ttl={ttl} setTtl={setTtl} noExpiry={noExpiry} setNoExpiry={setNoExpiry} />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setLinkModal(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={pending}>
                {pending ? "Creating…" : "Create links"}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
