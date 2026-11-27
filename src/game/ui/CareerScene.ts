// The career coach's screen (DESIGN.md, Career paths: the choice at Medior City): the six paths
// from roadmap.yaml, one per page with its pitch, a Choose button and a confirmation. Once a path
// is chosen the same screen offers a paid change (core/game.ts changePath, issue #24's default).
// Left and right turn the pages; up and down move between the buttons. Choosing goes through the
// pure rules, so it can never happen before the road to Medior City is open.

import type Phaser from 'phaser';
import { CAREER_CHANGE_FEE } from '../../core/game';
import { ellipsize, measure, wrap } from './font';
import { pixelText } from './pixelfont';
import { Screen } from './Screen';
import { C, panel } from './theme';
import { button, buttonWidth, type Dir } from './widgets';

const P = { x: 8, y: 6, w: 224, h: 148 } as const;

export class CareerScene extends Screen {
  private page = 0;
  /** the path waiting for a yes, or null on the normal page */
  private confirming: string | null = null;

  constructor() {
    super('career');
  }

  override create(): void {
    this.confirming = null;
    this.page = 0;
    super.create();
    // open on the player's own path, or on the first
    const chosen = this.api.store.game.path;
    const at = this.api.store.content.roadmap.paths.findIndex((p) => p.id === chosen);
    if (at > 0) {
      this.page = at;
      this.redraw();
    }
  }

  /** Left and right turn the pages (not on the confirmation); up and down move the focus. */
  protected override move(d: Dir): void {
    if (this.confirming === null && (d === 'left' || d === 'right')) {
      this.turn(d === 'left' ? -1 : 1);
      return;
    }
    super.move(d);
  }

  private turn(by: number): void {
    const n = this.api.store.content.roadmap.paths.length;
    this.page = (this.page + by + n) % n;
    this.focus = 0;
    this.redraw();
  }

  /** Escape on the confirmation goes back to the page, not out of the screen. */
  override close(): void {
    if (this.confirming !== null) {
      this.confirming = null;
      this.focus = 0;
      this.redraw();
      return;
    }
    super.close();
  }

  protected draw(): Phaser.GameObjects.GameObject[] {
    const { store, t } = this.api;
    const game = store.game;
    const paths = store.content.roadmap.paths;
    this.page = Math.max(0, Math.min(this.page, paths.length - 1));
    const path = paths[this.page]!;
    const out: Phaser.GameObjects.GameObject[] = [panel(this, P.x, P.y, P.w, P.h, 13)];
    out.push(pixelText(this, P.x + 6, P.y + 2, t('ui.career.title'), C.paper));
    const money = t('ui.money', { amount: game.money });
    out.push(pixelText(this, P.x + P.w - 6 - measure(money), P.y + 2, money, C.gold));
    const mine = paths.find((p) => p.id === game.path);
    const status = mine ? t('ui.career.yours', { path: t(mine.title) }) : t('ui.career.none');
    out.push(pixelText(this, P.x + 6, P.y + 18, ellipsize(status, P.w - 12), mine ? C.leaf : C.grey));

    const width = P.w - 16;
    if (this.confirming !== null) {
      const target = paths.find((p) => p.id === this.confirming)!;
      out.push(pixelText(this, P.x + 8, P.y + 36, ellipsize(t('ui.career.confirm', { path: t(target.title) }), width), C.gold));
      const note = game.path === null ? t('ui.career.confirm_first', { fee: CAREER_CHANGE_FEE }) : t('ui.career.confirm_change', { fee: CAREER_CHANGE_FEE });
      out.push(pixelText(this, P.x + 8, P.y + 50, wrap(note, width).slice(0, 5).join('\n'), C.mist));
      const footY = P.y + P.h - 17;
      const yes = t('ui.career.yes');
      out.push(...this.addButton(button(this, P.x + 8, footY, yes, () => this.confirm(target.id))));
      const back = t('ui.career.back');
      out.push(...this.addButton(button(this, P.x + P.w - 8 - buttonWidth(back), footY, back, () => this.close())));
      return out;
    }

    out.push(pixelText(this, P.x + 8, P.y + 34, ellipsize(t(path.title), width), C.gold));
    out.push(pixelText(this, P.x + 8, P.y + 47, wrap(t(path.pitch), width).slice(0, 5).join('\n'), C.paper));

    // the action for this page: choose it, change to it (a fee), or it is yours already
    const actY = P.y + P.h - 34;
    if (game.path === path.id) {
      out.push(pixelText(this, P.x + 8, actY + 2, t('ui.career.current'), C.leaf));
    } else {
      const label = game.path === null ? t('ui.career.choose') : t('ui.career.change', { fee: CAREER_CHANGE_FEE });
      const affordable = game.path === null || game.money >= CAREER_CHANGE_FEE;
      const b = button(this, P.x + 8, actY, label, () => this.ask(path.id), { color: affordable ? C.paper : C.grey });
      b.enabled = affordable;
      out.push(...this.addButton(b));
      if (!affordable) out.push(pixelText(this, P.x + 14 + buttonWidth(label), actY + 2, t('ui.career.too_poor', { fee: CAREER_CHANGE_FEE }), C.orange));
    }

    const footY = P.y + P.h - 17;
    out.push(...this.addButton(button(this, P.x + 8, footY, '‹', () => this.turn(-1))));
    out.push(...this.addButton(button(this, P.x + 28, footY, '›', () => this.turn(1))));
    out.push(pixelText(this, P.x + 50, footY + 2, t('ui.shop.page', { n: this.page + 1, of: paths.length }), C.grey));
    const close = t('ui.close');
    out.push(...this.addButton(button(this, P.x + P.w - 8 - buttonWidth(close), footY, close, () => this.close())));
    return out;
  }

  private ask(id: string): void {
    this.confirming = id;
    this.focus = 0;
    this.redraw();
  }

  private confirm(id: string): void {
    const { store } = this.api;
    const first = store.game.path === null;
    const ok = first ? store.choosePath(id) : store.changePath(id);
    this.confirming = null;
    this.focus = 0;
    if (!ok) {
      this.redraw();
      return;
    }
    // the HUD toasts the new path (and the fee); the coach has her say about the mentor once the screen is closed (src/game/bridge.ts)
    super.close();
  }
}
