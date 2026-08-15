"use client";

export function ExpiryField({
  ttl,
  setTtl,
  noExpiry,
  setNoExpiry,
}: {
  ttl: string;
  setTtl: (v: string) => void;
  noExpiry: boolean;
  setNoExpiry: (v: boolean) => void;
}) {
  return (
    <div>
      <label className="label">Link expires in (hours)</label>
      <input className="input" type="number" min={1} max={8760} value={ttl} onChange={(e) => setTtl(e.target.value)} disabled={noExpiry} />
      <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />
        No expiry
      </label>
    </div>
  );
}
