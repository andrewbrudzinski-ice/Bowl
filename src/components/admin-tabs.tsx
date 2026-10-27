"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function AdminTabs({ items, base }: { items: { href: string; label: string }[]; base: string }) {
  const pathname = usePathname();
  return (
    <nav className="pill-nav mb-4 border-b border-line pb-2" aria-label="Commissioner sections">
      {items.map((i) => (
        <Link key={i.href} href={i.href} className="tab" aria-current={i.href === base ? (pathname === base ? "page" : undefined) : pathname.startsWith(i.href) ? "page" : undefined}>{i.label}</Link>
      ))}
    </nav>
  );
}
