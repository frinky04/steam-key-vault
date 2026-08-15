export function AuthShell({ subtitle, children }: { subtitle: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="card w-full max-w-sm">
        <div className="mb-3 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-md" />
          <h1 className="text-lg font-semibold">Steam Key Vault</h1>
        </div>
        <p className="mb-4 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}
