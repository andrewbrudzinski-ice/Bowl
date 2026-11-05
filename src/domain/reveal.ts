import { seededRandom } from "./partners";

/**
 * The draw reveal: a bowling ball rolls down the lane, the pins fly, and each pairing and matchup is revealed one roll at a time.
 *
 * Everything here is a pure function of the drawn names and a clock, so the picture at any moment can be tested, replayed or
 * skipped to the end. The drawing itself lives in components/draw-reveal.tsx.
 */

/** One entry of a draw, as shown on screen. `extra`: `a` is compared with `b`'s scores. `b` null: `a` sits out. */
export interface DrawnShown {
  a: string;
  b: string | null;
  extra: boolean;
}

export type RevealPiece =
  | { kind: "pair"; match: number; side: "a" | "b"; name: string }
  | { kind: "extra"; name: string; against: string }
  | { kind: "sits"; name: string };

export interface RevealRoll {
  piece: RevealPiece;
  eyebrow: string;
  headline: string;
  sub: string | null;
}

/** The rolls that reveal a draw: both pairs of each match in turn, then the extra pair, then anyone sitting out. */
export function buildRolls(shown: DrawnShown[]): RevealRoll[] {
  const rolls: RevealRoll[] = [];
  const matches = shown.filter((m) => m.b && !m.extra);
  matches.forEach((m, i) => {
    rolls.push({ piece: { kind: "pair", match: i, side: "a", name: m.a }, eyebrow: `Match ${i + 1}`, headline: m.a, sub: null });
    rolls.push({ piece: { kind: "pair", match: i, side: "b", name: m.b! }, eyebrow: `Match ${i + 1}`, headline: m.b!, sub: `against ${m.a}` });
  });
  for (const m of shown.filter((x) => x.extra)) {
    rolls.push({ piece: { kind: "extra", name: m.a, against: m.b! }, eyebrow: "Extra pair", headline: m.a, sub: `compared with ${m.b}’s scores — only ${m.a} can earn points from it` });
  }
  for (const m of shown.filter((x) => !x.b)) {
    rolls.push({ piece: { kind: "sits", name: m.a }, eyebrow: "Sitting out", headline: m.a, sub: "not bowling this week" });
  }
  return rolls;
}

export interface BoardEntry {
  key: string;
  kind: "match" | "extra" | "sits";
  /** What has been revealed so far; null until its roll lands. */
  a: string | null;
  b: string | null;
}

/** The running list of results after the first `revealed` rolls. */
export function boardAt(rolls: RevealRoll[], revealed: number): BoardEntry[] {
  const out: BoardEntry[] = [];
  const entry = (key: string, kind: BoardEntry["kind"]) => {
    let e = out.find((x) => x.key === key);
    if (!e) out.push((e = { key, kind, a: null, b: null }));
    return e;
  };
  // Start every entry that will exist, so the list keeps its place as it fills in.
  for (const r of rolls) {
    const p = r.piece;
    if (p.kind === "pair") entry(`m${p.match}`, "match");
    else if (p.kind === "extra") entry("extra", "extra");
    else entry(`s:${p.name}`, "sits");
  }
  rolls.slice(0, revealed).forEach((r) => {
    const p = r.piece;
    if (p.kind === "pair") (entry(`m${p.match}`, "match")[p.side] = p.name);
    else if (p.kind === "extra") {
      const e = entry("extra", "extra");
      e.a = p.name;
      e.b = p.against;
    } else entry(`s:${p.name}`, "sits").a = p.name;
  });
  return out.filter((e) => e.a !== null || e.b !== null);
}

// ---------------------------------------------------------------------------------------------------------------------
// The picture: an SVG 360 wide and 520 tall, looking down the lane from the bowler's end toward the pins.

export const VIEW = { w: 360, h: 520 };
export const CENTER = 180;
export const LANE = { topY: 58, bottomY: 520, topHalf: 30, bottomHalf: 112 };
/** Half the lane's width at height y (it narrows with distance). */
export const laneHalf = (y: number) => LANE.topHalf + ((y - LANE.topY) / (LANE.bottomY - LANE.topY)) * (LANE.bottomHalf - LANE.topHalf);

/** The ten pins, back row first, as where each stands (base of the pin) and how big it is drawn. */
export const PIN_SPOTS: { x: number; y: number; scale: number }[] = (() => {
  const rows = [
    { y: 92, xs: [-22.5, -7.5, 7.5, 22.5] },
    { y: 102, xs: [-15, 0, 15] },
    { y: 112, xs: [-7.5, 7.5] },
    { y: 122, xs: [0] },
  ];
  return rows.flatMap((r) => r.xs.map((dx) => ({ x: CENTER + dx, y: r.y, scale: 0.3 + (r.y - 92) * 0.004 })));
})();

