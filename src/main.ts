import Phaser from 'phaser';
import { BootScene, VIEW } from './game/BootScene';
import { WorldScene } from './game/WorldScene';

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
  scene: [BootScene, WorldScene],
});
