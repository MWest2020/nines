// The base of the full-screen UI screens (Career Trail, shop, credits): a dimmed world behind
// an ink panel, buttons with keyboard focus, Escape or Close to leave. A screen redraws from
// the store whenever the game state changes, so it never keeps state of its own.

import Phaser from 'phaser';
import type { GameApi } from '../api';
import { getGameApi } from '../api';
import { type Button, type Dir, type Focusable, keyboardNav, navigate } from './widgets';
import { BAND, dimmer, VIEW } from './theme';

export interface ScreenData {
  done?: () => void;
}

export abstract class Screen extends Phaser.Scene {
  protected api!: GameApi;
  protected focusables: (Focusable & { activate(): void; setFocus(on: boolean): void })[] = [];
  protected focus = 0;
  private onDone: (() => void) | undefined;
  private layer: Phaser.GameObjects.Container | null = null;

  init(data: ScreenData): void {
    this.onDone = data.done;
  }

  create(): void {
    this.api = getGameApi(this);
    this.focus = 0;
    // screens are drawn for the 240 x 160 view, under the HUD band (money stays in sight)
    this.cameras.main.setViewport(0, BAND, VIEW.width, VIEW.height);
    dimmer(this);
    const offKeys = keyboardNav(this, {
      move: (d) => this.move(d),
      press: () => this.focusables[this.focus]?.activate(),
      back: () => this.close(),
    });
    const offStore = this.api.store.subscribe(() => this.redraw());
    // However the screen ends (close(), or another scene stopping it), its caller is told.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offKeys();
      offStore();
      this.finish();
    });
    this.redraw();
  }

  /** Draw everything into a fresh layer; keep focus on the same index when it still exists. */
  protected redraw(): void {
    this.layer?.destroy(true);
    this.focusables = [];
    const objects = this.draw();
    this.layer = this.add.container(0, 0, objects);
    if (this.focus >= this.focusables.length) this.focus = Math.max(0, this.focusables.length - 1);
    this.focusables.forEach((f, i) => f.setFocus(i === this.focus));
  }

  /** Build the screen; register buttons with focusable(). */
  protected abstract draw(): Phaser.GameObjects.GameObject[];

  protected focusable<T extends Focusable & { activate(): void; setFocus(on: boolean): void }>(f: T): T {
    this.focusables.push(f);
    return f;
  }

  protected addButton(b: Button): Phaser.GameObjects.GameObject[] {
    this.focusable(b);
    return b.objects;
  }

  protected move(d: Dir): void {
    const next = navigate(this.focusables, this.focus, d);
    if (next < 0 || next === this.focus) return;
    this.setFocus(next);
  }

  protected setFocus(i: number): void {
    this.focusables[this.focus]?.setFocus(false);
    this.focus = i;
    this.focusables[i]?.setFocus(true);
    this.onFocus(i);
  }

  /** Called when focus moves; screens that show details of the focused item redraw them. */
  protected onFocus(_i: number): void {}

  close(): void {
    this.scene.stop();
    this.finish();
  }

  private finish(): void {
    const done = this.onDone;
    this.onDone = undefined;
    done?.();
  }
}
