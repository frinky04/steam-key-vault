"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
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

export function NavLinks({ role, className = "" }: { role: UserRole; className?: string }) {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const links = role === "admin" ? ADMIN : DEV;
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>("[aria-current='page']")?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [path]);
  return (
    <nav ref={navRef} className={`flex items-center gap-1 text-sm ${className}`} aria-label="Primary navigation">
      {links.map((l) => {
        const active = l.match ? l.match(path) : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 transition ${active ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
