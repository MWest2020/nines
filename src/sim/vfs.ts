// Read and change the virtual filesystem. The fs is a flat map of absolute path -> node; a
// directory's children are the keys whose dirname is that directory. Scenarios hold a few
// hundred entries at most, so linear scans keep this simple and obviously correct.

import { basename, dirname, isUnder, join } from './path';
import type { FsNode, Mount, SimState } from './state';

export const node = (s: SimState, p: string): FsNode | undefined => s.fs[p];
export const isDir = (s: SimState, p: string): boolean => s.fs[p]?.type === 'dir';
export const isFile = (s: SimState, p: string): boolean => s.fs[p]?.type === 'file';

/** Child names of a directory, sorted like ls (byte order). */
export function listDir(s: SimState, dir: string): string[] {
  const names: string[] = [];
  for (const p of Object.keys(s.fs)) {
    if (p !== '/' && dirname(p) === dir) names.push(basename(p));
  }
  return names.sort();
}

/** Every path at or below p. */
export function subtree(s: SimState, p: string): string[] {
  return Object.keys(s.fs).filter((k) => isUnder(k, p));
}

export function remove(s: SimState, p: string): void {
  for (const k of subtree(s, p)) delete s.fs[k];
  if (p === '/') s.fs['/'] = { type: 'dir' };
}

export function move(s: SimState, from: string, to: string): void {
  const entries = subtree(s, from).map((k) => [k, s.fs[k]!] as const);
  for (const [k] of entries) delete s.fs[k];
  for (const [k, n] of entries) s.fs[to + k.slice(from.length)] = n;
}

/** Bytes in a file, or in all files below a directory. */
export function sizeOf(s: SimState, p: string): number {
  const n = s.fs[p];
  if (!n) return 0;
  if (n.type === 'file') return n.size;
  let total = 0;
  for (const k of subtree(s, p)) {
    const c = s.fs[k]!;
    if (c.type === 'file') total += c.size;
  }
  return total;
}

/** The mount a path lives on: the longest mount path that contains it. */
export function mountFor(s: SimState, p: string): Mount {
  let best = s.mounts[0]!;
  for (const m of s.mounts) if (isUnder(p, m.path) && m.path.length >= best.path.length) best = m;
  return best;
}

export function mountUsed(s: SimState, m: Mount): number {
  let used = m.baseUsed;
  for (const [p, n] of Object.entries(s.fs)) {
    if (n.type === 'file' && mountFor(s, p) === m) used += n.size;
  }
  return used;
}

/** Percentage of the mount holding p that is in use, as a float (df rounds it up). */
export function diskUsage(s: SimState, p: string): number {
  const m = mountFor(s, p);
  return m.size === 0 ? 100 : (mountUsed(s, m) / m.size) * 100;
}

function globToRegExp(seg: string): RegExp {
  let re = '';
  for (const ch of seg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export const hasGlob = (word: string): boolean => /[*?]/.test(word);

/**
 * Expand an absolute glob pattern (only * and ?) against the fs. Like bash, a leading
 * * or ? does not match dotfiles. Returns sorted absolute paths; empty when nothing matches.
 */
export function expandGlob(s: SimState, absPattern: string): string[] {
  const segs = absPattern.split('/').filter((x) => x !== '');
  let current = ['/'];
  for (const seg of segs) {
    const nextPaths: string[] = [];
    for (const dir of current) {
      if (!isDir(s, dir)) continue;
      if (!hasGlob(seg)) {
        const p = join(dir, seg);
        if (s.fs[p]) nextPaths.push(p);
        continue;
      }
      const re = globToRegExp(seg);
      for (const name of listDir(s, dir)) {
        if (name.startsWith('.') && !seg.startsWith('.')) continue;
        if (re.test(name)) nextPaths.push(join(dir, name));
      }
    }
    current = nextPaths;
  }
  return current.sort();
}
