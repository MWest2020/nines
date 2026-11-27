// The HUD (DESIGN.md, World): money and the current quest along the top, a menu button and a
// Career Trail button, short toasts for money and rewards, and the dialogue box. It runs over
// the world the whole time and redraws from the store. The bar has its own band above the view
// (theme.ts BAND), so it never covers a row of the map; this scene draws on the whole canvas.

import Phaser from 'phaser';
import { questKey } from '../../content/types';
import type { Change } from '../store';
import { DialogueBox, type Page } from './DialogueBox';
import { ellipsize, measure } from './font';
import type { GameUi } from './install';
import { getGameApi } from '../api';
import { pixelText } from './pixelfont';
import { PAD_EVENTS } from '../touch/pad';
import { controlsSetting, cycleControlsSetting } from '../touch/settings';
import { BAND, C, CANVAS, dimmer, hex, panel, VIEW } from './theme';
import { type Button, button, freshKeys, keyboardNav, navigate } from './widgets';

/** the bar fills the band; its last row is a slate rule */
const BAR_H = BAND - 1;
const ICON = { w: 14, h: 12 } as const;

export class HudScene extends Phaser.Scene {
  private ui!: GameUi;
  dialogue!: DialogueBox;
  private money!: Phaser.GameObjects.BitmapText;
  private quest!: Phaser.GameObjects.BitmapText;
  private toasts: Phaser.GameObjects.Container[] = [];
  private menu: { layer: Phaser.GameObjects.Container; buttons: Button[]; focus: number; release: () => void } | null = null;

  constructor() {
    super({ key: 'hud', active: true });
  }

