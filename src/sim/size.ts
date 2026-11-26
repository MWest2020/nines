// Sizes in bytes. Content writes "4.2G"; df -h and du -h print the same style back.

import type { Size } from '../content/types';

const UNITS: Record<string, number> = { B: 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3, T: 1024 ** 4 };

export function parseSize(s: Size): number {
  if (typeof s === 'number') return Math.max(0, Math.floor(s));
  const m = /^(\d+(?:\.\d+)?)([BKMGT])?$/.exec(s.trim());
  if (!m) throw new Error(`bad size "${s}"`);
  return Math.floor(Number(m[1]) * UNITS[m[2] ?? 'B']!);
}

/** Like coreutils -h: powers of 1024, rounded up, one decimal below 10. */
export function formatHuman(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  const suffixes = ['K', 'M', 'G', 'T'];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < suffixes.length - 1);
  if (v < 10) {
    const r = Math.ceil(v * 10) / 10;
    return r >= 10 ? `${Math.ceil(r)}${suffixes[i]}` : `${r.toFixed(1)}${suffixes[i]}`;
  }
  return `${Math.ceil(v)}${suffixes[i]}`;
}

/** 1K blocks, as du and df print without -h. */
export const kblocks = (bytes: number): number => Math.ceil(bytes / 1024);

export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}
