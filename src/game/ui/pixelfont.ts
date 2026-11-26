// Turns the pixel font (font.ts) into Phaser bitmap fonts, one texture per colour, drawn at
// run time from the glyph data: nothing is loaded. Fonts are game-wide; each colour is made
// once, on first use.

import Phaser from 'phaser';
import { FONT, GLYPHS, sanitize } from './font';

const CELL_W = Math.max(...[...GLYPHS.values()].map((g) => g.width)) + FONT.spacing;
const CELL_H = FONT.lineHeight;
const PER_ROW = 16;

export function pixelFont(scene: Phaser.Scene, color: string): string {
  const key = `nines-px-${color.replace('#', '')}`;
  if (scene.cache.bitmapFont.exists(key)) return key;
  const glyphs = [...GLYPHS.values()];
  const texW = CELL_W * PER_ROW;
  const texH = CELL_H * Math.ceil(glyphs.length / PER_ROW);
  const tex = scene.textures.createCanvas(key, texW, texH);
  if (!tex) throw new Error(`cannot create the font texture ${key}`);
  const ctx = tex.getContext();
  ctx.fillStyle = color;
  const chars: Record<number, unknown> = {};
  glyphs.forEach((g, i) => {
    const x = (i % PER_ROW) * CELL_W;
    const y = Math.floor(i / PER_ROW) * CELL_H;
    g.pixels.forEach((row, r) => row.forEach((on, c) => on && ctx.fillRect(x + c, y + FONT.top + r, 1, 1)));
    chars[g.ch.codePointAt(0)!] = {
      x,
      y,
      width: g.width,
      height: CELL_H,
      centerX: Math.floor(g.width / 2),
      centerY: Math.floor(CELL_H / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: g.width + FONT.spacing,
      data: {},
      kerning: {},
      u0: x / texW,
      v0: y / texH,
      u1: (x + g.width) / texW,
      v1: (y + CELL_H) / texH,
    };
  });
  tex.refresh();
  scene.cache.bitmapFont.add(key, { data: { font: key, size: CELL_H, lineHeight: CELL_H, chars }, texture: key, frame: null });
  return key;
}

/** Add text in the pixel font. Text is sanitised so a missing glyph shows as "?". */
export function pixelText(scene: Phaser.Scene, x: number, y: number, text: string, color: string): Phaser.GameObjects.BitmapText {
  return scene.add.bitmapText(x, y, pixelFont(scene, color), sanitize(text));
}