  create(): void {
    this.ui = getGameApi(this) as GameUi;
    const g = this.add.graphics();
    g.fillStyle(hex(C.ink), 0.85).fillRect(0, 0, VIEW.width, BAR_H);
    g.fillStyle(hex(C.slate), 1).fillRect(0, BAR_H, VIEW.width, 1);
    this.money = pixelText(this, 3, 1, '', C.gold);
    this.quest = pixelText(this, 46, 1, '', C.paper);
    this.icon(VIEW.width - 2 * ICON.w - 2, (ig, x) => {
      // the menu: three bars
      for (let i = 0; i < 3; i++) ig.fillRect(x + 3, 3 + i * 3, 8, 1);
    }, () => this.toggleMenu());
    this.icon(VIEW.width - ICON.w - 1, (ig, x) => {
      // the Career Trail: a milestone stone on a path
      ig.fillRect(x + 1, 6, 12, 1);
      ig.fillPoints([{ x: x + 7, y: 2 }, { x: x + 11, y: 6 }, { x: x + 7, y: 10 }, { x: x + 3, y: 6 }], true);
    }, () => !this.ui.isBusy() && void this.ui.openTrail());
    this.dialogue = new DialogueBox(this);
    const kb = this.input.keyboard;
    kb?.on(
      'keydown',
      freshKeys((e: KeyboardEvent) => {
        if (this.dialogue.open && (e.code === 'Enter' || e.code === 'Space')) {
          e.preventDefault();
          this.dialogue.advance();
        }
      }),
    );
    // the on-screen use button advances the dialogue like Enter
    const onPadUse = () => {
      if (this.dialogue.open) this.dialogue.advance();
    };
    this.game.events.on(PAD_EVENTS.use, onPadUse);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(PAD_EVENTS.use, onPadUse));
    const off = this.ui.store.subscribe((_g, change) => this.onChange(change));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
    this.refresh();
  }

  showPages(pages: readonly Page[]): Promise<void> {
    return this.dialogue.show(pages);
  }

  private icon(x: number, paint: (g: Phaser.GameObjects.Graphics, x: number) => void, onPress: () => void): void {
    const g = this.add.graphics();
    g.fillStyle(hex(C.paper), 1);
    paint(g, x);
    this.add.zone(x, 0, ICON.w, ICON.h).setOrigin(0).setInteractive({ useHandCursor: true }).on('pointerdown', onPress);
  }

  private refresh(): void {
    const { store, t } = this.ui;
    this.money.setText(t('ui.money', { amount: store.game.money }));
    const q = store.currentQuest();
    const label = q ? t(questKey(q, 'title')) : t('ui.hud.no_quest');
    this.quest.setText(ellipsize(label, VIEW.width - 46 - 2 * ICON.w - 6));
    this.quest.setAlpha(q ? 1 : 0.6);
    this.quest.setX(Math.max(46, measure(this.money.text) + 10));
  }

  private onChange(change: Change): void {
    const { store, t } = this.ui;
    this.refresh();
    if (change.kind === 'reward') {
      const r = change.reward;
      const branch = store.content.roadmap.branches.find((b) => b.id === r.branch);
      this.toast(t('ui.toast.reward', { money: r.money, xp: r.xp, branch: branch ? t(branch.title) : r.branch }), C.gold);
      if (r.income > 0) this.toast(t('ui.toast.income', { amount: r.income }), C.leaf);
    } else if (change.kind === 'money') {
      this.toast(change.delta < 0 ? t('ui.toast.money_lost', { amount: -change.delta }) : t('ui.toast.money_gained', { amount: change.delta }), change.delta < 0 ? C.orange : C.gold);
    } else if (change.kind === 'purchase') {
      const item = store.content.shop.items.find((i) => i.id === change.item);
      this.toast(t('ui.toast.bought', { item: item ? t(item.title) : change.item }), C.leaf);
    } else if (change.kind === 'locale' && this.menu) {
      const focus = this.menu.focus;
      this.closeMenu();
      this.openMenu(focus);
    }
  }

  /** A line under the bar that fades after a few seconds; at most three at a time. */
  toast(text: string, color: string = C.paper): void {
    const label = ellipsize(text, VIEW.width - 16);
    const w = measure(label) + 8;
    const bg = this.add.rectangle(0, 0, w, 11, hex(C.ink), 0.9).setOrigin(0);
    const c = this.add.container(4, 0, [bg, pixelText(this, 4, 0, label, color)]).setDepth(25);
    this.toasts.push(c);
    if (this.toasts.length > 3) this.toasts.shift()?.destroy();
    this.toasts.forEach((tc, i) => tc.setY(BAR_H + 3 + i * 12));
    this.tweens.add({
      targets: c,
      alpha: 0,
      delay: 2600,
      duration: 400,
      onComplete: () => {
        this.toasts = this.toasts.filter((x) => x !== c);
        c.destroy();
      },
    });
  }

  // ---- the menu: Career Trail, language, credits

  /** The menu button, in the bar or among the touch controls. */
  toggleMenu(): void {
    if (this.menu) this.closeMenu();
    else if (!this.ui.isBusy()) this.openMenu(0);
  }

  private openMenu(focus: number): void {
    const { store, t } = this.ui;
    const release = this.ui.hold();
    const w = 140;
    const x = (VIEW.width - w) / 2;
    const items: [string, () => void][] = [
      [t('ui.roadmap.title'), () => this.fromMenu(() => this.ui.openTrail())],
      [t('ui.menu.option', { label: t('ui.language'), value: t(`ui.locale.${store.game.locale}`) }), () => this.ui.setLocale(store.game.locale === 'nl' ? 'en' : 'nl')],
      [t('ui.menu.option', { label: t('ui.controls'), value: t(`ui.controls.${controlsSetting()}`) }), () => this.refreshMenu(cycleControlsSetting)],
      [t('ui.credits.title'), () => this.fromMenu(() => this.ui.openCredits())],
      [t('ui.close'), () => this.closeMenu()],
    ];
    const note = store.slot.writable ? null : t('ui.save_off');
    const h = 20 + items.length * 16 + (note ? 12 : 0);
    const y = Math.round((CANVAS.height - h) / 2);
    const objects: Phaser.GameObjects.GameObject[] = [dimmer(this, 0.5, CANVAS.height), panel(this, x, y, w, h, 13), pixelText(this, x + 6, y + 2, t('ui.menu.title'), C.paper)];
    const buttons = items.map(([label, fn], i) => {
      const b = button(this, x + 8, y + 18 + i * 16, label, fn, { w: w - 16 });
      objects.push(...b.objects);
      return b;
    });
    if (note) objects.push(pixelText(this, x + 6, y + h - 12, ellipsize(note, w - 12), C.orange));
    const layer = this.add.container(0, 0, objects).setDepth(40);
    const offKeys = keyboardNav(this, {
      move: (d) => this.menu && this.focusMenu(navigate(this.menu.buttons, this.menu.focus, d)),
      press: () => this.menu?.buttons[this.menu.focus]?.activate(),
      back: () => this.closeMenu(),
    });
    this.menu = {
      layer,
      buttons,
      focus,
      release: () => {
        offKeys();
        release();
      },
    };
    this.focusMenu(focus);
  }

  private focusMenu(i: number): void {
    if (!this.menu || i < 0) return;
    this.menu.focus = i;
    this.menu.buttons.forEach((b, j) => b.setFocus(j === i));
  }

  private closeMenu(): void {
    if (!this.menu) return;
    const m = this.menu;
    this.menu = null;
    m.layer.destroy(true);
    m.release();
  }

  /** Change a setting shown in the menu, then draw the menu again with the new value. */
  private refreshMenu(change: () => unknown): void {
    change();
    if (!this.menu) return;
    const focus = this.menu.focus;
    this.closeMenu();
    this.openMenu(focus);
  }

  private fromMenu(open: () => Promise<void>): void {
    this.closeMenu();
    void open();
  }
}
