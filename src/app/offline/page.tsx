import { SweeperMark } from "@/components/brand";

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
      <SweeperMark size={56} />
      <h1 className="h-page mt-2">You're offline</h1>
      <p className="muted max-w-md text-[15px]">
        Standings, scores and schedules need a connection. Scores can't be saved offline — reconnect and your league will be right where you left it.
      </p>
      <a className="btn btn-primary mt-2" href="">
        Try again
      </a>
    </main>
  );
}
