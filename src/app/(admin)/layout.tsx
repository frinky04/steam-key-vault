import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { NavLinks } from "@/components/nav-links";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAdmin();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mobile-header sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto max-w-6xl px-4">
          <div className="mobile-header-bar flex h-12 items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-semibold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/icon.svg" alt="" width={22} height={22} className="rounded-md" />
              Steam Key Vault
            </Link>
            <NavLinks role="admin" className="hidden sm:flex" />
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden text-xs text-muted sm:inline" title={user.email}>
                {user.name} · admin
              </span>
              <form action={logoutAction}>
                <button className="btn btn-sm">Sign out</button>
              </form>
            </div>
          </div>
          <NavLinks role="admin" className="mobile-nav sm:hidden" />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-4 sm:py-6">{children}</main>
    </div>
  );
}
