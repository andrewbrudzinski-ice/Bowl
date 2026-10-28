"use client";
import React, { useEffect, useRef } from "react";
import { LETTERS, LaneBackdrop, PinBody, PinDefs, SceneDefs, SceneVignette, SweepBarAcross, laneLeft, laneRight } from "./brand";

/**
 * The home-page logo, animated: the pins stand in a cluster at the far end of the lane, the sweeper bar charges up the lane from the
 * bowler's end, the pins burst out and tumble, and land where the finished logo has them, spelling S-W-E-E-P-E-R. The bar then pulls
 * back to its resting spot.
 *
 * The artwork is the same as <SweeperLogo>; frames are drawn by setting transforms directly on the SVG (no React re-renders), and the
 * first render is the finished logo, so server HTML, no-JS visitors and "reduce motion" visitors all see the final picture.
 * Plays once per browser session; clicking the logo plays it again.
 */

const SEEN_KEY = "sweeper-intro-seen";
const BAR_REST = 322;
const BAR_HIT = 200;
const T_BAR_START = 0.3;
const T_HIT = 1.2;
const T_BAR_BACK = 2.3;
const FLIGHT = 1.0;
/** The top edge of the logo's viewBox, plus a little air. */
const TOP = 30;
/** Resting opacity of a pin shadow (what <PinShadows> draws). */
const SHADOW = 0.3;
export const T_END = 2.75;

