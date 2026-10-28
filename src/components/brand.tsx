import React from "react";
type ReactElement = React.ReactElement;

/**
 * Sweeper's brand marks, drawn as SVG so they stay sharp at any size and follow the theme.
 *  - <SweeperLogo>  the full illustration: a sweep bar clearing seven pins that spell S-W-E-E-P-E-R as they scatter.
 *  - <SweeperMark>  the compact mark (bar + three pins, no letters) for headers, favicons and app icons.
 *  - <Wordmark>     the mark plus the name, for page headers.
 */

const IVORY = "#f7f3e9";
const INK = "#0d1422";
const RED = "#c8323a";
const ACCENT = "#38bdf8";

/**
 * A regulation pin's profile (15" tall, 4.75" at the belly, 2.5" head) in a 40x100 box, base centred on the bottom edge.
 * Half-widths by depth from the top; turned into a smooth closed path (Catmull-Rom through the points, mirrored).
 */
const PROFILE: [number, number][] = [
  [0, 0], [2, 4.6], [5, 7.5], [10.7, 8.3], [16, 7.3], [20.5, 6.4], [26.7, 6.0], [33, 7.8], [42, 11.7], [52, 14.4], [62, 15.6], [70, 15.8], [80, 14.7], [90, 11.7], [97, 9.7], [100, 9.3],
];
function smooth(points: [number, number][]): string {
  let d = "";
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d;
}
const rightSide = PROFILE.map(([y, w]): [number, number] => [20 + w, y]);
const leftSide = PROFILE.map(([y, w]): [number, number] => [20 - w, y]).reverse();
const PIN_PATH = `M20 0${smooth(rightSide)} L${leftSide[0][0].toFixed(2)} 100${smooth(leftSide)} Z`;

/** Gradients and the pin clip shared by every pin in one svg. `id` keeps ids unique when several svgs share a page. */
export function PinDefs({ id }: { id: string }): ReactElement {
  return (
    <defs>
      <clipPath id={`${id}-pin`}>
        <path d={PIN_PATH} />
      </clipPath>
      {/* cylindrical shading: soft shadow left, a specular streak, deep shadow right */}
      <linearGradient id={`${id}-pinshade`} x1="0" x2="1" y1="0" y2="0">
        <stop offset="0" stopColor="#000" stopOpacity={0.22} />
        <stop offset="0.2" stopColor="#000" stopOpacity={0.03} />
        <stop offset="0.34" stopColor="#fff" stopOpacity={0.45} />
        <stop offset="0.46" stopColor="#fff" stopOpacity={0.04} />
        <stop offset="0.8" stopColor="#000" stopOpacity={0.12} />
        <stop offset="1" stopColor="#000" stopOpacity={0.34} />
      </linearGradient>
    </defs>
  );
}

interface PinProps {
  /** Letter printed on the belly; omit for a plain pin. */
  ch?: string;
  /** Where the pin sits, its tilt in degrees and its size. */
  x: number;
  y: number;
  rot?: number;
  scale?: number;
  fill?: string;
  stripe?: string;
  ink?: string;
  /** Tilt around the base (a pin knocked over) or around its middle (keeps a small mark inside its frame). */
  pivot?: "base" | "center";
  /** Must match the PinDefs id in the same svg. */
  id: string;
  /** Soften far pins slightly, like depth of field. */
  blur?: string;
}

/** The pin artwork in its own 40x100 box with no transform, so an animation can move it. */
export function PinBody({ ch, fill = IVORY, stripe = RED, ink = INK, id }: Pick<PinProps, "ch" | "fill" | "stripe" | "ink" | "id">): ReactElement {
  return (
    <g>
      <g clipPath={`url(#${id}-pin)`}>
        <rect x={0} y={0} width={40} height={100} fill={fill} />
        <rect x={0} y={27} width={40} height={3.6} fill={stripe} />
        <rect x={0} y={33.2} width={40} height={3.6} fill={stripe} />
        {ch ? (
          <text x={20} y={66} textAnchor="middle" fontSize={24} fontWeight={800} fill={ink} fillOpacity={0.97} fontFamily="'Helvetica Neue', Arial, system-ui, sans-serif" letterSpacing={0.5}>
            {ch}
          </text>
        ) : null}
        <rect x={0} y={0} width={40} height={100} fill={`url(#${id}-pinshade)`} />
      </g>
      <path d={PIN_PATH} fill="none" stroke="rgba(15,23,42,.28)" strokeWidth={0.9} />
    </g>
  );
}

