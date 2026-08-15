"use client";

import { useState } from "react";
import type { CreatedLink } from "@/lib/actions/links";
import { CopyButton } from "./copy-button";

export function LinksResult({ links, onClose }: { links: CreatedLink[]; onClose: () => void }) {
  const [copiedAll, setCopiedAll] = useState(false);
  const all = links.map((l) => l.url).join("\n");
  return (
    <div className="space-y-3">
      <p className="text-sm text-warn">
        These URLs are shown once. Copy them now. Anyone with a link can claim its key, so paste them where only the
        recipient sees them.
      </p>
      <div className="max-h-[50vh] overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <tbody>
            {links.map((l) => (
              <tr key={l.keyId} className="border-b border-border last:border-0">
                <td className="px-2 py-1.5 font-mono text-xs text-muted">…{l.keyHint}</td>
                <td className="px-2 py-1.5 font-mono text-xs break-all">{l.url}</td>
                <td className="px-2 py-1.5 text-right">
                  <CopyButton text={l.url} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex justify-end gap-2">
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(all);
            setCopiedAll(true);
            setTimeout(() => setCopiedAll(false), 1500);
          }}
        >
          {copiedAll ? "Copied!" : `Copy all (${links.length})`}
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
