// The layout of the view and the touch controls on the phone and tablet shapes we promise
// (src/game/touch/layout.ts): nothing overlaps, everything is on screen, targets are big enough.

import { describe, expect, it } from 'vitest';
import { CANVAS, computeLayout, controlsShown, fitScale, type Layout, PAD, type Rect } from '../../src/game/touch/layout';

const SHAPES: [string, number, number][] = [
  ['small phone, portrait', 360, 640],
  ['small phone, landscape', 640, 360],
  ['Pixel-class phone, portrait', 412, 839],
  ['Pixel-class phone, landscape', 863, 360],
  ['tablet, portrait', 768, 1024],
  ['tablet, landscape', 1024, 768],
];

const inside = (r: Rect, w: number, h: number) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const rects = (l: Layout): [string, Rect][] =>
  (
    [
      ['game', l.game],
      ['dpad', l.dpad],
      ['actions', l.actions],
      ['system', l.system],
    ] as [string, Rect | null][]
  ).filter((e): e is [string, Rect] => e[1] !== null);

describe('the layout of the view and the touch controls', () => {
  for (const [name, w, h] of SHAPES) {
    it(`${name} (${w} x ${h}): on screen, no overlaps, the canvas keeps its shape`, () => {
      const l = computeLayout(w, h, true);
      expect(l.mode).toBe(w > h ? 'landscape' : 'portrait');
      const all = rects(l);
      expect(all).toHaveLength(4);
      for (const [n, r] of all) expect(inside(r, w, h), `${n} ${JSON.stringify(r)}`).toBe(true);
      for (let i = 0; i < all.length; i++)
        for (let j = i + 1; j < all.length; j++) expect(overlap(all[i]![1], all[j]![1]), `${all[i]![0]} / ${all[j]![0]}`).toBe(false);
      expect(Math.abs(l.game.w / l.game.h - CANVAS.width / CANVAS.height)).toBeLessThan(0.02);
      // the view is at least as big as the canvas itself, so text stays readable
      expect(l.game.w).toBeGreaterThanOrEqual(CANVAS.width);
    });
  }

  it('portrait puts the view above the controls; landscape puts it between them', () => {
    const p = computeLayout(412, 839, true);
    expect(p.game.y + p.game.h).toBeLessThanOrEqual(p.system!.y);
    expect(p.game.y + p.game.h).toBeLessThanOrEqual(p.dpad!.y);
    const l = computeLayout(863, 360, true);
    expect(l.dpad!.x + l.dpad!.w).toBeLessThanOrEqual(l.game.x);
    expect(l.game.x + l.game.w).toBeLessThanOrEqual(l.actions!.x);
  });

  it('scales by a whole number from 2 up where that keeps most of the room, and fills the room otherwise', () => {
    expect(fitScale(1280, 800)).toEqual({ scale: 4, integer: true });
    expect(fitScale(480, 344)).toEqual({ scale: 2, integer: true });
    // a whole number that would lose more than a fifth of the room: the exact fit instead
    expect(fitScale(688, 1000)).toMatchObject({ integer: false });
    expect(fitScale(688, 1000).scale).toBeCloseTo(2.86, 1);
    const small = fitScale(344, 400);
    expect(small.integer).toBe(false);
    expect(small.scale).toBeCloseTo(344 / 240, 1);
    // a Pixel-class phone in landscape gets a sharp 2x view between the controls
    const l = computeLayout(863, 360, true);
    expect(l).toMatchObject({ scale: 2, integer: true, game: { w: 480, h: 344 } });
    // a desktop window without controls: 4x, centred
    const d = computeLayout(1280, 800, false);
    expect(d).toMatchObject({ mode: 'plain', scale: 4, integer: true, game: { x: 160, y: 56, w: 960, h: 688 }, dpad: null });
  });

  it('keeps out of the safe-area insets (notches, gesture bars)', () => {
    const l = computeLayout(412, 839, true, { top: 30, right: 0, bottom: 24, left: 0 });
    for (const [n, r] of rects(l)) {
      expect(r.y, n).toBeGreaterThanOrEqual(30);
      expect(r.y + r.h, n).toBeLessThanOrEqual(839 - 24);
    }
  });

  it('every touch target is at least 48 CSS px', () => {
    expect(Math.min(PAD.use, PAD.back, PAD.system, PAD.dpad / 3)).toBeGreaterThanOrEqual(48);
  });

  it('shows the controls on touch screens and narrow windows, unless the setting says otherwise', () => {
    expect(controlsShown('auto', true, 1280)).toBe(true);
    expect(controlsShown('auto', false, 1280)).toBe(false);
    expect(controlsShown('auto', false, 500)).toBe(true);
    expect(controlsShown('off', true, 360)).toBe(false);
    expect(controlsShown('on', false, 1920)).toBe(true);
  });
});
