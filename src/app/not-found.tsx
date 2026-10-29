import Link from "next/link";
import { SweeperMark } from "@/components/brand";

export default function NotFound() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <SweeperMark size={56} />
      <div className="h-display text-[72px] text-[var(--accent-text)] md:text-[96px]">404</div>
      <h1 className="h-page">We couldn't find that page</h1>
      <p className="muted max-w-md text-[15px]">It may have moved, or you may need to sign in or ask the commissioner for an invitation.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn btn-primary">Go home</Link>
        <Link href="/login" className="btn">Sign in</Link>
      </div>
    </main>
  );
}
