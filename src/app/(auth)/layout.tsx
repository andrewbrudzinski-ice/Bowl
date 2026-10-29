import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-7 px-5 py-12">
      <Link href="/" className="self-center" aria-label="Sweeper home">
        <Wordmark className="text-xl" size={38} />
      </Link>
      <div className="card p-7 !shadow-[var(--shadow-md)] sm:p-8">{children}</div>
    </main>
  );
}
