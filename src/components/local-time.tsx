"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(subscribe, () => true, () => false);

/** Renders a timestamp in the viewer's locale/timezone without hydration mismatches. */
export function LocalTime({ value, className, title }: { value: string | Date | null | undefined; className?: string; title?: string }) {
  const isClient = useIsClient();
  if (!value) return <span className={className}>—</span>;
  const d = typeof value === "string" ? new Date(value) : value;
  const iso = d.toISOString();
  const text = isClient ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : iso.slice(0, 16).replace("T", " ") + " UTC";
  return (
    <time dateTime={iso} className={className} title={title ?? iso}>
      {text}
    </time>
  );
}
