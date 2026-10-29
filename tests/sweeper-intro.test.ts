import { describe, expect, it } from "vitest";
import { LETTERS } from "../src/components/brand";
import { T_END, barY, pinFrame } from "../src/components/sweeper-intro";

const times = Array.from({ length: 2001 }, (_, k) => (k / 2000) * (T_END + 0.5));

describe("sweeper intro motion", () => {
  it("every pin ends exactly on its place in the finished logo", () => {
    LETTERS.forEach((l, i) => {
      const p = pinFrame(i, T_END);
      expect(p).toMatchObject({ x: l.x, y: l.y, rot: l.rot, scale: l.s });
    });
  });

  it("every pin travels one smooth way: x never reverses, height bends once, spin never reverses", () => {
    LETTERS.forEach((_, i) => {
      const f = times.map((t) => pinFrame(i, t));
      let ySign = 0;
      let yTurns = 0;
      for (let k = 1; k < f.length; k++) {
        const dx = f[k].x - f[k - 1].x;
        const dr = f[k].rot - f[k - 1].rot;
        const dy = f[k].y - f[k - 1].y;
        const towardX = Math.sign(LETTERS[i].x - f[0].x);
        if (f[k].u < 1) {
          expect(dx * towardX).toBeGreaterThanOrEqual(-1e-9);
          expect(dr * Math.sign(LETTERS[i].rot || 1)).toBeGreaterThanOrEqual(-1e-9); // spins the way the pin finally leans
        }
        if (Math.abs(dy) > 1e-9 && f[k].u < 1) {
          const s = Math.sign(dy);
          if (ySign && s !== ySign) yTurns++;
          ySign = s;
        }
      }
      expect(yTurns).toBeLessThanOrEqual(1); // up, then down: one apex
    });
  });

  it("pins stay inside the picture (viewBox top is y=20) while flying", () => {
    LETTERS.forEach((_, i) => {
      for (const t of times) {
        const p = pinFrame(i, t);
        expect(p.y - 100 * p.scale).toBeGreaterThan(20);
      }
    });
  });

  it("the bar charges up the lane, then eases back to rest without overshoot", () => {
    let prev = barY(0);
    let turns = 0;
    let dir = 0;
    for (const t of times) {
      const y = barY(t);
      const s = Math.sign(y - prev);
      if (s && dir && s !== dir) turns++;
      if (s) dir = s;
      prev = y;
    }
    expect(turns).toBe(1); // up the lane, then back
    expect(barY(T_END)).toBeCloseTo(322, 5);
  });
});
