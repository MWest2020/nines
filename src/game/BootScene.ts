// Loads the maps' tilesets and the character sheets (all same-origin files in dist/), prepares
// the placeholder NPC sheets and the walk animations, then starts the world.

import Phaser from 'phaser';
import content from 'virtual:nines-content';
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
    this.scene.start('world');
  }
}
