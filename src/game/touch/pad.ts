// The on-screen controls' side of input (src/game/touch/controls.ts). The world reads the held
// D-pad direction every frame, like the arrow keys; screens and the HUD listen for the events
// on game.events, like Enter, Escape and the arrows (src/game/ui/widgets.ts keyboardNav).

import type { Facing } from '../../world/grid';

export const PAD_EVENTS = {
  /** a D-pad direction was pressed (and repeats while held): moves focus in menus and screens */
  move: 'pad:move',
  /** the use button: talk, use, advance a dialogue, press the focused button */
  use: 'pad:use',
  /** the back button: close a screen or the menu */
  back: 'pad:back',
} as const;

/** The direction held on the D-pad now, or null. */
export const padState: { held: Facing | null } = { held: null };