/** Where each pin stands before the sweep: a tight cluster on the pin deck (front pin nearest the bowler). Indexed like LETTERS. */
const STAND: { x: number; y: number }[] = [
  { x: 370, y: 171 }, // S
  { x: 385, y: 181 }, // W
  { x: 400, y: 191 }, // E
  { x: 400, y: 171 }, // E
  { x: 415, y: 181 }, // P
  { x: 430, y: 171 }, // E
  { x: 400, y: 161 }, // R
];
const standScale = (y: number) => 0.46 + (y - 160) * 0.004;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInCubic = (t: number) => t * t * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number) => {
  const c1 = 1.5;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** The bar's height on screen at time t: off the bottom, charging up the lane, then easing back to rest. */
export function barY(t: number): number {
  if (t <= T_BAR_START) return 620;
  if (t < T_HIT) return lerp(620, BAR_HIT, easeInCubic(clamp01((t - T_BAR_START) / (T_HIT - T_BAR_START))));
  return lerp(BAR_HIT, BAR_REST, easeOutCubic(clamp01((t - T_HIT) / (T_BAR_BACK - T_HIT))));
}

const barWidth = (y: number) => laneRight(y) - laneLeft(y) + 36;
const barTransform = (y: number) => {
  const k = barWidth(y) / barWidth(BAR_REST);
  return `translate(400 ${y.toFixed(2)}) scale(${k.toFixed(4)}) translate(-400 -${BAR_REST})`;
};

interface PinFrame {
  x: number;
  y: number;
  rot: number;
  scale: number;
  /** 0 while standing, 1 once landed. */
  u: number;
}

/** One pin's position at time t. At t >= T_END this is exactly the finished logo. */
export function pinFrame(i: number, t: number): PinFrame {
  const f = LETTERS[i];
  const st = STAND[i];
  const s0 = standScale(st.y);
  const launch = T_HIT + (191 - st.y) * 0.012;
  const u = clamp01((t - launch) / FLIGHT);
  if (u <= 0) return { x: st.x, y: st.y, rot: 0, scale: s0, u: 0 };
  const e = easeOutCubic(u);
  const hump = 4 * u * (1 - u);
  const dir = i % 2 === 0 ? 1 : -1;
  const scale = lerp(s0, f.s, e) * (1 + 0.15 * hump);
  return {
    x: lerp(st.x, f.x, e),
    // the arc rises as far as the picture allows (the pin's head stays inside the frame), never lower than a straight line
    y: Math.max(lerp(st.y, f.y, e) - (110 + 20 * (i % 3)) * hump, Math.min(lerp(st.y, f.y, e), TOP + 100 * scale)),
    rot: f.rot * easeOutBack(u) + dir * 120 * Math.sin(Math.PI * u),
    scale,
    u,
  };
}

const pinTransform = (p: { x: number; y: number; rot: number; scale: number }) =>
  `translate(${p.x} ${p.y}) rotate(${p.rot}) scale(${p.scale}) translate(-20 -100)`;

export function SweeperIntro({ className, title = "Sweeper" }: { className?: string; title?: string }) {
  const wrap = useRef<HTMLButtonElement>(null);
  const bar = useRef<SVGGElement>(null);
  const dust = useRef<SVGCircleElement>(null);
  const pins = useRef<(SVGGElement | null)[]>([]);
  const shadows = useRef<(SVGEllipseElement | null)[]>([]);
  const raf = useRef(0);

  const apply = (t: number) => {
    const done = t >= T_END;
    bar.current?.setAttribute("transform", done ? "" : barTransform(barY(t)));
    LETTERS.forEach((_, i) => {
      const p = pinFrame(i, done ? T_END + 10 : t);
      pins.current[i]?.setAttribute("transform", pinTransform(p));
      shadows.current[i]?.setAttribute("opacity", String(SHADOW * (done ? 1 : clamp01((p.u - 0.35) / 0.65))));
    });
    const d = clamp01((t - T_HIT) / 0.7);
    dust.current?.setAttribute("r", String(lerp(10, 95, easeOutCubic(d))));
    dust.current?.setAttribute("opacity", String(t < T_HIT ? 0 : 0.55 * (1 - d)));
  };

  const play = () => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      apply(Math.min(t, T_END));
      if (t < T_END) raf.current = requestAnimationFrame(tick);
    };
    apply(0);
    raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* storage blocked: just play it */
    }
    if (reduce || seen) apply(T_END);
    else {
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* ignore */
      }
      play();
    }
    wrap.current?.setAttribute("data-ready", "1");
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const replay = () => {
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    play();
  };

  return (
    <button ref={wrap} type="button" onClick={replay} aria-label={`${title}. Activate to replay the animation.`} className={`sw-intro block rounded-xl ${className ?? ""}`}>
      <svg viewBox="0 20 800 508" className="block h-auto w-full" role="img" aria-hidden xmlns="http://www.w3.org/2000/svg">
        <SceneDefs />
        <PinDefs id="swl" />
        <LaneBackdrop />
        <g>
          <PinShadowsLive refs={shadows} />
        </g>
        {LETTERS.map((p, i) => (
          <g
            key={i}
            ref={(el) => {
              pins.current[i] = el;
            }}
            transform={pinTransform({ x: p.x, y: p.y, rot: p.rot, scale: p.s })}
            filter={p.s < 0.95 ? "url(#swl-dof)" : undefined}
          >
            <PinBody id="swl" ch={p.ch} />
          </g>
        ))}
        <circle ref={dust} cx={400} cy={186} r={10} fill="#fff" opacity={0} filter="url(#swl-soft)" />
        <g ref={bar}>
          <SweepBarAcross y={BAR_REST} />
        </g>
        <SceneVignette />
      </svg>
    </button>
  );
}

/** The static pin shadows, as individual ellipses so each can fade in as its pin lands. */
function PinShadowsLive({ refs }: { refs: React.MutableRefObject<(SVGEllipseElement | null)[]> }) {
  return (
    <g fill="#1a0f05" filter="url(#swl-shadow)">
      {LETTERS.map((p, i) => (
        <ellipse
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          cx={p.x + p.rot * 0.4}
          cy={p.y + 46 * p.s}
          rx={15 * p.s}
          ry={4.5 * p.s}
          opacity={SHADOW}
        />
      ))}
    </g>
  );
}