/** Seconds per roll, and when things happen inside a roll. */
export const ROLL = 2.5;
export const T_HIT = 1.5;
const T_FLY_END = 2.05;
const T_RESET = 2.2;
const T_CARD_IN = T_HIT + 0.05;
const FADE_OUT = 0.35;
/** Held after the last roll so the finished board can be read. */
export const TAIL = 1.2;

export const totalTime = (rolls: RevealRoll[]) => rolls.length * ROLL + TAIL;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (t: number) => t * t * (3 - 2 * t);
const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export interface RevealFrame {
  /** Which roll is under way (the last one during the tail). */
  roll: number;
  /** How many rolls have revealed their pairing so far. */
  revealed: number;
  ball: { x: number; y: number; scale: number; spin: number; opacity: number };
  pins: { x: number; y: number; scale: number; rot: number; opacity: number }[];
  /** 0–1 bright flash at the moment of impact, and how hard the picture shakes (also 0–1). */
  flash: number;
  shake: number;
  /** The headline card for the roll just landed: 0 hidden … 1 fully shown. */
  card: { roll: number; opacity: number; lift: number } | null;
  done: boolean;
}

/** Where the ball starts across the lane for roll `k`, from a few spots so it isn't the same roll every time. */
function startOffset(k: number): number {
  const spots = [-62, 48, -24, 70, -48, 20, 58, -70];
  return spots[k % spots.length] * (k % 2 === 0 ? 1 : -1) * 0.9;
}

/** What the picture looks like `time` seconds in. Pure: the same inputs always give the same frame. */
export function frameAt(rolls: RevealRoll[], time: number): RevealFrame {
  const n = rolls.length;
  const end = totalTime(rolls);
  const t = Math.min(Math.max(time, 0), end);
  const roll = n ? Math.min(n - 1, Math.floor(t / ROLL)) : 0;
  const local = n && t < n * ROLL ? t - roll * ROLL : n ? ROLL : 0;
  const finished = t >= n * ROLL;
  const landed = n === 0 ? 0 : finished ? n : roll + (local >= T_CARD_IN ? 1 : 0);
  const rolling = n > 0 && !finished && local < T_HIT + 0.3;

  // The ball: down the lane toward the pocket, smaller as it goes, then into the pit behind the pins.
  const u = clamp01(local / T_HIT);
  const pocket = (roll % 2 === 0 ? -1 : 1) * 4;
  const ballX = lerp(CENTER + startOffset(roll), CENTER + pocket, smooth(u));
  const ballY = lerp(LANE.bottomY - 14, 124, Math.pow(u, 0.88));
  const ballScale = 1 / (1 + 3.6 * u);
  const intoPit = clamp01((local - T_HIT) / 0.3);
  const ball = {
    x: ballX,
    y: lerp(ballY, 84, intoPit),
    scale: lerp(ballScale, ballScale * 0.7, intoPit),
    spin: u * Math.PI * 2 * 5,
    opacity: !rolling ? 0 : 1 - intoPit,
  };

  // The pins: standing until impact, thrown back and aside with a different tumble each roll, then standing again for the next roll.
  const rand = seededRandom(1009 * (roll + 1));
  const pins = PIN_SPOTS.map((spot, i) => {
    const dx = (rand() - 0.5) * 150;
    const dy = -(24 + rand() * 70);
    const rot = (rand() < 0.5 ? -1 : 1) * (120 + rand() * 260);
    if (finished || local < T_HIT) return { ...spot, rot: 0, opacity: 1 };
    const delay = (PIN_SPOTS.length - 1 - i) * 0.012; // the front pin goes first
    const f = clamp01((local - T_HIT - delay) / (T_FLY_END - T_HIT));
    if (local < T_RESET) {
      const e = easeOut(f);
      return { x: spot.x + dx * e, y: spot.y + dy * e + 90 * f * f * 0.4, scale: spot.scale * (1 - 0.15 * e), rot: rot * e, opacity: 1 - clamp01((f - 0.55) / 0.45) };
    }
    return { ...spot, rot: 0, opacity: clamp01((local - T_RESET) / (ROLL - T_RESET)) };
  });

  const sinceHit = local - T_HIT;
  const hit = !finished && sinceHit >= 0;
  const flash = hit ? clamp01(1 - sinceHit / 0.35) : 0;
  const shake = hit ? clamp01(1 - sinceHit / 0.45) : 0;

  let card: RevealFrame["card"] = null;
  if (n && !finished && local >= T_CARD_IN) {
    const inP = clamp01((local - T_CARD_IN) / 0.3);
    const outP = clamp01((ROLL - local) / FADE_OUT);
    card = { roll, opacity: Math.min(inP, outP), lift: 1 - easeOut(inP) };
  }

  return { roll, revealed: landed, ball, pins, flash, shake, card, done: t >= end };
}
