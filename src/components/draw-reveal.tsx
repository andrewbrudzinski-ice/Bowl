"use client";
import { Play, RotateCcw, SkipForward, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { CENTER, LANE, VIEW, boardAt, buildRolls, frameAt, laneHalf, totalTime, type DrawnShown } from "@/domain/reveal";
import { PinBody, PinDefs } from "./brand";

/**
 * "Watch the draw": a bowling ball rolls down a lane and, roll by roll, the pairings and matchups are revealed. The picture is a
 * pure function of the clock (see domain/reveal.ts); this file draws it. Skip jumps to the finished list, and anyone who prefers
 * reduced motion gets the finished list straight away.
 */

const BOARD_LINES = 9;

function Lane({ uid }: { uid: string }): ReactElement {
  const edge = (side: -1 | 1, y: number, f = 1) => CENTER + side * laneHalf(y) * f;
  const quad = (f1: number, f2: number) =>
    `${edge(-1, LANE.topY, f1)},${LANE.topY} ${edge(1, LANE.topY, f1)},${LANE.topY} ${edge(1, LANE.bottomY, f2)},${LANE.bottomY} ${edge(-1, LANE.bottomY, f2)},${LANE.bottomY}`;
  return (
    <g>
      {/* gutters, then the lane itself */}
      <polygon points={quad(1.34, 1.34)} fill="#1a1a1c" />
      <polygon points={quad(1, 1)} fill={`url(#${uid}-wood)`} />
      {Array.from({ length: BOARD_LINES - 1 }, (_, i) => {
        const f = -1 + ((i + 1) * 2) / BOARD_LINES;
        return <line key={i} x1={CENTER + f * LANE.topHalf} y1={LANE.topY} x2={CENTER + f * LANE.bottomHalf} y2={LANE.bottomY} stroke="#5b3a12" strokeOpacity={0.22} strokeWidth={0.8} />;
      })}
      {/* oil sheen and the foul line */}
      <polygon points={quad(1, 1)} fill={`url(#${uid}-sheen)`} />
      <line x1={CENTER - LANE.bottomHalf} y1={LANE.bottomY - 4} x2={CENTER + LANE.bottomHalf} y2={LANE.bottomY - 4} stroke="#2b1a07" strokeOpacity={0.55} strokeWidth={3} />
      {/* the arrows */}
      {[-3, -2, -1, 0, 1, 2, 3].map((k) => {
        const y = 330 + Math.abs(k) * 12;
        const x = CENTER + k * (laneHalf(y) / 3.6);
        return <path key={k} d={`M${x} ${y - 11} L${x - 4.5} ${y + 3} L${x + 4.5} ${y + 3} Z`} fill="#5b3a12" fillOpacity={0.55} />;
      })}
    </g>
  );
}

export function DrawReveal({ matches, week, open, onClose }: { matches: DrawnShown[]; week: number; open: boolean; onClose: () => void }): ReactElement {
  const uid = useId().replace(/[:]/g, "");
  const dialog = useRef<HTMLDialogElement>(null);
  const rolls = buildRolls(matches);
  const end = totalTime(rolls);
  const [time, setTime] = useState(0);
  const [reduced, setReduced] = useState(false);
  const raf = useRef<number | null>(null);

  // Open and close the native dialog (it traps focus and handles Escape).
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const stop = () => {
    if (raf.current != null) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const play = () => {
    stop();
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduced(reduce);
    if (reduce) {
      setTime(end);
      return;
    }
    setTime(0);
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      let finished = false;
      setTime((t) => {
        const next = Math.min(end, t + dt);
        finished = next >= end;
        return next;
      });
      raf.current = finished ? null : requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => {
    if (open) play();
    else stop();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, matches]);

  const f = frameAt(rolls, time);
  const board = boardAt(rolls, f.revealed);
  // Keep room for the finished list, so the buttons below it don't move as it fills in.
  const reserve = boardAt(rolls, rolls.length).reduce((t, e) => t + (e.kind === "extra" ? 84 : e.kind === "match" ? 50 : 42) + 8, 0);
  const latest = f.revealed > 0 ? rolls[f.revealed - 1] : null;
  const card = f.card ? rolls[f.card.roll] : null;
  const shakeX = f.shake * Math.sin(time * 90) * 3;
  const shakeY = f.shake * Math.cos(time * 77) * 2;
  const skip = () => {
    stop();
    setTime(end);
  };

  return (
    <dialog ref={dialog} className="draw-dialog" aria-labelledby={`${uid}-title`} onClose={onClose} onClick={(e) => e.target === dialog.current && onClose()}>
      {open ? (
      <>
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#e8c264]">Week {week}</div>
          <h2 id={`${uid}-title`} className="text-[18px] font-extrabold tracking-tight">The draw</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close the draw"><X size={18} aria-hidden /></button>
      </div>

      {reduced ? null : (
        <div className="relative mx-auto overflow-hidden rounded-2xl border border-white/10 bg-[#0b0b0b]" style={{ aspectRatio: `${VIEW.w} / ${VIEW.h}`, width: `min(calc(100% - 24px), calc(48dvh * ${(VIEW.w / VIEW.h).toFixed(4)}))` }}>
          <svg viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} className="absolute inset-0 h-full w-full" role="img" aria-label="A bowling ball rolls down the lane and knocks down the pins to reveal each pairing">
            <PinDefs id={uid} />
            <defs>
              <linearGradient id={`${uid}-wood`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#8f6a35" />
                <stop offset="0.45" stopColor="#c19a5b" />
                <stop offset="1" stopColor="#d6b377" />
              </linearGradient>
              <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fff" stopOpacity={0} />
                <stop offset="0.6" stopColor="#fff" stopOpacity={0.1} />
                <stop offset="1" stopColor="#fff" stopOpacity={0.02} />
              </linearGradient>
              <radialGradient id={`${uid}-ball`} cx="0.35" cy="0.3" r="0.8">
                <stop offset="0" stopColor="#4a4f6a" />
                <stop offset="0.55" stopColor="#1a1d33" />
                <stop offset="1" stopColor="#07080f" />
              </radialGradient>
              <radialGradient id={`${uid}-flash`} cx="0.5" cy="0.5" r="0.5">
                <stop offset="0" stopColor="#fff6d6" stopOpacity={0.95} />
                <stop offset="1" stopColor="#dcb048" stopOpacity={0} />
              </radialGradient>
            </defs>
            <g transform={`translate(${shakeX.toFixed(2)} ${shakeY.toFixed(2)})`}>
              <rect width={VIEW.w} height={VIEW.h} fill="#0b0b0b" />
              <rect x={0} y={0} width={VIEW.w} height={LANE.topY} fill="#141416" />
              <Lane uid={uid} />
              {f.pins.map((p, i) => (
                <g key={i} opacity={p.opacity.toFixed(3)} transform={`translate(${p.x.toFixed(2)} ${p.y.toFixed(2)}) rotate(${p.rot.toFixed(1)}) scale(${p.scale.toFixed(3)}) translate(-20 -100)`}>
                  {PinBody({ id: uid })}
                </g>
              ))}
              {f.ball.opacity > 0 ? (
                <g opacity={f.ball.opacity.toFixed(3)}>
                  <ellipse cx={f.ball.x} cy={f.ball.y + 20 * f.ball.scale} rx={24 * f.ball.scale} ry={7 * f.ball.scale} fill="#000" opacity={0.35} />
                  <g transform={`translate(${f.ball.x.toFixed(2)} ${f.ball.y.toFixed(2)}) scale(${f.ball.scale.toFixed(3)})`}>
                    <circle r={22} fill={`url(#${uid}-ball)`} />
                    <g transform={`rotate(${((f.ball.spin * 180) / Math.PI).toFixed(1)})`}>
                      <circle cx={-6} cy={-8} r={2.7} fill="#000" opacity={0.85} />
                      <circle cx={5} cy={-9} r={2.7} fill="#000" opacity={0.85} />
                      <circle cx={0} cy={4} r={3.2} fill="#000" opacity={0.85} />
                      <path d="M-16 8 Q0 20 16 8" stroke="#dcb048" strokeOpacity={0.35} strokeWidth={1.4} fill="none" />
                    </g>
                    <ellipse cx={-8} cy={-10} rx={6} ry={4} fill="#fff" opacity={0.28} transform="rotate(-30 -8 -10)" />
                  </g>
                </g>
              ) : null}
              {f.flash > 0 ? <circle cx={CENTER} cy={108} r={90} fill={`url(#${uid}-flash)`} opacity={f.flash} /> : null}
            </g>
          </svg>
          {card && f.card ? (
            <div className="pointer-events-none absolute inset-x-3 top-[34%] text-center" style={{ opacity: f.card.opacity, transform: `translateY(${(f.card.lift * 16).toFixed(1)}px) scale(${(0.94 + 0.06 * (1 - f.card.lift)).toFixed(3)})` }}>
              <div className="mx-auto max-w-[19rem] rounded-2xl border border-[#dcb048]/50 bg-[#0b0b0b]/88 px-5 py-4 shadow-[0_10px_40px_rgba(0,0,0,.6)] backdrop-blur-sm">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#e8c264]">{card.eyebrow}</div>
                <div className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-[#f3efe6]">{card.headline}</div>
                {card.sub ? <div className="mt-1.5 text-[13px] leading-snug text-[#cbc5b8]">{card.sub}</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      )}

      <p className="sr-only" aria-live="polite">{latest ? `${latest.eyebrow}: ${latest.headline}${latest.sub ? `, ${latest.sub}` : ""}` : ""}</p>

      <div className="px-5 pb-1 pt-3" style={{ minHeight: reserve + 16 }}>
        {reduced ? <p className="mb-2 text-[13px] text-[#cbc5b8]">Animations are turned off on this device, so here is the finished draw.</p> : null}
        {board.length === 0 ? <p className="text-[13px] text-[#cbc5b8]">Pairings appear here as the ball finds the pins…</p> : (
          <ol className="grid gap-2" aria-label="The draw so far">
            {board.map((e) => (
              <li key={e.key} className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-[14px] leading-snug">
                {e.kind === "match" ? (
                  <>
                    <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#e8c264]">Match {Number(e.key.slice(1)) + 1}</span>
                    <b className="font-bold">{e.a ?? "…"}</b> <span className="text-[#cbc5b8]">vs</span> <b className="font-bold">{e.b ?? "…"}</b>
                  </>
                ) : e.kind === "extra" ? (
                  <>
                    <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#e8c264]">Extra pair</span>
                    <b className="font-bold">{e.a}</b> <span className="text-[#cbc5b8]">vs {e.b}’s scores</span>
                    <span className="block text-[12.5px] text-[#a8a296]">Only {e.a} can earn points from this one.</span>
                  </>
                ) : (
                  <>
                    <span className="mr-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[#e8c264]">Sitting out</span>
                    <b className="font-bold">{e.a}</b>
                  </>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 bg-[#0e0e10] px-5 pb-4 pt-3">
        <div className="flex gap-2">
          <button type="button" className="btn btn-sm" onClick={play}><RotateCcw size={14} aria-hidden />Replay</button>
          <button type="button" className="btn btn-sm" onClick={skip} disabled={f.done}><SkipForward size={14} aria-hidden />Skip to the end</button>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>{f.done ? "Done" : "Close"}</button>
      </div>
      </>
      ) : null}
    </dialog>
  );
}

/** A button that opens the reveal for a drawn week. */
export function WatchDrawButton({ matches, week, label = "Watch the draw", className = "btn btn-sm" }: { matches: DrawnShown[]; week: number; label?: string; className?: string }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}><Play size={14} aria-hidden />{label}</button>
      <DrawReveal matches={matches} week={week} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
