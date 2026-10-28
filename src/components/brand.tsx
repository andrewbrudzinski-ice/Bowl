import React from "react";
type ReactElement = React.ReactElement;

/**
 * Sweeper's brand marks, drawn as SVG so they stay sharp at any size and follow the theme.
 *  - <SweeperLogo>  the full illustration: a sweep bar clearing seven pins that spell S-W-E-E-P-E-R as they scatter.
 *  - <SweeperMark>  the compact mark (bar + three pins, no letters) for headers, favicons and app icons.
 *  - <Wordmark>     the mark plus the name, for page headers.
 */

const IVORY = "#f3efe4";
const INK = "#0b1220";
const RED = "#e5484d";
const STEEL = "#8b97ab";
const ACCENT = "#38bdf8";

/** A bowling pin in a 40x100 box with its base centred on the bottom edge. */
const PIN_PATH = "M20 0 C27 0 31 5 31 11 C31 17 27 21 26.5 25 C25.5 32 36 43 36 63 C36 79 32 90 31 100 L9 100 C8 90 4 79 4 63 C4 43 14.5 32 13.5 25 C13 21 9 17 9 11 C9 5 13 0 20 0 Z";

interface PinProps {
  /** Letter on the belly; omit for a plain pin. */
  ch?: string;
  /** Where the base of the pin sits, its tilt in degrees, and its size. */
  x: number;
  y: number;
  rot?: number;
  scale?: number;
  fill?: string;
  stripe?: string;
  ink?: string;
  /** Tilt around the base (a pin knocked over) or around its middle (keeps a small mark inside its frame). */
  pivot?: "base" | "center";
}

function Pin({ ch, x, y, rot = 0, scale = 1, fill = IVORY, stripe = RED, ink = INK, pivot = "base" }: PinProps): ReactElement {
  return (
    <g transform={`translate(${x} ${y}) rotate(${rot}) scale(${scale}) translate(-20 ${pivot === "center" ? -50 : -100})`}>
      <path d={PIN_PATH} fill={fill} stroke="rgba(15,23,42,.35)" strokeWidth={1.2} />
      <path d="M14.6 22.5 C14.2 24.2 13.9 25 13.6 26 L26.4 26 C26.1 25 25.8 24.2 25.4 22.5 Z" fill={stripe} />
      <path d="M13 29.5 C12.4 31 11.6 32.4 10.6 34 L29.4 34 C28.4 32.4 27.6 31 27 29.5 Z" fill={stripe} />
      {ch ? (
        <text x={20} y={67} textAnchor="middle" fontSize={25} fontWeight={900} fill={ink} fontFamily="'Arial Black', Impact, system-ui, sans-serif">
          {ch}
        </text>
      ) : null}
    </g>
  );
}

/** Lane edge positions at a given y for the perspective scene (a lane narrowing from 760 wide at y=520 to 200 at y=150). */
const laneLeft = (y: number) => 300 - (280 * (y - 150)) / 370;
const laneRight = (y: number) => 500 + (280 * (y - 150)) / 370;

/** The sweeper bar seen from the bowler's end: a steel beam across the lane with an accent front edge, hanging from arms that rise toward the pinsetter. */
function SweepBarAcross({ y }: { y: number }): ReactElement {
  const l = laneLeft(y) - 18;
  const r = laneRight(y) + 18;
  return (
    <g>
      <defs>
        <linearGradient id="sweeper-bar" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e2e8f0" />
          <stop offset="0.45" stopColor="#94a3b8" />
          <stop offset="1" stopColor="#475569" />
        </linearGradient>
      </defs>
      {/* arms back up toward the pinsetter */}
      <g stroke="#64748b" strokeWidth={9} strokeLinecap="round">
        <path d={`M${l + 12} ${y + 8} L${l + 52} ${y - 96}`} />
        <path d={`M${r - 12} ${y + 8} L${r - 52} ${y - 96}`} />
      </g>
      {/* beam: top face, front face, accent edge */}
      <path d={`M${l + 10} ${y - 12} L${r - 10} ${y - 12} L${r} ${y} L${l} ${y} Z`} fill="#cbd5e1" />
      <rect x={l} y={y} width={r - l} height={26} rx={8} fill="url(#sweeper-bar)" stroke="rgba(2,6,23,.6)" strokeWidth={2} />
      <rect x={l + 12} y={y + 17} width={r - l - 24} height={5} rx={2.5} fill={ACCENT} />
      <g fill="#334155" stroke="#94a3b8" strokeWidth={2}>
        <circle cx={l + 12} cy={y + 13} r={7} />
        <circle cx={r - 12} cy={y + 13} r={7} />
      </g>
    </g>
  );
}

/** The seven pins of S-W-E-E-P-E-R, knocked every which way ahead of the bar: nearer ones larger, farther ones smaller. */
const LETTERS: { ch: string; x: number; y: number; rot: number; s: number }[] = [
  { ch: "S", x: 132, y: 292, rot: -32, s: 1.05 },
  { ch: "W", x: 252, y: 200, rot: 20, s: 0.9 },
  { ch: "E", x: 336, y: 290, rot: -10, s: 1.12 },
  { ch: "E", x: 428, y: 176, rot: 30, s: 0.86 },
  { ch: "P", x: 508, y: 288, rot: -22, s: 1.08 },
  { ch: "E", x: 596, y: 208, rot: 14, s: 0.9 },
  { ch: "R", x: 688, y: 292, rot: 34, s: 1.04 },
];

