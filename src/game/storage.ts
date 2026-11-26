// The browser side of saving: localStorage when the browser allows it, otherwise a storage in
// memory (private windows and blocked site data throw on access), so the game always starts.

import { type KeyValueStorage, memoryStorage } from '../core/persist';

export function browserStorage(): KeyValueStorage {
  try {
    const ls = globalThis.localStorage;
    const probe = 'nines.probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return memoryStorage();
  }
}

/** A seed for a new game. Only the game layer may use randomness; the pure core takes it as input. */
export const newSeed = (): number => Math.floor(Math.random() * 0x1_0000_0000) >>> 0;
