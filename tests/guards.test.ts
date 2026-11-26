// Mechanical checks for the hard constraints. A reviewer still reads the diff; these make the
// easy mistakes impossible to merge.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ORDER } from '../src/sim/shell/commands';
import { content, ROOT } from './helpers';

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', '.git', 'coverage'].includes(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const srcFiles = walk(join(ROOT, 'src')).filter((f) => f.endsWith('.ts'));

describe('no network at runtime', () => {
  it('src/ uses no network API and no remote URL', () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|navigator\.connection|importScripts|https?:\/\//;
    const hits = srcFiles.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it('src/ never evaluates strings as code', () => {
    const banned = /\beval\s*\(|new\s+Function\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/;
    const hits = srcFiles.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it('index.html has a CSP that keeps requests on the origin', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/default-src 'self'/);
    expect(html).toMatch(/connect-src 'self'/);
    expect(html).not.toMatch(/<script[^>]+src=["']https?:/);
    expect(html).not.toMatch(/<link[^>]+href=["']https?:/);
  });
});

describe('strings live in locale files', () => {
  it('every t() key used in src/ exists in English and Dutch', () => {
    const { locales } = content();
    const keys = new Set<string>();
    for (const f of srcFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-z0-9_.]+)'/g)) keys.add(m[1]!);
    }
    for (const c of HELP_ORDER) keys.add(`help.${c}`);
    for (const k of ['help.intro', 'sh.unterminated_quote', 'sh.empty_pipe', 'sh.outage']) keys.add(k);
    const missing = [...keys].filter((k) => !(k in locales.en) || !(k in locales.nl));
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(50);
  });
});

describe('assets', () => {
  it('every binary asset outside content/ is listed in ASSETS.md', () => {
    const assets = readFileSync(join(ROOT, 'ASSETS.md'), 'utf8');
    const binary = /\.(png|jpe?g|gif|webp|svg|ogg|mp3|wav|ttf|otf|woff2?|aseprite|tsx|tmx)$/i;
    const files = walk(ROOT)
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => binary.test(f) && !f.startsWith('content/'));
    const unlisted = files.filter((f) => !assets.includes(`\`${f}\``));
    expect(unlisted).toEqual([]);
  });
});
