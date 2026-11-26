// Buttons and keyboard focus for the UI screens. Focus is a gold outline around the whole
// button, never a cursor triangle; buttons carry words or drawn icons, never letters standing
// for controller buttons (DESIGN.md, What we never do).

import Phaser from 'phaser';
import { measure, sanitize } from './font';
import { pixelFont } from './pixelfont';
import { C, hex } from './theme';
import type { Dir, Focusable } from './nav';

export type { Dir, Focusable } from './nav';
export { navigate } from './nav';

export interface Button extends Focusable {
  objects: Phaser.GameObjects.GameObject[];
  enabled: boolean;
  setFocus(on: boolean): void;
  setLabel(text: string, color?: string): void;
  activate(): void;
}

export const buttonWidth = (label: string): number => measure(label) + 10;

/** A framed button with a word on it. */
export function button(scene: Phaser.Scene, x: number, y: number, label: string, onPress: () => void, opts: { w?: number; color?: string } = {}): Button {
  const w = opts.w ?? buttonWidth(label);
  const h = 13;
  const g = scene.add.graphics();
  const text = scene.add.bitmapText(x + 5, y + 2, pixelFont(scene, opts.color ?? C.paper), sanitize(label));
  const zone = scene.add.zone(x, y, w, h).setOrigin(0).setInteractive({ useHandCursor: true });
  const draw = (focus: boolean) => {
    g.clear();
    g.fillStyle(hex(C.shadow), 1).fillRect(x, y, w, h);
    g.lineStyle(1, hex(focus ? C.gold : C.slate), 1).strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  };
  draw(false);
  const b: Button = {
    x,
    y,
    w,
    h,
    objects: [g, text, zone],
    enabled: true,
    setFocus: draw,
    setLabel(t, color) {
      text.setFont(pixelFont(scene, color ?? opts.color ?? C.paper));
      text.setText(sanitize(t));
    },
    activate() {
      if (b.enabled) onPress();
    },
  };
  zone.on('pointerdown', () => b.activate());
  return b;
}

/**
 * Phaser can hand the same DOM key event to a listener more than once when several keys arrive
 * within one frame (it re-reads its queue), and a listener added while that happens also gets
 * the earlier keys. Wrap a listener with this: it sees each event once, and only events that
 * happened after it was set up (so the Enter that opened a screen does not also press its
 * first button). Keys typed into a DOM field (the terminal, the editor) are left alone.
 */
/** True while the player types in a DOM field (the terminal's input, the editor): keys are theirs. */
function typingInDom(): boolean {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el instanceof HTMLElement && el.isContentEditable);
}

export function freshKeys(fn: (e: KeyboardEvent) => void): (e: KeyboardEvent) => void {
  const since = performance.now();
  const seen = new WeakSet<KeyboardEvent>();
  return (e) => {
    if (e.timeStamp < since || seen.has(e) || typingInDom()) return;
    seen.add(e);
    fn(e);
  };
}

/**
 * Keyboard for a screen: arrows or WASD move focus, Enter or Space presses, Escape backs out.
 * Returns a function that removes the listeners.
 */
export function keyboardNav(scene: Phaser.Scene, handlers: { move: (d: Dir) => void; press: () => void; back: () => void }): () => void {
  const kb = scene.input.keyboard;
  if (!kb) return () => {};
  const map: Record<string, () => void> = {
    ArrowUp: () => handlers.move('up'),
    KeyW: () => handlers.move('up'),
    ArrowDown: () => handlers.move('down'),
    KeyS: () => handlers.move('down'),
    ArrowLeft: () => handlers.move('left'),
    KeyA: () => handlers.move('left'),
    ArrowRight: () => handlers.move('right'),
    KeyD: () => handlers.move('right'),
    Enter: handlers.press,
    Space: handlers.press,
    Escape: handlers.back,
  };
  const onKey = freshKeys((e: KeyboardEvent) => {
    const f = Object.hasOwn(map, e.code) ? map[e.code] : undefined;
    if (f) {
      e.preventDefault();
      f();
    }
  });
  kb.on('keydown', onKey);
  return () => kb.off('keydown', onKey);
}
