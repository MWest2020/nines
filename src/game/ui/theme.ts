// The palette (DESIGN.md, Palette) and the panel every UI screen is drawn in: an ink panel with
// square corners and a 1 px rule, our own shape.

import Phaser from 'phaser';

export const C = {
  ink: '#101820',
  shadow: '#283840',
  slate: '#485860',
  grey: '#788890',
  mist: '#b0b8b8',
  paper: '#f8f0d8',
  deepGreen: '#183020',
  grass: '#58a058',
  leaf: '#88c070',
  night: '#183048',
  sky: '#4880c8',
  ice: '#88b8e8',
  clay: '#c86848',
  orange: '#e89858',
  gold: '#f8d070',
  plum: '#683878',
  lilac: '#a868a8',
} as const;

export const hex = (c: string): number => Number.parseInt(c.slice(1), 16);

export const VIEW = { width: 240, height: 160 } as const;

/** The HUD bar sits in its own band above the view; the canvas is both (src/game/touch/layout.ts). */
export { CANVAS, HUD_BAND as BAND } from '../touch/layout';

/** UI scenes draw above the world; their depth inside the scene. */
export const DEPTH = { panel: 10, text: 11, top: 20 } as const;

/** An ink panel with a slate edge; `rule` draws a gold line under a title bar of that height. */
export function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, rule?: number): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(hex(C.ink), 1).fillRect(x, y, w, h);
  g.lineStyle(1, hex(C.slate), 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  if (rule !== undefined) g.fillStyle(hex(C.gold), 1).fillRect(x + 1, y + rule, w - 2, 1);
  return g;
}

/** Dim whatever is under a full-screen UI screen (the view; pass a height to dim more). */
export function dimmer(scene: Phaser.Scene, alpha = 0.6, height: number = VIEW.height): Phaser.GameObjects.Rectangle {
  return scene.add.rectangle(0, 0, VIEW.width, height, hex(C.ink), alpha).setOrigin(0).setInteractive();
}
