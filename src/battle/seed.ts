// Seeded, deterministic "randomness" for battles: the order in which answer cards are shown
// and whether a pager goes off. The same key always gives the same result, so a battle is
// testable end to end and two players with the same save see the same thing. No unseeded
// random numbers, no clock.

/** FNV-1a, 32 bits: a stable hash of a string. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: a small PRNG with a 32-bit state, giving numbers in [0, 1). */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates with a seeded PRNG; returns a new array. */
export function shuffle<T>(xs: readonly T[], key: string): T[] {
  const out = [...xs];
  const next = prng(hash32(key));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A number from 0 to 99 for a key: a seeded percentage roll. */
export const roll = (key: string): number => Math.floor(prng(hash32(key))() * 100);
