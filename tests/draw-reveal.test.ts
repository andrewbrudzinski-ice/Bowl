import { describe, expect, it } from "vitest";
import { LANE, PIN_SPOTS, ROLL, T_HIT, TAIL, boardAt, buildRolls, frameAt, totalTime, type DrawnShown } from "../src/domain/reveal";

const tenBowlers: DrawnShown[] = [
  { a: "Alex & Sam", b: "Jordan & Taylor", extra: false },
  { a: "Casey & Riley", b: "Jamie & Morgan", extra: false },
  { a: "Quinn & Avery", b: "Casey & Riley", extra: true },
];
const elevenBowlers: DrawnShown[] = [...tenBowlers, { a: "Drew", b: null, extra: false }];
const twelveBowlers: DrawnShown[] = [...tenBowlers.slice(0, 2), { a: "Quinn & Avery", b: "Drew & Harper", extra: false }];

const clock = (rolls: ReturnType<typeof buildRolls>, step = 0.02) => Array.from({ length: Math.ceil(totalTime(rolls) / step) + 1 }, (_, k) => k * step);

describe("draw reveal script", () => {
  it("reveals both pairs of each match, then the extra pair, then anyone sitting out", () => {
    const rolls = buildRolls(elevenBowlers);
    expect(rolls.map((r) => r.piece.kind)).toEqual(["pair", "pair", "pair", "pair", "extra", "sits"]);
    expect(rolls.map((r) => r.headline)).toEqual(["Alex & Sam", "Jordan & Taylor", "Casey & Riley", "Jamie & Morgan", "Quinn & Avery", "Drew"]);
    expect(rolls[1].sub).toBe("against Alex & Sam");
    expect(rolls[4].sub).toMatch(/compared with Casey & Riley’s scores/);
    expect(rolls[4].sub).toMatch(/only Quinn & Avery can earn points/);
  });

  it("needs five rolls for ten bowlers and six for twelve", () => {
    expect(buildRolls(tenBowlers)).toHaveLength(5);
    expect(buildRolls(twelveBowlers)).toHaveLength(6);
    expect(buildRolls([{ a: "A & B", b: "C & D", extra: false }])).toHaveLength(2);
  });

  it("fills the board in as the rolls land, keeping each match in its place", () => {
    const rolls = buildRolls(tenBowlers);
    expect(boardAt(rolls, 0)).toEqual([]);
    expect(boardAt(rolls, 1)).toEqual([{ key: "m0", kind: "match", a: "Alex & Sam", b: null }]);
    expect(boardAt(rolls, 2)[0]).toMatchObject({ a: "Alex & Sam", b: "Jordan & Taylor" });
    expect(boardAt(rolls, 3).map((e) => e.key)).toEqual(["m0", "m1"]);
    const full = boardAt(rolls, rolls.length);
    expect(full.map((e) => e.kind)).toEqual(["match", "match", "extra"]);
    expect(full[2]).toMatchObject({ a: "Quinn & Avery", b: "Casey & Riley" });
  });
});

