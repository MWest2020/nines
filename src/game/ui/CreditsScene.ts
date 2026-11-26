// Credits, generated from the author fields in content (the bundle's `credits`): every person
// who wrote a quest or a character, with what they made, and each character sprite with its
// source and licence. Handles and URLs are shown as text, never as links (no navigation away
// from the game). Up and down scroll when it is long.

import type Phaser from 'phaser';
import { npcKey, questKey } from '../../content/types';
import { findNpc } from '../../core/talk';
import { wrap } from './font';
import { pixelText } from './pixelfont';
import { Screen } from './Screen';
import { C, panel } from './theme';
import { button, buttonWidth, type Dir } from './widgets';

const P = { x: 8, y: 6, w: 224, h: 148 } as const;
const TOP = P.y + 18;
const VISIBLE = 11;

export class CreditsScene extends Screen {
  private scroll = 0;
  private total = 0;

  constructor() {
    super('credits');
  }

  override create(): void {
    this.scroll = 0;
    super.create();
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => this.scrollBy(dy > 0 ? 1 : -1));
  }

  /** The lines to show, each with its colour. */
  private lines(): { text: string; color: string }[] {
    const { store, t } = this.api;
    const width = P.w - 12;
    const out: { text: string; color: string }[] = [];
    const add = (text: string, color: string) => wrap(text, width).forEach((l) => out.push({ text: l, color }));
    add(t('ui.credits.intro'), C.mist);
    for (const c of store.content.credits) {
      out.push({ text: '', color: C.paper });
      add(c.handle ? t('ui.credits.handle', { name: c.name, handle: c.handle }) : c.name, C.gold);
      if (c.url) add(c.url, C.grey);
      const quests = c.for.filter((f) => f.startsWith('quest:')).map((f) => t(questKey(f.slice(6), 'title')));
      const npcs = c.for
        .filter((f) => f.startsWith('npc:'))
        .map((f) => {
          const npc = findNpc(store.content, f.slice(4));
          return npc ? t(npc.key(npc.spec.name)) : t(npcKey(f.slice(4), 'npc.name'));
        });
      if (quests.length > 0) add(t('ui.credits.quests', { list: quests.join(t('ui.list_sep')) }), C.paper);
      if (npcs.length > 0) add(t('ui.credits.npcs', { list: npcs.join(t('ui.list_sep')) }), C.paper);
      // a character's sprite sheet, with where it came from and its licence (ASSETS.md)
      for (const f of c.for.filter((x) => x.startsWith('npc:'))) {
        const npc = findNpc(store.content, f.slice(4));
        const sprite = npc?.spec.sprite;
        if (npc && sprite) add(t('ui.credits.sprite', { name: t(npc.key(npc.spec.name)), source: sprite.source, license: sprite.license }), C.mist);
      }
    }
    out.push({ text: '', color: C.paper });
    add(t('ui.credits.own'), C.mist);
    return out;
  }

  protected draw(): Phaser.GameObjects.GameObject[] {
    const { t } = this.api;
    const out: Phaser.GameObjects.GameObject[] = [panel(this, P.x, P.y, P.w, P.h, 13)];
    out.push(pixelText(this, P.x + 6, P.y + 2, t('ui.credits.title'), C.paper));
    const lines = this.lines();
    this.total = lines.length;
    this.scroll = Math.max(0, Math.min(this.scroll, lines.length - VISIBLE));
    lines.slice(this.scroll, this.scroll + VISIBLE).forEach((l, i) => out.push(pixelText(this, P.x + 6, TOP + i * 10, l.text, l.color)));
    if (lines.length > VISIBLE) {
      const marker = t('ui.credits.lines', { from: this.scroll + 1, to: Math.min(lines.length, this.scroll + VISIBLE), total: lines.length });
      out.push(pixelText(this, P.x + 6, P.y + P.h - 14, marker, C.grey));
    }
    const close = t('ui.close');
    out.push(...this.addButton(button(this, P.x + P.w - 8 - buttonWidth(close), P.y + P.h - 17, close, () => this.close())));
    return out;
  }

  protected override move(d: Dir): void {
    if (d === 'up') this.scrollBy(-1);
    else if (d === 'down') this.scrollBy(1);
  }

  private scrollBy(n: number): void {
    const next = Math.max(0, Math.min(this.scroll + n, this.total - VISIBLE));
    if (next === this.scroll) return;
    this.scroll = next;
    this.redraw();
  }
}
