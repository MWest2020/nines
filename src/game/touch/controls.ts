// The page layout and the on-screen controls (DESIGN.md, Mobile controls): the canvas scaled by
// a whole number where it fits, and on touch screens or narrow windows a D-pad, a use button, a
// back button and big menu and Career Trail buttons around it. DOM, not canvas, so the targets
// are real CSS pixels (48 or more) whatever the canvas scale. Our own design: drawn icons,
// never letters standing for controller buttons.
//
// Input goes out as the held direction (padState, read by the world each frame) and as events on
// game.events (PAD_EVENTS), which the HUD, the menu and the screens handle like their keys.

import type Phaser from 'phaser';
import type { GameApi } from '../api';
import type { Facing } from '../../world/grid';
import { computeLayout, controlsShown, type Insets, type Layout, type Rect } from './layout';
import { PAD_EVENTS, padState } from './pad';
import { controlsSetting, onControlsSetting } from './settings';
import './touch.css';

/** Icons on a 16 x 16 pixel grid: rectangles [x, y, w, h], drawn crisp like the game's art. */
const ICONS: Record<string, readonly (readonly number[])[]> = {
  up: [[7, 3, 2, 1], [6, 4, 4, 1], [5, 5, 6, 1], [4, 6, 8, 1], [3, 7, 10, 2]],
  down: [[3, 7, 10, 2], [4, 9, 8, 1], [5, 10, 6, 1], [6, 11, 4, 1], [7, 12, 2, 1]],
  left: [[3, 7, 1, 2], [4, 6, 1, 4], [5, 5, 1, 6], [6, 4, 1, 8], [7, 3, 2, 10]],
  right: [[7, 3, 2, 10], [9, 4, 1, 8], [10, 5, 1, 6], [11, 6, 1, 4], [12, 7, 1, 2]],
  // an open hand: use, talk
  use: [[3, 3, 2, 6], [6, 2, 2, 7], [9, 2, 2, 7], [12, 4, 2, 5], [3, 8, 11, 5], [4, 13, 9, 1], [1, 7, 2, 2], [2, 9, 1, 2]],
  // a turn-back arrow
  back: [[2, 5, 1, 2], [3, 4, 1, 4], [4, 3, 1, 6], [5, 5, 7, 2], [12, 6, 2, 5], [6, 11, 7, 2]],
  // three bars: the menu
  menu: [[3, 4, 10, 2], [3, 7, 10, 2], [3, 10, 10, 2]],
  // a milestone stone on a path: the Career Trail
  trail: [[1, 8, 14, 1], [7, 3, 2, 1], [6, 4, 4, 1], [5, 5, 6, 1], [4, 6, 8, 2], [5, 8, 6, 1], [6, 9, 4, 1], [7, 10, 2, 1]],
};

/** An icon as pixel blocks: spans placed in sixteenths of a square box, coloured by CSS. */
function icon(name: string): HTMLSpanElement {
  const box = document.createElement('span');
  box.className = 'tc-icon';
  box.setAttribute('aria-hidden', 'true');
  for (const [x, y, w, h] of ICONS[name] ?? []) {
    const px = document.createElement('span');
    px.style.left = `${(x! / 16) * 100}%`;
    px.style.top = `${(y! / 16) * 100}%`;
    px.style.width = `${(w! / 16) * 100}%`;
    px.style.height = `${(h! / 16) * 100}%`;
    box.append(px);
  }
  return box;
}

const REPEAT_DELAY = 350;
const REPEAT_EVERY = 160;

export interface TouchHooks {
  /** open or close the HUD menu */
  toggleMenu(): void;
}

/** True on a device with a touch screen. */
export function isTouchDevice(): boolean {
  return (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) || navigator.maxTouchPoints > 0;
}

