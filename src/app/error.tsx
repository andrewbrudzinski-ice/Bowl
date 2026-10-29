"use client";
import { useEffect } from "react";
import { SweeperMark } from "@/components/brand";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Server details are logged server-side; the digest lets an operator find the matching log line.
  }, [error]);
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <SweeperMark size={56} />
      <h1 className="h-page mt-2">Something went wrong</h1>
      <p className="muted max-w-md text-[15px]">Your data is safe — nothing is changed by viewing a page. Try again, and if it keeps happening tell your commissioner{error.digest ? ` (reference ${error.digest})` : ""}.</p>
      <div className="mt-2 flex flex-wrap justify-center gap-3">
        <button className="btn btn-primary" onClick={reset}>Try again</button>
        <a className="btn" href="/">Home</a>
      </div>
    </main>
  );
}
