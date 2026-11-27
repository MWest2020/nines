import Phaser from 'phaser';
import content from 'virtual:nines-content';
import { defaultLocale } from './core/i18n';
import { openSave } from './core/persist';
import { BootScene } from './game/BootScene';
import { bridgeWorld } from './game/bridge';
import { browserStorage, newSeed } from './game/storage';
import { GameStore } from './game/store';
import { installTouchControls } from './game/touch/controls';
import { CANVAS } from './game/touch/layout';
import { registerOffline } from './game/offline';
import { getGameApi } from './game/api';
import type { HudScene } from './game/ui/HudScene';
import { installGameApi, UI_SCENES } from './game/ui/install';
import { WorldScene } from './game/WorldScene';

// The save is opened before Phaser starts: a newer version's save is detected here and never
// written over (src/core/persist.ts).
const { game: saved, slot } = openSave(browserStorage(), defaultLocale(navigator.languages ?? [navigator.language]), newSeed());
const store = new GameStore(content, saved, slot);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  // the 240 x 160 view and the HUD band above it; src/game/touch/layout.ts sizes the parent
  width: CANVAS.width,
  height: CANVAS.height,
  pixelArt: true,
  backgroundColor: '#101820',
  // FIT fills #game exactly; src/game/touch/controls.ts gives #game a whole-number multiple of
  // the canvas where it fits. expandParent off: Phaser must not resize #game itself.
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH, expandParent: false },
  // Phaser's banner is a console.log only; no request is made.
  banner: false,
  audio: { noAudio: true },
  callbacks: {
    preBoot: (game) => {
      const api = installGameApi(game, store);
      bridgeWorld(game, api);
      // In `vite dev` only: the API on the console, for trying screens by hand.
      if (import.meta.env.DEV) (globalThis as { nines?: unknown }).nines = api;
    },
    // The page layout (the canvas scaled by a whole number where it fits) and, on touch screens
    // or narrow windows, the on-screen controls (src/game/touch).
    postBoot: (game) => {
      installTouchControls(game, getGameApi(game), { toggleMenu: () => (game.scene.getScene('hud') as HudScene | null)?.toggleMenu() });
    },
  },
  // World scenes first; the UI scenes draw over them.
  scene: [BootScene, WorldScene, ...UI_SCENES],
});

// Once loaded, the game keeps working offline: a small service worker keeps the built files
// (src/offline/sw.js, docs/how-to/verify-offline.md).
registerOffline();

// Closing the tab or sending the Android app to the background saves (ARCHITECTURE.md, Saves).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.save();
});
