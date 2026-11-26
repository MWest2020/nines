// Loads the maps' tilesets and the character sheets (all same-origin files in dist/), prepares
// the placeholder NPC sheets and the walk animations, then starts the world where the save left
// the player.

import Phaser from 'phaser';
import content from 'virtual:nines-content';
import { getGameApi } from './api';
import { createSprites, preloadSprites } from './world/sprites';

export const VIEW = { width: 240, height: 160 } as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload(): void {
    preloadSprites(this, content);
  }

  create(): void {
    createSprites(this, content);
    for (const m of content.maps) {
      this.cache.tilemap.add(`map:${m.id}`, { format: Phaser.Tilemaps.Formats.TILED_JSON, data: m.map });
    }
    // Back where the save says, once the player has entered a map (positions are only saved
    // on arrival, so they are always a spawn point or a door's landing).
    const { game } = getGameApi(this).store;
    this.scene.start('world', game.ticks > 0 ? { ...game.player } : {});
  }
}
