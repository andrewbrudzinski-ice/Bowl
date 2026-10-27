import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-3 text-center">
      <div className="score text-5xl text-faint">404</div>
      <h1 className="h-page">We couldn't find that page</h1>
      <p className="muted max-w-sm text-[13px]">It may have moved, or you may need to sign in or ask the commissioner for an invitation.</p>
      <div className="flex gap-2">
        <Link href="/" className="btn btn-primary">Go home</Link>
        <Link href="/login" className="btn">Sign in</Link>
      </div>
    </main>
  );
}
