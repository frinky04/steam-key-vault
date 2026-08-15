"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { UserRole } from "@/db/schema";

type NavItem = { href: string; label: string; match?: (p: string) => boolean };
const ADMIN: NavItem[] = [
  { href: "/", label: "Apps", match: (p: string) => p === "/" || p.startsWith("/apps") },
  { href: "/import", label: "Import" },
  { href: "/links", label: "Links" },
  { href: "/tools", label: "Tools" },
  { href: "/users", label: "Users" },
  { href: "/activity", label: "Activity" },
  { href: "/send", label: "Send", match: (p: string) => p.startsWith("/send") || p.startsWith("/my-links") },
];
const DEV: NavItem[] = [
  { href: "/send", label: "Send keys" },
  { href: "/my-links", label: "My links" },
];

export function NavLinks({ role }: { role: UserRole }) {
  const path = usePathname();
  const links = role === "admin" ? ADMIN : DEV;
  return (
    <nav className="flex items-center gap-1 text-sm">
      {links.map((l) => {
        const active = l.match ? l.match(path) : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-md px-2.5 py-1 transition ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
