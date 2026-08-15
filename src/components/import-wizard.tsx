"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { parseFilename, parseKeysFromText } from "@/lib/parse-keys";
import { checkExisting, importKeys, type ImportSummary } from "@/lib/actions/import";

type AppOpt = { id: number; name: string; steamAppId: number | null };

export function ImportWizard({ apps, preselect }: { apps: AppOpt[]; preselect?: number }) {
  const [appId, setAppId] = useState<number>(preselect && apps.some((a) => a.id === preselect) ? preselect : apps[0].id);
  const [text, setText] = useState("");
  const [batchName, setBatchName] = useState("");
  const [source, setSource] = useState("");
  const [notes, setNotes] = useState("");
  const [useContext, setUseContext] = useState(false);
  const [expected, setExpected] = useState<number | null>(null);
  const [existingState, setExistingState] = useState<{ sig: string; list: string[] } | null>(null);
  const [checking, startCheck] = useTransition();
  const [importing, startImport] = useTransition();
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseKeysFromText(text), [text]);
  const hasContext = parsed.keys.some((k) => k.context);
  const keySig = parsed.keys.map((k) => k.key).join("\n");
  // Only trust the dedup result if it was computed for the current set of keys.
  const existing = existingState && existingState.sig === keySig ? existingState.list : null;

  // Debounced server-side dedup check.
  useEffect(() => {
    if (!keySig) return;
    const t = setTimeout(() => {
      startCheck(async () => {
        const list = await checkExisting(keySig.split("\n"));
        setExistingState({ sig: keySig, list });
      });
    }, 400);
    return () => clearTimeout(t);
  }, [keySig]);

  async function addFiles(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    const chunks: string[] = [];
    let total = 0;
    for (const f of list) {
      chunks.push(`# ${f.name}\n${await f.text()}`);
      const meta = parseFilename(f.name);
      if (meta.expectedCount) total += meta.expectedCount;
    }
    if (!batchName) {
      const meta = parseFilename(list[0].name);
      setBatchName(list.length === 1 ? meta.suggestedName : `${meta.suggestedName} +${list.length - 1} more`);
      if (meta.packageId && !source) setSource(`Steamworks pkg ${meta.packageId}`);
    }
    setExpected(total || null);
    setText((t) => (t ? t + "\n" : "") + chunks.join("\n"));
  }

  function doImport() {
    setError(null);
    startImport(async () => {
      const r = await importKeys({ appId, batchName, source, notes, text, useContextAsNote: useContext });
      if (!r.ok) return setError(r.error);
      setResult(r.data!);
    });
  }

  if (result) {
    const app = apps.find((a) => a.id === appId);
    return (
      <div className="card space-y-3">
        <h2 className="font-semibold">Import complete</h2>
        <ul className="text-sm">
          <li>
            <b className="text-ok">{result.inserted}</b> new keys added to <b>{app?.name}</b>
          </li>
          {result.duplicatesInDb > 0 && (
            <li>
              <b className="text-warn">{result.duplicatesInDb}</b> skipped — already in the vault
            </li>
          )}
          {result.duplicatesInInput > 0 && <li>{result.duplicatesInInput} repeated inside the paste (skipped)</li>}
          {result.ignoredLines > 0 && <li className="text-muted">{result.ignoredLines} lines had no key on them</li>}
        </ul>
        <div className="flex gap-2">
          <Link href={`/apps/${appId}?batch=${result.batchId}`} className="btn btn-primary">
            View batch
          </Link>
          <button className="btn" onClick={() => { setResult(null); setText(""); setBatchName(""); setSource(""); setNotes(""); setExpected(null); }}>
            Import another
          </button>
        </div>
      </div>
    );
  }

  const newCount = existing ? parsed.keys.length - existing.length : null;

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label">Into app</label>
          <select className="input" value={appId} onChange={(e) => setAppId(Number(e.target.value))}>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.steamAppId ? ` (#${a.steamAppId})` : ""}
              </option>
            ))}
          </select>
        </div>

        <div
          className={`rounded-md border-2 border-dashed p-3 transition ${drag ? "border-accent bg-accent/5" : "border-border"}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
        >
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted">Drop files here, or</span>
            <div className="flex gap-2">
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                Choose files…
              </button>
              {text && (
                <button className="btn btn-sm" onClick={() => { setText(""); setExpected(null); }}>
                  Clear
                </button>
              )}
            </div>
            <input ref={fileRef} type="file" multiple accept=".txt,.csv,.tsv,text/plain" hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
          </div>
          <textarea
            className="input min-h-48 font-mono text-xs"
            placeholder={"AAAAA-BBBBB-CCCCC\nGame Name: AAAAA-BBBBB-DDDDD\nfriend@example.com, AAAAA-BBBBB-EEEEE"}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>

        {/* Preview */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <b>{parsed.keys.length}</b> keys found
          </span>
          {existing === null && parsed.keys.length > 0 && <span className="text-muted">{checking ? "checking vault…" : ""}</span>}
          {existing && existing.length > 0 && (
            <span className="text-warn">
              {existing.length} already in vault → <b>{newCount}</b> new
            </span>
          )}
          {existing && existing.length === 0 && <span className="text-ok">all new</span>}
          {parsed.duplicateLines > 0 && <span className="text-muted">{parsed.duplicateLines} repeated in paste</span>}
          {parsed.ignoredLines > 0 && <span className="text-muted">{parsed.ignoredLines} lines without keys</span>}
          {expected !== null && expected !== parsed.keys.length && (
            <span className="text-danger">filename says {expected} keys, found {parsed.keys.length}</span>
          )}
        </div>

        {parsed.keys.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Show parsed keys</summary>
            <div className="mt-2 max-h-48 overflow-auto rounded border border-border">
              <table className="w-full">
                <tbody>
                  {parsed.keys.slice(0, 300).map((k) => (
                    <tr key={k.key} className="border-b border-border last:border-0">
                      <td className="px-2 py-0.5 text-muted">{k.line}</td>
                      <td className={`px-2 py-0.5 font-mono ${existing?.includes(k.key) ? "text-warn line-through" : ""}`}>{k.key}</td>
                      <td className="truncate px-2 py-0.5 text-muted">{k.context}</td>
                    </tr>
                  ))}
                  {parsed.keys.length > 300 && (
                    <tr>
                      <td colSpan={3} className="px-2 py-1 text-muted">
                        …and {parsed.keys.length - 300} more
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </div>

      <div className="card space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Batch name</label>
            <input className="input" value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="e.g. Beta testing wave 2" />
          </div>
          <div>
            <label className="label">Source</label>
            <input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="Steamworks pkg 1772375, publisher, bundle…" />
          </div>
        </div>
        <div>
          <label className="label">Batch notes</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="optional" />
        </div>
        {hasContext && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={useContext} onChange={(e) => setUseContext(e.target.checked)} />
            Save the leftover text on each line as the key&apos;s note (names, emails, etc.)
          </label>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-end gap-3">
          <button className="btn btn-primary w-full sm:w-auto" disabled={importing || parsed.keys.length === 0} onClick={doImport}>
            {importing ? "Importing…" : `Import ${newCount ?? parsed.keys.length} keys`}
          </button>
        </div>
      </div>
    </div>
  );
}