/** The safe-area insets (notches, gesture bar), read from CSS env() through a probe. */
function readInsets(probe: HTMLElement): Insets {
  const cs = getComputedStyle(probe);
  const px = (v: string) => Number.parseFloat(v) || 0;
  return { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
}

const place = (el: HTMLElement, r: Rect) => {
  el.style.left = `${r.x}px`;
  el.style.top = `${r.y}px`;
  el.style.width = `${r.w}px`;
  el.style.height = `${r.h}px`;
};

export function installTouchControls(game: Phaser.Game, api: GameApi, hooks: TouchHooks, parent: HTMLElement = document.body): () => Layout {
  const t = api.t;
  const gameEl = game.canvas?.parentElement ?? document.getElementById('game')!;

  const probe = document.createElement('div');
  probe.className = 'tc-insets';
  const root = document.createElement('div');
  root.className = 'tc';
  root.hidden = true;
  // a long press must not open the context menu or start a text selection
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  const button = (cls: string, name: string, label: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.tabIndex = -1; // a touch aid: the keyboard has its own keys
    b.dataset.label = label;
    b.setAttribute('aria-label', t(label));
    b.append(icon(name));
    return b;
  };

  // ---- the D-pad: one element, the direction from where the finger is, so sliding works
  const dpad = document.createElement('div');
  dpad.className = 'tc-dpad';
  dpad.setAttribute('role', 'group');
  dpad.dataset.label = 'ui.pad.dpad';
  dpad.setAttribute('aria-label', t('ui.pad.dpad'));
  const arms = {} as Record<Facing, HTMLButtonElement>;
  for (const f of ['up', 'left', 'right', 'down'] as const) {
    arms[f] = button(`tc-arm tc-${f}`, f, `ui.pad.${f}`);
    dpad.append(arms[f]);
  }
  dpad.append(Object.assign(document.createElement('span'), { className: 'tc-hub' }));

  let pointer: number | null = null;
  let repeat: ReturnType<typeof setTimeout> | null = null;
  const stopRepeat = () => {
    if (repeat !== null) clearTimeout(repeat);
    repeat = null;
  };
  const hold = (dir: Facing | null) => {
    if (dir === padState.held) return;
    padState.held = dir;
    for (const f of Object.keys(arms) as Facing[]) arms[f].classList.toggle('tc-on', f === dir);
    stopRepeat();
    if (!dir) return;
    game.events.emit(PAD_EVENTS.move, dir);
    const again = (delay: number) => {
      repeat = setTimeout(() => {
        if (padState.held !== dir) return;
        game.events.emit(PAD_EVENTS.move, dir);
        again(REPEAT_EVERY);
      }, delay);
    };
    again(REPEAT_DELAY);
  };
  const dirAt = (e: PointerEvent): Facing | null => {
    const r = dpad.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < r.width / 10) return null; // the hub: a dead zone
    return Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
  };
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    pointer = e.pointerId;
    dpad.setPointerCapture?.(e.pointerId);
    hold(dirAt(e));
  });
  dpad.addEventListener('pointermove', (e) => {
    if (e.pointerId === pointer) hold(dirAt(e));
  });
  const lift = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    pointer = null;
    hold(null);
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) dpad.addEventListener(ev, lift);

  // ---- use and back, menu and Career Trail: act on the press, never take focus
  const press = (b: HTMLButtonElement, fn: () => void) => {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.classList.add('tc-on');
      fn();
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(ev, () => b.classList.remove('tc-on'));
  };
  const actions = document.createElement('div');
  actions.className = 'tc-actions';
  const use = button('tc-btn tc-use', 'use', 'ui.pad.use');
  const back = button('tc-btn tc-back', 'back', 'ui.pad.back');
  press(use, () => game.events.emit(PAD_EVENTS.use));
  press(back, () => game.events.emit(PAD_EVENTS.back));
  actions.append(use, back);

  const system = document.createElement('div');
  system.className = 'tc-system';
  const menu = button('tc-btn tc-menu', 'menu', 'ui.menu.title');
  const trail = button('tc-btn tc-trail', 'trail', 'ui.roadmap.title');
  press(menu, () => hooks.toggleMenu());
  press(trail, () => {
    if (!api.isBusy()) void api.openTrail();
  });
  system.append(menu, trail);

  root.append(dpad, actions, system);
  parent.append(probe, root);

  // ---- layout: on every resize, rotation, and change of the setting
  let current = computeLayout(window.innerWidth, window.innerHeight, false);
  const layout = (): Layout => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const shown = controlsShown(controlsSetting(), isTouchDevice(), w);
    current = computeLayout(w, h, shown, readInsets(probe));
    place(gameEl, current.game);
    root.hidden = !shown;
    root.dataset.mode = current.mode;
    if (current.dpad) place(dpad, current.dpad);
    if (current.actions) place(actions, current.actions);
    if (current.system) place(system, current.system);
    document.documentElement.dataset.layout = current.mode;
    if (!shown) hold(null);
    // Phaser's refresh() reuses the parent size it measured last; measure #game again first
    game.scale.getParentBounds();
    game.scale.refresh();
    return current;
  };
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', layout);
  onControlsSetting(layout);
  // the labels follow the NL/EN toggle
  api.store.subscribe((_g, change) => {
    if (change.kind !== 'locale') return;
    for (const el of root.querySelectorAll<HTMLElement>('[data-label]')) el.setAttribute('aria-label', t(el.dataset.label!));
  });
  // a finger lifted outside the page (or the app sent to the background) lets go of the D-pad
  window.addEventListener('blur', () => hold(null));
  layout();
  return () => current;
}
