import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { NavLinks } from "@/components/nav-links";

export default async function DevLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-4xl items-center gap-6 px-4">
          <Link href={user.role === "admin" ? "/" : "/send"} className="flex items-center gap-2 font-semibold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.svg" alt="" width={22} height={22} className="rounded-md" />
            Steam Key Vault
          </Link>
          <NavLinks role={user.role} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-muted sm:inline" title={user.email}>
              {user.name} · {user.role}
            </span>
            <form action={logoutAction}>
              <button className="btn btn-sm">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-6">{children}</main>
    </div>
  );
}
