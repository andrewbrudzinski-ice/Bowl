export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <main id="main" className="wrap flex min-h-dvh flex-col items-center justify-center gap-3 text-center">
      <h1 className="h-page">You're offline</h1>
      <p className="muted max-w-sm">
        Standings, scores and schedules need a connection. Scores can't be saved offline — reconnect and your league will be right where you left it.
      </p>
      <a className="btn btn-primary" href="">
        Try again
      </a>
    </main>
  );
}
