import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center gap-5 px-4 py-10">
      <Link href="/" className="self-center" aria-label="Sweeper home">
        <Wordmark className="text-xl" size={34} />
      </Link>
      <div className="card p-5">{children}</div>
    </main>
  );
}