describe("draw reveal motion", () => {
  const rolls = buildRolls(tenBowlers);
  const times = clock(rolls);

  it("is the same picture for the same moment", () => {
    for (const t of [0, 0.7, 1.6, 2.3, 7.7, 100]) expect(JSON.stringify(frameAt(rolls, t))).toBe(JSON.stringify(frameAt(rolls, t)));
  });

  it("never produces a number that isn't one", () => {
    for (const t of times) {
      const f = frameAt(rolls, t);
      const nums = [f.flash, f.shake, f.ball.x, f.ball.y, f.ball.scale, f.ball.spin, f.ball.opacity, ...f.pins.flatMap((p) => [p.x, p.y, p.scale, p.rot, p.opacity])];
      expect(nums.every((n) => Number.isFinite(n))).toBe(true);
    }
  });

  it("reveals each roll once, in order, and finishes with everything shown", () => {
    let last = 0;
    for (const t of times) {
      const f = frameAt(rolls, t);
      expect(f.revealed).toBeGreaterThanOrEqual(last);
      expect(f.revealed - last).toBeLessThanOrEqual(1);
      last = f.revealed;
    }
    const end = frameAt(rolls, totalTime(rolls));
    expect([end.revealed, end.done]).toEqual([rolls.length, true]);
    expect(frameAt(rolls, 0).done).toBe(false);
    expect(frameAt(rolls, totalTime(rolls) + 50).revealed).toBe(rolls.length);
    expect(totalTime(rolls)).toBe(rolls.length * ROLL + TAIL);
  });

  it("rolls the ball down the lane: it only gets farther and smaller until it hits", () => {
    for (let k = 0; k < rolls.length; k++) {
      const seg = Array.from({ length: 60 }, (_, i) => frameAt(rolls, k * ROLL + (i / 59) * T_HIT).ball);
      for (let i = 1; i < seg.length; i++) {
        expect(seg[i].y).toBeLessThanOrEqual(seg[i - 1].y + 1e-9);
        expect(seg[i].scale).toBeLessThanOrEqual(seg[i - 1].scale + 1e-9);
        expect(seg[i].spin).toBeGreaterThanOrEqual(seg[i - 1].spin);
      }
      expect(seg[0].y).toBeGreaterThan(LANE.bottomY - 40);
      expect(seg[seg.length - 1].y).toBeLessThan(140);
      expect(seg.every((b) => b.opacity > 0.99)).toBe(true);
    }
  });

  it("keeps the ball on the lane", () => {
    const half = (y: number) => LANE.topHalf + ((y - LANE.topY) / (LANE.bottomY - LANE.topY)) * (LANE.bottomHalf - LANE.topHalf);
    for (const t of times) {
      const b = frameAt(rolls, t).ball;
      if (b.opacity === 0) continue;
      expect(Math.abs(b.x - 180)).toBeLessThanOrEqual(half(b.y));
    }
  });

  it("leaves the pins standing until the ball arrives, and standing again for the next roll", () => {
    for (let k = 0; k < rolls.length; k++) {
      for (const local of [0, 0.5, T_HIT - 0.01]) {
        const pins = frameAt(rolls, k * ROLL + local).pins;
        pins.forEach((p, i) => expect(p).toMatchObject({ x: PIN_SPOTS[i].x, y: PIN_SPOTS[i].y, rot: 0, opacity: 1 }));
      }
      const mid = frameAt(rolls, k * ROLL + T_HIT + 0.3).pins;
      expect(mid.some((p, i) => Math.abs(p.x - PIN_SPOTS[i].x) > 5)).toBe(true);
      expect(mid.some((p) => Math.abs(p.rot) > 10)).toBe(true);
      const back = frameAt(rolls, (k + 1) * ROLL - 0.001);
      if (k < rolls.length - 1) back.pins.forEach((p, i) => expect(p).toMatchObject({ x: PIN_SPOTS[i].x, y: PIN_SPOTS[i].y, opacity: expect.closeTo(1, 1) }));
    }
  });

  it("flashes and shakes only at impact", () => {
    for (let k = 0; k < rolls.length; k++) {
      expect(frameAt(rolls, k * ROLL + T_HIT - 0.01)).toMatchObject({ flash: 0, shake: 0 });
      expect(frameAt(rolls, k * ROLL + T_HIT + 0.05).flash).toBeGreaterThan(0.5);
      expect(frameAt(rolls, k * ROLL + T_HIT + 0.6).flash).toBe(0);
    }
  });

  it("shows a card only once the pins have gone down, and fades it before the next roll", () => {
    for (let k = 0; k < rolls.length; k++) {
      expect(frameAt(rolls, k * ROLL + 0.2).card).toBeNull();
      expect(frameAt(rolls, k * ROLL + T_HIT - 0.01).card).toBeNull();
      const shown = frameAt(rolls, k * ROLL + T_HIT + 0.6).card!;
      expect(shown).toMatchObject({ roll: k, opacity: 1 });
      expect(frameAt(rolls, (k + 1) * ROLL - 0.02).card!.opacity).toBeLessThan(0.2);
    }
    expect(frameAt(rolls, totalTime(rolls)).card).toBeNull();
  });

  it("copes with a draw of nothing", () => {
    const none = buildRolls([]);
    expect(none).toEqual([]);
    expect(frameAt(none, 0)).toMatchObject({ revealed: 0, done: false });
    expect(frameAt(none, 5).done).toBe(true);
  });
});
