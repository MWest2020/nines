// Placeholder scene for the phase 1 skeleton. The MVP build replaces it with the village map,
// the player, NPCs and the terminal overlay (see ARCHITECTURE.md, Modules).

import Phaser from 'phaser';
import content from 'virtual:nines-content';
import { getGameApi } from './api';

export const VIEW = { width: 240, height: 160 } as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const api = getGameApi(this);
    this.cameras.main.setBackgroundColor('#183048');
    const style = { fontFamily: 'monospace', fontSize: '8px', color: '#f8f0d8', align: 'center' } as const;
    const title = this.add.text(VIEW.width / 2, 56, '', { ...style, fontSize: '16px' }).setOrigin(0.5);
    const subtitle = this.add.text(VIEW.width / 2, 84, '', style).setOrigin(0.5);
    const skeleton = this.add.text(VIEW.width / 2, 108, '', { ...style, color: '#88c070' }).setOrigin(0.5);
    const draw = () => {
      title.setText(api.t('ui.title'));
      subtitle.setText(api.t('ui.subtitle'));
      skeleton.setText(api.t('ui.skeleton', { quests: content.quests.length }));
    };
    draw();
    const off = api.store.subscribe((_g, change) => change.kind === 'locale' && draw());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }
}
