import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-5 px-4 py-10">
      <Link href="/" className="flex items-center gap-2 self-center">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-lg font-black text-[var(--accent-ink)]">B</span>
        <span className="text-lg font-bold tracking-tight">Bowl</span>
      </Link>
      <div className="card p-5">{children}</div>
    </main>
  );
}
