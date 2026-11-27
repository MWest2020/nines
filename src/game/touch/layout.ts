// Where the game view and the touch controls go (DESIGN.md, Mobile controls). Pure: the size
// of the window and the safe-area insets in, rectangles in CSS px out, so tests/game/layout.test.ts
// checks every phone and tablet shape without a browser.
//
// - The canvas is CANVAS (the 240 x 160 view plus the HUD band) scaled by a whole number when
//   that is at least 2 and keeps 80% of the room; otherwise a whole number would waste too much
//   of the screen, so the view fills the room it has (pixels then differ by one screen pixel).
// - Without controls the view is centred in the window.
// - Portrait: the view on top, the controls below it (menu and Career Trail buttons, then the
//   D-pad on the left and the use and back buttons on the right).
// - Landscape: the D-pad on the left of the view, the buttons on its right.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type LayoutMode = 'plain' | 'portrait' | 'landscape';

export interface Layout {
  mode: LayoutMode;
  /** CSS px per canvas pixel */
  scale: number;
  /** the scale is a whole number */
  integer: boolean;
  game: Rect;
  /** the D-pad, the use/back pair and the menu/trail pair; null without controls */
  dpad: Rect | null;
  actions: Rect | null;
  system: Rect | null;
}

/** The playfield: 15 x 10 tiles of 16 px (DESIGN.md, Sizes). */
export const VIEW_SIZE = { width: 240, height: 160 } as const;
/** The HUD bar's band above the playfield, so the HUD never covers a row of the map. */
export const HUD_BAND = 12;
/** The canvas: the HUD band and the view under it. */
export const CANVAS = { width: VIEW_SIZE.width, height: VIEW_SIZE.height + HUD_BAND } as const;

/** Sizes in CSS px. DESIGN.md: touch targets at least 48 x 48, the D-pad 144 x 144. */
export const PAD = {
  dpad: 144,
  /** the use / back pair sits in a square as big as the D-pad */
  actions: 144,
  use: 64,
  back: 56,
  /** the menu and Career Trail buttons */
  system: 48,
  gap: 8,
  margin: 12,
} as const;

const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The scale for a box: a whole number from 2 up when it keeps at least 80% of the room (pixels
 * stay square and sharp), the exact fit otherwise (a 2.9x tablet would lose a third at 2x).
 */
export function fitScale(w: number, h: number): { scale: number; integer: boolean } {
  const fit = Math.min(w / CANVAS.width, h / CANVAS.height);
  if (fit >= 2 && Math.floor(fit) / fit >= 0.8) return { scale: Math.floor(fit), integer: true };
  return { scale: Math.max(0.5, Math.floor(fit * 100) / 100), integer: false };
}

/** Centre the scaled canvas in a box. */
function place(box: Rect): { game: Rect; scale: number; integer: boolean } {
  const { scale, integer } = fitScale(box.w, box.h);
  const w = Math.round(CANVAS.width * scale);
  const h = Math.round(CANVAS.height * scale);
  return { game: { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h }, scale, integer };
}

export function computeLayout(width: number, height: number, controls: boolean, insets: Insets = NO_INSETS): Layout {
  const safe: Rect = {
    x: insets.left,
    y: insets.top,
    w: Math.max(0, width - insets.left - insets.right),
    h: Math.max(0, height - insets.top - insets.bottom),
  };
  if (!controls) return { mode: 'plain', ...place(safe), dpad: null, actions: null, system: null };

  const m = PAD.margin;
  const systemW = 2 * PAD.system + PAD.gap;
  if (width > height) {
    // landscape: a column on each side, as wide as the D-pad plus margins
    const side = PAD.dpad + 2 * m;
    const view = place({ x: safe.x + side, y: safe.y + m / 2, w: safe.w - 2 * side, h: safe.h - m });
    const bottom = safe.y + safe.h - m;
    return {
      mode: 'landscape',
      ...view,
      dpad: { x: safe.x + m, y: bottom - PAD.dpad, w: PAD.dpad, h: PAD.dpad },
      actions: { x: safe.x + safe.w - m - PAD.actions, y: bottom - PAD.actions, w: PAD.actions, h: PAD.actions },
      system: { x: safe.x + safe.w - m - systemW, y: safe.y + m, w: systemW, h: PAD.system },
    };
  }
  // portrait: the controls take a band at the bottom, the view gets what is left
  const band = PAD.system + PAD.gap + PAD.dpad + 2 * m;
  const view = place({ x: safe.x + m / 2, y: safe.y + m / 2, w: safe.w - m, h: safe.h - band - m / 2 });
  const bottom = safe.y + safe.h - m;
  return {
    mode: 'portrait',
    ...view,
    dpad: { x: safe.x + m, y: bottom - PAD.dpad, w: PAD.dpad, h: PAD.dpad },
    actions: { x: safe.x + safe.w - m - PAD.actions, y: bottom - PAD.actions, w: PAD.actions, h: PAD.actions },
    system: { x: safe.x + safe.w - m - systemW, y: bottom - PAD.dpad - PAD.gap - PAD.system, w: systemW, h: PAD.system },
  };
}

/** Show the controls? The setting wins; on auto, touch screens and narrow windows get them. */
export type ControlsSetting = 'auto' | 'on' | 'off';

export function controlsShown(setting: ControlsSetting, touch: boolean, width: number): boolean {
  if (setting !== 'auto') return setting === 'on';
  return touch || width < 600;
}