export function SweeperLogo({ className, title = "Sweeper" }: { className?: string; title?: string }): ReactElement {
  const boardTop = Array.from({ length: 9 }, (_, i) => 300 + ((i + 1) * 200) / 10);
  const boardBottom = Array.from({ length: 9 }, (_, i) => 20 + ((i + 1) * 760) / 10);
  const arrows = [0.2, 0.35, 0.5, 0.65, 0.8];
  return (
    <svg viewBox="0 20 800 508" className={className} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <defs>
        <linearGradient id="sweeper-wood" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e9c78a" />
          <stop offset="1" stopColor="#b9803f" />
        </linearGradient>
      </defs>
      {/* gutters, then the lane itself narrowing toward the pins */}
      <path d="M286 150 L514 150 L822 520 L-22 520 Z" fill="#0f172a" />
      <path d="M300 150 L500 150 L780 520 L20 520 Z" fill="url(#sweeper-wood)" />
      <g stroke="rgba(76,38,8,.28)" strokeWidth={1.4}>
        {boardTop.map((x, i) => (
          <path key={i} d={`M${x} 150 L${boardBottom[i]} 520`} />
        ))}
      </g>
      {/* arrows and the foul line */}
      <g fill="rgba(76,38,8,.5)">
        {arrows.map((t, i) => {
          const y = 410 + Math.abs(t - 0.5) * -30;
          const x = laneLeft(y) + (laneRight(y) - laneLeft(y)) * t;
          const w = 13 + (y - 150) * 0.03;
          return <path key={i} d={`M${x} ${y - w * 1.4} L${x + w} ${y + w * 0.4} L${x - w} ${y + w * 0.4} Z`} />;
        })}
      </g>
      <path d="M26 506 L774 506" stroke="rgba(76,38,8,.55)" strokeWidth={4} />
      {/* pin deck glow where the pins stood */}
      <ellipse cx={400} cy={178} rx={150} ry={22} fill="rgba(255,255,255,.18)" />
      {LETTERS.map((p, i) => (
        <Pin key={i} ch={p.ch} x={p.x} y={p.y} rot={p.rot} scale={p.s} />
      ))}
      <SweepBarAcross y={318} />
      <g fill={ACCENT} opacity={0.95}>
        <circle cx={196} cy={120} r={5} />
        <circle cx={300} cy={96} r={3.5} />
        <circle cx={380} cy={118} r={4} />
        <circle cx={470} cy={84} r={4.5} />
        <circle cx={560} cy={112} r={3.5} />
        <circle cx={650} cy={130} r={5} />
        <circle cx={724} cy={100} r={3.5} />
      </g>
    </svg>
  );
}

/** Compact mark: the lane in perspective, a sweep bar across it, and three pins knocked into the air. `tone` flips the palette for an accent background. */
export function SweeperMark({ size = 32, className, tone = "dark" }: { size?: number; className?: string; tone?: "dark" | "onAccent" }): ReactElement {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden xmlns="http://www.w3.org/2000/svg">
      <MarkArt onAccent={tone === "onAccent"} />
    </svg>
  );
}

/** Host elements only (no nested components), so it can also be drawn inside next/og image responses for the app icons. */
export function MarkArt({ onAccent }: { onAccent: boolean }): ReactElement {
  const stripe = onAccent ? INK : RED;
  const fill = onAccent ? "#f8fafc" : IVORY;
  return (
    <g>
      {/* the lane narrowing away from the viewer */}
      <path d="M25 20 L39 20 L62 62 L2 62 Z" fill={onAccent ? INK : "#334155"} />
      <path d="M26.5 20 L37.5 20 L56 56 L8 56 Z" fill={onAccent ? "#1e3a5f" : "#475569"} opacity={onAccent ? 0.55 : 0.9} />
      <path d="M32 20 L32 56 M29 20 L20 56 M35 20 L44 56" stroke={onAccent ? ACCENT : "#94a3b8"} strokeWidth={0.7} opacity={0.5} />
      {/* three pins knocked into the air, nearer ones larger */}
      {Pin({ pivot: "center", x: 17, y: 29, rot: -26, scale: 0.34, stripe, fill })}
      {Pin({ pivot: "center", x: 34, y: 19, rot: 8, scale: 0.26, stripe, fill })}
      {Pin({ pivot: "center", x: 49, y: 30, rot: 28, scale: 0.34, stripe, fill })}
      {/* the sweep bar across the lane */}
      <rect x={5} y={41} width={54} height={8} rx={3} fill={onAccent ? "#f8fafc" : "#cbd5e1"} />
      <rect x={5} y={46} width={54} height={3.2} rx={1.6} fill={ACCENT} />
      <rect x={5} y={41} width={54} height={8} rx={3} fill="none" stroke={onAccent ? INK : "#0f172a"} strokeWidth={1.2} />
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
