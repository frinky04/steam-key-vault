import type { KeyStatus } from "@/db/schema";
import { isNoExpiry } from "@/lib/expiry";

export const STATUS_META: Record<KeyStatus, { label: string; className: string; dot: string }> = {
  available: { label: "Available", className: "bg-ok/15 text-ok", dot: "bg-ok" },
  reserved: { label: "Reserved", className: "bg-warn/15 text-warn", dot: "bg-warn" },
  claimed: { label: "Claimed", className: "bg-accent/15 text-accent", dot: "bg-accent" },
  used: { label: "Used", className: "bg-muted/20 text-muted", dot: "bg-muted" },
  invalid: { label: "Invalid", className: "bg-danger/15 text-danger", dot: "bg-danger" },
};

export function StatusBadge({ status }: { status: KeyStatus }) {
  const m = STATUS_META[status];
  return <span className={`badge ${m.className}`}>{m.label}</span>;
}

export function StatusPills({ counts, compact }: { counts: Record<KeyStatus, number>; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(STATUS_META) as KeyStatus[]).map((s) =>
        compact && counts[s] === 0 ? null : (
          <span key={s} className={`badge ${STATUS_META[s].className} gap-1 normal-case tracking-normal`}>
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[s].dot}`} />
            {counts[s]} {STATUS_META[s].label.toLowerCase()}
          </span>
        ),
      )}
    </div>
  );
}

/** Relative time until `d`, computed against a caller-supplied `now` so SSR and hydration agree. */
export function timeUntil(d: Date | string, now: number) {
  const date = typeof d === "string" ? new Date(d) : d;
  if (isNoExpiry(date)) return "no expiry";
  const ms = date.getTime() - now;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)}d`;
  if (h >= 1) return `${h}h ${m}m`;
  return `${m}m`;
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 py-10 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}
