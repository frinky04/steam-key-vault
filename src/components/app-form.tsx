"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApp, lookupSteamApp, updateApp } from "@/lib/actions/apps";

type Props = {
  mode: "create" | "edit";
  initial?: { id: number; name: string; steamAppId: number | null; headerImage: string | null; notes: string | null };
  onDone?: () => void;
};

export function AppForm({ mode, initial, onDone }: Props) {
  const router = useRouter();
  const [steamAppId, setSteamAppId] = useState(initial?.steamAppId ? String(initial.steamAppId) : "");
  const [name, setName] = useState(initial?.name ?? "");
  const [headerImage, setHeaderImage] = useState(initial?.headerImage ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [looking, startLookup] = useTransition();

  function lookup() {
    const id = Number(steamAppId);
    if (!id) return;
    setInfo(null);
    startLookup(async () => {
      const r = await lookupSteamApp(id);
      if (!r) {
        setInfo("Steam returned nothing for that App ID (unreleased / hidden apps do this). Fill in the name manually.");
        return;
      }
      setName(r.name);
      setHeaderImage(r.headerImage ?? "");
      setInfo(`Found: ${r.name} (${r.type})`);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const payload = { name, steamAppId: steamAppId ? Number(steamAppId) : null, headerImage: headerImage || null, notes: notes || null };
      const res = mode === "create" ? await createApp(payload) : await updateApp(initial!.id, payload);
      if (!res.ok) return setError(res.error);
      if (mode === "create" && res.data) router.push(`/apps/${res.data.id}`);
      else {
        router.refresh();
        onDone?.();
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="label">Steam App ID</label>
        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
          <input
            className="input font-mono"
            inputMode="numeric"
            placeholder="e.g. 620"
            value={steamAppId}
            onChange={(e) => setSteamAppId(e.target.value.replace(/\D/g, ""))}
            onBlur={() => mode === "create" && !name && lookup()}
          />
          <button type="button" className="btn" onClick={lookup} disabled={looking || !steamAppId}>
            {looking ? "Looking…" : "Fetch from Steam"}
          </button>
        </div>
        <p className="mt-1 text-xs text-muted">
          The number in the store URL: store.steampowered.com/app/<b>620</b>/. Optional, but it pulls the name and artwork.
        </p>
        {info && <p className="mt-1 text-xs text-accent">{info}</p>}
      </div>
      <div>
        <label className="label">Name</label>
        <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Game / DLC / package name" />
      </div>
      <div>
        <label className="label">Header image URL</label>
        <input className="input" value={headerImage} onChange={(e) => setHeaderImage(e.target.value)} placeholder="optional" />
      </div>
      <div>
        <label className="label">Notes</label>
        <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Region locks, expiry, where keys came from…" />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="modal-actions flex gap-2 sm:justify-end">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? "Create app" : "Save"}
        </button>
        {onDone && (
          <button type="button" className="btn" onClick={onDone}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