function Pin({ x, y, rot = 0, scale = 1, pivot = "base", blur, ...art }: PinProps): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale}) translate(-20 ${pivot === "center" ? -50 : -100})`} filter={blur}>
      {/* called, not rendered as <PinBody/>: Pin is also used inside next/og icons, which only accept host elements */}
      {PinBody(art)}
    </g>
  );
}

/** Lane edge positions at a given y for the perspective scene (a lane narrowing from 760 wide at y=520 to 200 at y=150). */
export const laneLeft = (y: number) => 300 - (280 * (y - 150)) / 370;
export const laneRight = (y: number) => 500 + (280 * (y - 150)) / 370;
const LANE = "M300 150 L500 150 L780 520 L20 520 Z";

/** The seven pins of S-W-E-E-P-E-R, knocked every which way ahead of the bar: nearer ones larger and sharper, farther ones smaller and softer. */
export const LETTERS: { ch: string; x: number; y: number; rot: number; s: number }[] = [
  { ch: "S", x: 128, y: 296, rot: -34, s: 1.1 },
  { ch: "W", x: 250, y: 204, rot: 22, s: 0.92 },
  { ch: "E", x: 338, y: 292, rot: -9, s: 1.16 },
  { ch: "E", x: 430, y: 178, rot: 31, s: 0.86 },
  { ch: "P", x: 512, y: 290, rot: -23, s: 1.12 },
  { ch: "E", x: 600, y: 210, rot: 15, s: 0.92 },
  { ch: "R", x: 696, y: 296, rot: 35, s: 1.08 },
];

/** The sweeper bar from the bowler's end: a brushed-chrome beam across the lane on two struts, throwing a soft shadow onto the boards. */
export function SweepBarAcross({ y }: { y: number }): ReactElement {
  const l = laneLeft(y) - 18;
  const r = laneRight(y) + 18;
  return (
    <g>
      <ellipse cx={400} cy={y + 40} rx={(r - l) / 2 + 6} ry={13} fill="#1a0f05" opacity={0.42} filter="url(#swl-soft)" />
      {/* struts back up toward the pinsetter */}
      {[l, r].map((x, i) => {
        const dir = i === 0 ? 1 : -1;
        return (
          <g key={i}>
            <path d={`M${x + 8 * dir - 6} ${y + 6} L${x + 8 * dir + 6} ${y + 6} L${x + 58 * dir + 3} ${y - 104} L${x + 58 * dir - 3} ${y - 104} Z`} fill="url(#swl-strut)" />
            <path d={`M${x + 8 * dir - 2} ${y + 6} L${x + 58 * dir - 1} ${y - 104}`} stroke="rgba(255,255,255,.35)" strokeWidth={1.2} />
          </g>
        );
      })}
      {/* beam: lit top face, then the chrome front */}
      <path d={`M${l + 10} ${y - 11} L${r - 10} ${y - 11} L${r} ${y} L${l} ${y} Z`} fill="url(#swl-bartop)" />
      <rect x={l} y={y} width={r - l} height={28} rx={9} fill="url(#swl-chrome)" />
      <rect x={l} y={y} width={r - l} height={28} rx={9} fill="none" stroke="rgba(8,12,22,.7)" strokeWidth={1.4} />
      <path d={`M${l + 14} ${y + 21} L${r - 14} ${y + 21}`} stroke="rgba(125,211,252,.7)" strokeWidth={1.6} strokeLinecap="round" />
      {[l + 14, r - 14].map((x, i) => (
        <circle key={i} cx={x} cy={y + 14} r={6.5} fill="url(#swl-cap)" stroke="rgba(8,12,22,.7)" strokeWidth={1.2} />
      ))}
    </g>
  );
}

export function SceneDefs(): ReactElement {
  return (
    <defs>
        <linearGradient id="swl-wood" x1="0" x2="0" y1="150" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e6c389" />
          <stop offset="0.4" stopColor="#cf9b5a" />
          <stop offset="1" stopColor="#8d5a2a" />
        </linearGradient>
        <linearGradient id="swl-sheen-v" x1="0" x2="0" y1="150" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity={0.42} />
          <stop offset="0.35" stopColor="#fff" stopOpacity={0.08} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.0} />
        </linearGradient>
        <linearGradient id="swl-sheen-h" x1="20" x2="780" y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity={0} />
          <stop offset="0.5" stopColor="#fff" stopOpacity={0.2} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </linearGradient>
        <linearGradient id="swl-gutter" x1="0" x2="0" y1="150" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1b2436" />
          <stop offset="1" stopColor="#070b14" />
        </linearGradient>
        <radialGradient id="swl-vignette" cx="400" cy="310" r="470" gradientUnits="userSpaceOnUse">
          <stop offset="0.55" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.55} />
        </radialGradient>
        <linearGradient id="swl-chrome" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f7fb" />
          <stop offset="0.18" stopColor="#c9d2de" />
          <stop offset="0.48" stopColor="#7d899b" />
          <stop offset="0.52" stopColor="#566173" />
          <stop offset="0.8" stopColor="#2f3848" />
          <stop offset="1" stopColor="#1b222f" />
        </linearGradient>
        <linearGradient id="swl-bartop" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#b8c2d0" />
        </linearGradient>
        <linearGradient id="swl-strut" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#8794a8" />
          <stop offset="0.5" stopColor="#3b4557" />
          <stop offset="1" stopColor="#1e2532" />
        </linearGradient>
        <radialGradient id="swl-cap" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="1" stopColor="#3b4557" />
        </radialGradient>
        <filter id="swl-soft" x="-20%" y="-80%" width="140%" height="260%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="swl-dof" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
        <filter id="swl-shadow" x="-60%" y="-200%" width="220%" height="500%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
        <linearGradient id="swl-fadegrad" x1="0" x2="0" y1="150" y2="520" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" />
          <stop offset="0.74" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </linearGradient>
        <mask id="swl-fade" maskUnits="userSpaceOnUse" x="-60" y="140" width="920" height="390">
          <rect x={-60} y={140} width={920} height={390} fill="url(#swl-fadegrad)" />
        </mask>
        <clipPath id="swl-lanes">
          <path d="M270 150 L530 150 L840 520 L-40 520 Z" />
        </clipPath>
    </defs>
  );
}

/** Gutters, the glossy lane, the pin-deck spots, arrows, foul line and sheen; the near end fades into the page. */
export function LaneBackdrop(): ReactElement {
  const boards = Array.from({ length: 38 }, (_, i) => ({ top: 300 + ((i + 1) * 200) / 39, bottom: 20 + ((i + 1) * 760) / 39, a: 0.07 + ((i * 7) % 5) * 0.028 }));
  const arrows = [0.18, 0.34, 0.5, 0.66, 0.82];
  const deck: [number, number][] = [[-87, 154], [-29, 154], [29, 154], [87, 154], [-58, 164], [0, 164], [58, 164], [-29, 174], [29, 174], [0, 184]];
  return (
    <g>
      {/* gutters, then the glossy lane; the near end fades into the page */}
      <g mask="url(#swl-fade)">
      <path d="M286 150 L514 150 L822 520 L-22 520 Z" fill="url(#swl-gutter)" />
      <path d={LANE} fill="url(#swl-wood)" />
      <g stroke="#3d1f08" strokeWidth={1}>
        {boards.map((b, i) => (
          <path key={i} d={`M${b.top.toFixed(1)} 150 L${b.bottom.toFixed(1)} 520`} opacity={b.a} />
        ))}
      </g>
      {/* the spots where the ten pins stood, inlaid arrows, the foul line and approach dots */}
      <g fill="#2a1405" opacity={0.5}>
        {deck.map(([dx, dy], i) => (
          <ellipse key={i} cx={400 + dx} cy={dy} rx={4.2} ry={1.5} />
        ))}
      </g>
      <g>
        {arrows.map((t, i) => {
          const y = 420 - Math.abs(t - 0.5) * 36;
          const x = laneLeft(y) + (laneRight(y) - laneLeft(y)) * t;
          const w = 12 + (y - 150) * 0.032;
          return <path key={i} d={`M${x} ${y - w * 1.6} L${x + w} ${y + w * 0.5} L${x - w} ${y + w * 0.5} Z`} fill="#5b3414" opacity={0.62} stroke="rgba(255,255,255,.18)" strokeWidth={0.8} />;
        })}
      </g>
      <path d="M24 505 L776 505" stroke="#3d1f08" strokeWidth={3} opacity={0.55} />
      <g fill="#3d1f08" opacity={0.4}>
        {Array.from({ length: 7 }, (_, i) => (
          <circle key={i} cx={laneLeft(484) + ((laneRight(484) - laneLeft(484)) * (i + 1)) / 8} cy={484} r={2.4} />
        ))}
      </g>
      <path d={LANE} fill="url(#swl-sheen-v)" />
      <path d={LANE} fill="url(#swl-sheen-h)" />
      <ellipse cx={400} cy={176} rx={140} ry={20} fill="#fff" opacity={0.14} filter="url(#swl-soft)" />
      </g>
    </g>
  );
}

/** Soft shadows of the airborne pins on the boards. */
export function PinShadows(): ReactElement {
  return (
    <g>
      {/* soft shadows of the airborne pins on the boards */}
      <g fill="#1a0f05" opacity={0.3} filter="url(#swl-shadow)">
        {LETTERS.map((p, i) => (
          <ellipse key={i} cx={p.x + p.rot * 0.4} cy={p.y + 46 * p.s} rx={15 * p.s} ry={4.5 * p.s} />
        ))}
      </g>
    </g>
  );
}

export function SceneVignette(): ReactElement {
  return (
    <g>
      <g mask="url(#swl-fade)">
        <rect x={-40} y={150} width={880} height={370} fill="url(#swl-vignette)" clipPath="url(#swl-lanes)" />
      </g>
    </g>
  );
}

export function SweeperLogo({ className, title = "Sweeper" }: { className?: string; title?: string }): ReactElement {
  return (
    <svg viewBox="0 20 800 508" className={className} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <SceneDefs />
      <PinDefs id="swl" />
      <LaneBackdrop />
      <PinShadows />
      {LETTERS.map((p, i) => (
        <Pin key={i} id="swl" ch={p.ch} x={p.x} y={p.y} rot={p.rot} scale={p.s} blur={p.s < 0.95 ? "url(#swl-dof)" : undefined} />
      ))}
      <SweepBarAcross y={322} />
      <SceneVignette />
    </svg>
  );
}

/** Compact mark: the lane in perspective, a chrome sweep bar across it, and three pins knocked into the air. `tone` flips the palette for an accent background. */
export function SweeperMark({ size = 32, className, tone = "dark" }: { size?: number; className?: string; tone?: "dark" | "onAccent" }): ReactElement {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden xmlns="http://www.w3.org/2000/svg">
      <MarkArt onAccent={tone === "onAccent"} />
    </svg>
  );
}

/** Host elements only (no nested components), so it can also be drawn inside next/og image responses for the app icons. */
export function MarkArt({ onAccent }: { onAccent: boolean }): ReactElement {
  const fill = onAccent ? "#f8f6ef" : IVORY;
  return (
    <g>
      <defs>
        <linearGradient id="swm-lane" x1="0" x2="0" y1="20" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={onAccent ? "#2a5b87" : "#e0b574"} />
          <stop offset="1" stopColor={onAccent ? "#0b2037" : "#8d5a2a"} />
        </linearGradient>
        <linearGradient id="swm-chrome" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f7fb" />
          <stop offset="0.35" stopColor="#c0cad8" />
          <stop offset="0.55" stopColor="#6b778a" />
          <stop offset="1" stopColor="#262e3c" />
        </linearGradient>
      </defs>
      {PinDefs({ id: "swm" })}
      {/* the lane narrowing away from the viewer */}
      <path d="M25 20 L39 20 L62 62 L2 62 Z" fill={onAccent ? "#071626" : "#0f172a"} />
      <path d="M26.2 20 L37.8 20 L57 58 L7 58 Z" fill="url(#swm-lane)" />
      <path d="M32 20 L32 58 M29.4 20 L21 58 M34.6 20 L43 58" stroke="#000" strokeWidth={0.5} opacity={0.22} />
      {/* three pins knocked into the air, nearer ones larger */}
      {Pin({ id: "swm", pivot: "center", x: 17, y: 29, rot: -26, scale: 0.34, fill })}
      {Pin({ id: "swm", pivot: "center", x: 34, y: 19, rot: 8, scale: 0.26, fill })}
      {Pin({ id: "swm", pivot: "center", x: 49, y: 30, rot: 28, scale: 0.34, fill })}
      {/* the chrome sweep bar across the lane */}
      <rect x={5} y={41.5} width={54} height={8.5} rx={3.2} fill="url(#swm-chrome)" stroke="#0b1020" strokeWidth={0.9} />
      <path d="M8 47.4 L56 47.4" stroke="#7dd3fc" strokeWidth={0.8} strokeLinecap="round" opacity={0.85} />
    </g>
  );
}

export function Wordmark({ className = "", size = 30 }: { className?: string; size?: number }): ReactElement {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <SweeperMark size={size} />
      <span className="font-black tracking-tight">Sweeper</span>
    </span>
  );
}
