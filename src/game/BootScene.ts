// Placeholder scene for the phase 1 skeleton. The MVP build replaces it with the village map,
// the player, NPCs and the terminal overlay (see ARCHITECTURE.md, Modules).

import Phaser from 'phaser';
import content from 'virtual:nines-content';
import { createTranslator, defaultLocale } from '../core/i18n';

export const VIEW = { width: 240, height: 160 } as const;

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create(): void {
    const t = createTranslator(content.locales, defaultLocale(navigator.languages ?? [navigator.language]));
    this.cameras.main.setBackgroundColor('#183048');
    const style = { fontFamily: 'monospace', fontSize: '8px', color: '#f8f0d8', align: 'center' } as const;
    this.add.text(VIEW.width / 2, 56, t('ui.title'), { ...style, fontSize: '16px' }).setOrigin(0.5);
    this.add.text(VIEW.width / 2, 84, t('ui.subtitle'), style).setOrigin(0.5);
    this.add.text(VIEW.width / 2, 108, t('ui.skeleton', { quests: content.quests.length }), { ...style, color: '#88c070' }).setOrigin(0.5);
  }
}
