"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClaimLinks, type CreatedLink } from "@/lib/actions/links";
import { LinksResult } from "./links-result";
import { ExpiryField } from "./expiry-field";

type AppOpt = { id: number; name: string; headerImage: string | null; available: number };
type Limits = { batch: number; remainingToday: number } | null;

export function SendKeys({ apps, limits }: { apps: AppOpt[]; limits: Limits }) {
  const router = useRouter();
  const [appId, setAppId] = useState<number>(apps.find((a) => a.available > 0)?.id ?? apps[0].id);
  const [count, setCount] = useState("1");
  const [perLink, setPerLink] = useState("1");
  const [label, setLabel] = useState("");
  const [ttl, setTtl] = useState("48");
  const [noExpiry, setNoExpiry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [links, setLinks] = useState<CreatedLink[] | null>(null);
  const [pending, start] = useTransition();

  const app = apps.find((a) => a.id === appId)!;
  const maxCount = Math.max(1, Math.min(app.available, limits ? Math.min(limits.batch, limits.remainingToday) : 500));
  const blocked = limits ? limits.remainingToday <= 0 : false;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createClaimLinks({ appId, count: Number(count), keysPerLink: Number(perLink), label, ttlHours: noExpiry ? 0 : Number(ttl) });
      if (!r.ok) return setError(r.error);
      setLinks(r.data ?? []);
      router.refresh();
    });
  }

  if (links) {
    return (
      <div className="card space-y-3">
        <h2 className="font-semibold">
          {links.length} link{links.length === 1 ? "" : "s"} for {app.name}
          {links.some((l) => l.keyIds.length > 1) ? ` (${links.reduce((n, l) => n + l.keyIds.length, 0)} keys)` : ""}
        </h2>
        <LinksResult links={links} onClose={() => { setLinks(null); setCount("1"); setLabel(""); }} />
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-[1fr_320px]">
      <div className="grid content-start gap-2 sm:grid-cols-2">
        {apps.map((a) => (
          <button
            type="button"
            key={a.id}
            onClick={() => setAppId(a.id)}
            className={`card flex items-center gap-3 self-start p-2 text-left transition ${a.id === appId ? "border-accent" : "hover:border-accent/50"} ${a.available === 0 ? "opacity-50" : ""}`}
          >
            <div className="h-12 w-24 shrink-0 overflow-hidden rounded bg-surface-2">
              {a.headerImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.headerImage} alt="" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{a.name}</div>
              <div className={`text-xs ${a.available > 0 ? "text-ok" : "text-muted"}`}>{a.available} available</div>
            </div>
          </button>
        ))}
      </div>

      <div className="card space-y-3 self-start">
        <div className="text-sm font-medium">{app.name}</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">How many keys</label>
            <input className="input" type="number" min={1} max={maxCount} value={count} onChange={(e) => setCount(e.target.value)} disabled={blocked || app.available === 0} />
            <p className="mt-1 text-xs text-muted">
              {app.available === 0 ? "No keys available." : `max ${maxCount} right now`}
            </p>
          </div>
          <div>
            <label className="label">Keys per link</label>
            <input className="input" type="number" min={1} max={20} value={perLink} onChange={(e) => setPerLink(e.target.value)} disabled={blocked || app.available === 0} />
            <p className="mt-1 text-xs text-muted">
              {Number(perLink) > 1 ? `→ ${Math.floor(Number(count) / Number(perLink)) || 0} link(s)` : "one link per key"}
            </p>
          </div>
        </div>
        <div>
          <label className="label">Who is it for? (optional)</label>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Sam (beta tester)" />
        </div>
        <ExpiryField ttl={ttl} setTtl={setTtl} noExpiry={noExpiry} setNoExpiry={setNoExpiry} />
        {error && <p className="text-sm text-danger">{error}</p>}
        {blocked && <p className="text-sm text-warn">You have used today&apos;s allowance. It resets at midnight UTC.</p>}
        <button className="btn btn-primary w-full justify-center" disabled={pending || blocked || app.available === 0}>
          {pending ? "Creating…" : `Send ${count || 1} key${Number(count) === 1 ? "" : "s"}`}
        </button>
      </div>
    </form>
  );
}
