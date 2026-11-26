import Phaser from 'phaser';
import content from 'virtual:nines-content';
import { defaultLocale } from './core/i18n';
import { openSave } from './core/persist';
import { BootScene, VIEW } from './game/BootScene';
import { browserStorage, newSeed } from './game/storage';
import { GameStore } from './game/store';
import { installGameApi, UI_SCENES } from './game/ui/install';

// The save is opened before Phaser starts: a newer version's save is detected here and never
// written over (src/core/persist.ts).
const { game: saved, slot } = openSave(browserStorage(), defaultLocale(navigator.languages ?? [navigator.language]), newSeed());
const store = new GameStore(content, saved, slot);

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEW.width,
  height: VIEW.height,
  pixelArt: true,
  backgroundColor: '#101820',
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  // Phaser's banner is a console.log only; no request is made.
  banner: false,
  audio: { noAudio: true },
  callbacks: {
    preBoot: (game) => {
      const api = installGameApi(game, store);
      // In `vite dev` only: the API on the console, for trying screens by hand.
      if (import.meta.env.DEV) (globalThis as { nines?: unknown }).nines = api;
    },
  },
  // World scenes first; the UI scenes draw over them.
  scene: [BootScene, ...UI_SCENES],
});

// Closing the tab or sending the Android app to the background saves (ARCHITECTURE.md, Saves).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.save();
});
