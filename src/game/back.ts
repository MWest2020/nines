// The Android back button. MainActivity.java (android/) calls window.ninesBack() on a back press;
// it closes what is open, innermost first, and returns whether it did. When it returns false
// (nothing open: the player is walking around), the app goes to the background like any Android
// app's first screen, and the game saves on the way (visibilitychange in src/main.ts).
//
// The DOM overlays (the terminal and battles) register their own back while they are open: the
// same as their Escape key. Screens, the menu and dialogues already answer the on-screen back
// button (PAD_EVENTS.back), so the hardware button sends that. In a browser nothing calls this.

import type Phaser from 'phaser';
import type { GameApi } from './api';
import { PAD_EVENTS } from './touch/pad';

type Back = () => void;

const overlays: Back[] = [];

/** An overlay's back while it is open; call the returned function once when it closes. */
export function pushBack(back: Back): () => void {
  overlays.push(back);
  return () => {
    const i = overlays.lastIndexOf(back);
    if (i >= 0) overlays.splice(i, 1);
  };
}

/** One back press: the newest overlay, else what the on-screen back button does while something
 *  is open. False when nothing was open. */
export function goBack(isBusy: () => boolean, padBack: () => void): boolean {
  const top = overlays[overlays.length - 1];
  if (top) {
    top();
    return true;
  }
  if (isBusy()) {
    padBack();
    return true;
  }
  return false;
}

export function installBackButton(game: Phaser.Game, api: GameApi): void {
  (globalThis as { ninesBack?: () => boolean }).ninesBack = () => goBack(() => api.isBusy(), () => game.events.emit(PAD_EVENTS.back));
}
