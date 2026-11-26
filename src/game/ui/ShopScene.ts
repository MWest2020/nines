// The Homelab Store (DESIGN.md, Homelab Store): the items in shop.yaml with their price, what
// they do and a Buy button; one silhouette for the gear the next town will sell. Buying goes
// through the pure rules (core/game.ts buy), so it can never spend money the player lacks.

import type Phaser from 'phaser';
import { ellipsize, measure, wrap } from './font';
import { pixelText } from './pixelfont';
import { Screen } from './Screen';
import { C, hex, panel } from './theme';
import { button, buttonWidth } from './widgets';

const P = { x: 8, y: 6, w: 224, h: 148 } as const;
const CARD_H = 70;

export class ShopScene extends Screen {
  constructor() {
    super('shop');
  }

  protected draw(): Phaser.GameObjects.GameObject[] {
    const { store, t } = this.api;
    const game = store.game;
    const out: Phaser.GameObjects.GameObject[] = [panel(this, P.x, P.y, P.w, P.h, 13)];
    out.push(pixelText(this, P.x + 6, P.y + 2, t('ui.shop.title'), C.paper));
    const money = t('ui.money', { amount: game.money });
    out.push(pixelText(this, P.x + P.w - 6 - measure(money), P.y + 2, money, C.gold));

    let y = P.y + 18;
    for (const item of store.content.shop.items) {
      const owned = game.items.includes(item.id);
      out.push(art(this, P.x + 6, y, item.id));
      const tx = P.x + 42;
      const price = t('ui.shop.price', { price: item.price });
      out.push(pixelText(this, P.x + P.w - 6 - measure(price), y, price, C.gold));
      out.push(pixelText(this, tx, y, ellipsize(t(item.title), P.x + P.w - 12 - measure(price) - tx), C.paper));
      const desc = wrap(t(item.description), P.x + P.w - 8 - tx).slice(0, 4);
      out.push(pixelText(this, tx, y + 11, desc.join('\n'), C.mist));
      const check = store.canBuy(item.id);
      const rowY = y + CARD_H - 14;
      if (owned) {
        out.push(pixelText(this, P.x + P.w - 8 - measure(t('ui.shop.owned')), rowY + 2, t('ui.shop.owned'), C.grass));
      } else {
        const label = t('ui.shop.buy');
        const b = button(this, P.x + P.w - 8 - buttonWidth(label), rowY, label, () => store.buy(item.id), { color: check.ok ? C.paper : C.grey });
        b.enabled = check.ok;
        out.push(...this.addButton(b));
        if (!check.ok) {
          const why =
            check.reason === 'money'
              ? t('ui.shop.too_expensive')
              : check.reason === 'locked'
                ? t('ui.shop.needs', { item: item.requires.map((r) => t(store.content.shop.items.find((i) => i.id === r)?.title ?? r)).join(', ') })
                : '';
          out.push(pixelText(this, tx, rowY + 2, ellipsize(why, b.x - tx - 4), C.orange));
        }
      }
      y += CARD_H + 2;
    }

    // what comes later: one silhouette and the town that will sell it
    const next = store.content.roadmap.towns.find((tw) => tw.stage === 'medior');
    if (next && y + 30 < P.y + P.h - 16) {
      out.push(art(this, P.x + 6, y, null));
      out.push(pixelText(this, P.x + 42, y, t('ui.shop.mystery'), C.grey));
      out.push(pixelText(this, P.x + 42, y + 11, t('ui.shop.more', { town: t(next.title) }), C.grey));
    }

    const close = t('ui.close');
    out.push(...this.addButton(button(this, P.x + P.w - 8 - buttonWidth(close), P.y + P.h - 17, close, () => this.close())));
    return out;
  }
}

/** Item art, drawn in palette colours: the Raspberry Pi as a little green board; null = a silhouette. */
function art(scene: Phaser.Scene, x: number, y: number, id: string | null): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.fillStyle(hex(C.shadow), 1).fillRect(x, y, 30, 26);
  g.lineStyle(1, hex(C.slate), 1).strokeRect(x + 0.5, y + 0.5, 29, 25);
  if (id === null) {
    g.fillStyle(hex(C.slate), 1).fillRect(x + 7, y + 8, 16, 10);
    return g;
  }
  if (id === 'raspberry-pi') {
    g.fillStyle(hex('#306838'), 1).fillRect(x + 4, y + 6, 22, 15); // the board
    g.fillStyle(hex(C.gold), 1);
    for (let i = 0; i < 9; i++) g.fillRect(x + 6 + i * 2, y + 7, 1, 2); // GPIO pins
    g.fillStyle(hex(C.ink), 1).fillRect(x + 9, y + 12, 6, 5); // the chip
    g.fillStyle(hex(C.mist), 1).fillRect(x + 20, y + 11, 6, 4).fillRect(x + 20, y + 16, 6, 4); // USB ports
    g.fillStyle(hex(C.grass), 1).fillRect(x + 5, y + 19, 1, 1); // the power LED
    return g;
  }
  g.fillStyle(hex(C.grey), 1).fillRect(x + 7, y + 8, 16, 10);
  return g;
}
