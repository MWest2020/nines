// Where the save lives: a key-value storage passed in (localStorage in the browser, a Map in
// tests), so this file never touches `window`. It opens the save once at start-up and then
// writes it back when the game asks. A save made by a newer version of the game is never
// overwritten: not when it is found at start-up, and not when another tab running a newer
// version writes one while this one is open.

import type { LocaleId } from '../content/types';
import { type GameState, loadFrom, newGame, SAVE_KEY, SAVE_VERSION, saveTo } from './save';

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A storage in memory: the fallback when localStorage is not available, and the test fake. */
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, String(v)) };
}

/**
 * - new: there was no save; a new game started.
 * - loaded: the save was read (and migrated if it was older).
 * - recovered: the save could not be read; it was backed up and a new game started.
 * - newer: the save is from a newer version; a new game runs in memory and nothing is written.
 */
export type SaveStatus = 'new' | 'loaded' | 'recovered' | 'newer';

export interface SaveSlot {
  readonly status: SaveStatus;
  /** false once a newer save has been seen: from then on save() writes nothing */
  readonly writable: boolean;
  /** Write the game. Returns false when nothing was written (newer save, or storage refused). */
  save(game: GameState): boolean;
}

/** The format version of what is stored now, or null when there is nothing readable. */
function storedVersion(storage: KeyValueStorage): number | null {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function openSave(storage: KeyValueStorage, fallbackLocale: LocaleId, seed: number): { game: GameState; slot: SaveSlot } {
  let outcome: ReturnType<typeof loadFrom>;
  try {
    outcome = loadFrom(storage, fallbackLocale);
  } catch {
    // The storage itself failed (blocked, private mode): play on in memory.
    outcome = { kind: 'empty' };
  }
  let writable = outcome.kind !== 'newer';
  const status: SaveStatus =
    outcome.kind === 'ok' ? 'loaded' : outcome.kind === 'unreadable' ? 'recovered' : outcome.kind === 'newer' ? 'newer' : 'new';
  const game = outcome.kind === 'ok' ? outcome.game : newGame(fallbackLocale, seed);
  const slot: SaveSlot = {
    status,
    get writable() {
      return writable;
    },
    save(g) {
      if (!writable) return false;
      const v = storedVersion(storage);
      if (v !== null && v > SAVE_VERSION) {
        writable = false;
        return false;
      }
      try {
        saveTo(storage, g);
        return true;
      } catch {
        return false;
      }
    },
  };
  return { game, slot };
}
