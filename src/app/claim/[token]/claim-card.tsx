"use client";

import { useState, useTransition } from "react";
import type { ClaimView } from "@/lib/claim";
import { revealAction } from "./actions";
import { CopyButton } from "@/components/copy-button";
import { LocalTime } from "@/components/local-time";
import { isNoExpiry } from "@/lib/expiry";

type View = ClaimView | { state: "rate_limited" };

export function ClaimCard({ token, initial }: { token: string; initial: ClaimView }) {
  const [view, setView] = useState<View>(initial);
  const [pending, start] = useTransition();

  const header =
    "headerImage" in view && view.headerImage ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={view.headerImage} alt="" className="aspect-[460/215] w-full rounded-md object-cover" />
    ) : null;

  const appName = "appName" in view ? view.appName : null;

  return (
    <div className="card w-full max-w-md space-y-4">
      {header}
      {appName && (
        <h1 className="text-lg font-semibold">
          {view.state === "ready" && view.appNames.length > 1 ? view.appNames.join(" + ") : appName}
        </h1>
      )}

      {view.state === "ready" && (
        <>
          <p className="text-sm text-muted">
            {view.label ? `Hi ${view.label}! ` : ""}You have been given{" "}
            {view.keyCount > 1 ? <b className="text-foreground">{view.keyCount} Steam keys</b> : "a Steam key"} for{" "}
            <b className="text-foreground">{view.appNames.join(" + ")}</b>. Clicking the button below reveals{" "}
            {view.keyCount > 1 ? "them" : "it"} <b className="text-foreground">once</b>. Make sure you are ready to redeem.
          </p>
          <p className="text-xs text-muted">
            {isNoExpiry(view.expiresAt) ? "This link does not expire." : <>This link expires <LocalTime value={view.expiresAt} />.</>}
          </p>
          <button
            className="btn btn-primary w-full justify-center py-2.5 text-base"
            disabled={pending}
            onClick={() => start(async () => setView(await revealAction(token)))}
          >
            {pending ? "Revealing…" : view.keyCount > 1 ? `Reveal my ${view.keyCount} keys` : "Reveal my key"}
          </button>
        </>
      )}

      {view.state === "revealed" && (
        <>
          <div className="space-y-2">
            {view.keys.map((k, i) => (
              <div key={i} className="rounded-md border border-accent/40 bg-accent/10 p-3">
                {view.keys.length > 1 && (
                  <div className="mb-1 text-xs text-muted">
                    {k.appName}
                    {view.keys.filter((x) => x.appName === k.appName).length > 1 ? ` · key ${view.keys.filter((x, j) => x.appName === k.appName && j <= i).length}` : ""}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <div className="select-all flex-1 text-center font-mono text-xl tracking-wider">{k.key}</div>
                  <a
                    className="btn btn-sm shrink-0"
                    href={`https://store.steampowered.com/account/registerkey?key=${encodeURIComponent(k.key)}`}
                    target="_blank"
                    rel="noreferrer"
                    title="Redeem on Steam"
                  >
                    Redeem ↗
                  </a>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <CopyButton
              text={view.keys.map((k) => k.key).join("\n")}
              label={view.keys.length > 1 ? `Copy all ${view.keys.length} keys` : "Copy key"}
              className="btn flex-1 justify-center"
            />
            {view.keys.length === 1 && (
              <a
                className="btn btn-primary flex-1 justify-center"
                href={`https://store.steampowered.com/account/registerkey?key=${encodeURIComponent(view.keys[0].key)}`}
                target="_blank"
                rel="noreferrer"
              >
                Redeem on Steam ↗
              </a>
            )}
          </div>
          <p className="text-xs text-muted">
            Save {view.keys.length > 1 ? "these" : "the key"} now. This page will keep showing {view.keys.length > 1 ? "them" : "it"} in this browser for 24 hours,
            then {view.keys.length > 1 ? "they are" : "it is"} gone. If a key fails to activate, contact whoever sent you the link.
          </p>
        </>
      )}

      {view.state === "already_claimed" && (
        <p className="text-sm text-muted">
          This key was already revealed on <LocalTime value={view.revealedAt} />. If that was not you, contact
          the person who sent you this link.
        </p>
      )}
      {view.state === "expired" && <p className="text-sm text-muted">This link has expired. Ask the sender for a fresh one.</p>}
      {view.state === "revoked" && <p className="text-sm text-muted">This link was revoked by the sender.</p>}
      {view.state === "not_found" && (
        <>
          <h1 className="text-lg font-semibold">Link not found</h1>
          <p className="text-sm text-muted">Check that you copied the whole URL.</p>
        </>
      )}
      {view.state === "rate_limited" && <p className="text-sm text-danger">Too many attempts from your network. Try again in a few minutes.</p>}
    </div>
  );
}
