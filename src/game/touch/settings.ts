// The touch-controls setting (auto, on, off). It belongs to the device, not to the game, so it
// is kept apart from the save, under its own localStorage key.

import { browserStorage } from '../storage';
import type { ControlsSetting } from './layout';

const KEY = 'nines.controls';
const ORDER: readonly ControlsSetting[] = ['auto', 'on', 'off'];
const listeners = new Set<(s: ControlsSetting) => void>();
let storage: ReturnType<typeof browserStorage> | null = null;
/** one storage for the page: when localStorage is refused, the memory fallback still remembers */
const store = () => (storage ??= browserStorage());

export function controlsSetting(): ControlsSetting {
  const v = store().getItem(KEY);
  return (ORDER as readonly (string | null)[]).includes(v) ? (v as ControlsSetting) : 'auto';
}

/** auto, on, off, auto, ... Returns the new setting. */
export function cycleControlsSetting(): ControlsSetting {
  const next = ORDER[(ORDER.indexOf(controlsSetting()) + 1) % ORDER.length]!;
  try {
    store().setItem(KEY, next);
  } catch {
    // storage full or refused: the setting lasts until the page closes
  }
  for (const fn of listeners) fn(next);
  return next;
}

export function onControlsSetting(fn: (s: ControlsSetting) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
