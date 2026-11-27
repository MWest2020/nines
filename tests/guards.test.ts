// Mechanical checks for the hard constraints. A reviewer still reads the diff; these make the
// easy mistakes impossible to merge.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HELP_ORDER } from '../src/sim/shell/commands';
import { content, ROOT } from './helpers';

// Skipped: installed and built output, never committed (Gradle's build dirs, and the copy of
// dist/ that `npx cap sync` puts in the Android project).
const SKIP_PATHS = [join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'public')];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    if (['node_modules', 'dist', '.git', 'coverage', 'build', '.gradle'].includes(name)) return [];
    const p = join(dir, name);
    if (SKIP_PATHS.includes(p)) return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const srcFiles = walk(join(ROOT, 'src')).filter((f) => /\.(ts|js)$/.test(f));
/** The service worker's one same-origin fetch, checked on its own below; every other guard applies. */
const SW_FILE = join(ROOT, 'src', 'offline', 'sw.js');
const SW_CALL = 'return await fetch(request);';
const source = (f: string): string => (f === SW_FILE ? readFileSync(f, 'utf8').split(SW_CALL).join('') : readFileSync(f, 'utf8'));

describe('no network at runtime', () => {
  it('src/ uses no network API and no remote URL', () => {
    const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|RTCPeerConnection|navigator\.connection|importScripts|https?:\/\/|['"`]\/\/[a-z0-9]|openWindow|\.navigate\s*\(/i;
    const hits = srcFiles.filter((f) => banned.test(source(f))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it('src/ never evaluates strings as code', () => {
    const banned = /\beval\s*\(|\bFunction\s*\(|setTimeout\s*\(\s*['"`]|setInterval\s*\(\s*['"`]/;
    const hits = srcFiles.filter((f) => banned.test(source(f))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it('src/ never opens a page or navigates away (author URLs are shown as text only)', () => {
    const banned = /window\.open\s*\(|\blocation\s*\.\s*(href|assign|replace)\b|\blocation\s*=[^=]/;
    const hits = srcFiles.filter((f) => banned.test(source(f))).map((f) => relative(ROOT, f));
    expect(hits).toEqual([]);
  });
  it('the pure core has no clock and no unseeded randomness', () => {
    const banned = /Math\.random|Date\.now|new Date\b|performance\.now|crypto\.getRandomValues/;
    const pure = srcFiles.filter((f) => /[/\\]src[/\\](rules|sim|core|battle|world|terminal)[/\\]/.test(f));
    expect(pure.length).toBeGreaterThan(10);
    expect(pure.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))).toEqual([]);
  });
  it('the pure modules import no Phaser and touch no DOM or storage', () => {
    const banned = /from ['"]phaser['"]|\b(window|document|localStorage|navigator)\s*\./;
    const pure = srcFiles.filter((f) => /[/\\]src[/\\](rules|sim|core|battle|world|terminal)[/\\]/.test(f));
    expect(pure.filter((f) => banned.test(readFileSync(f, 'utf8'))).map((f) => relative(ROOT, f))).toEqual([]);
  });
  it('the service worker only asks its own origin: one fetch after the origin check, one precache of the build', () => {
    const sw = readFileSync(SW_FILE, 'utf8');
    expect(sw.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(sw).toContain(SW_CALL);
    const guard = sw.indexOf("if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;");
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(sw.indexOf(SW_CALL));
    // the only other way it reaches the network: storing the build's own (relative) files
    expect(sw.match(/\.add(All)?\s*\(/g)).toEqual(['.addAll(']);
    expect(sw).toContain('cache.addAll(FILES.map((file) => new Request(file, { cache: \'reload\' })))');
    expect(sw.match(/new Request\(/g)).toHaveLength(1);
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
    // Every quoted key-shaped literal counts, also those picked by a ternary.
    for (const f of srcFiles) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'((?:sh|help|ui)\.[a-z0-9_.]+)'/g)) keys.add(m[1]!);
    }
    for (const c of HELP_ORDER) keys.add(`help.${c}`);
    for (const k of ['help.intro', 'sh.unterminated_quote', 'sh.empty_pipe', 'sh.outage']) keys.add(k);
    const missing = [...keys].filter((k) => !(k in locales.en) || !(k in locales.nl));
    expect(missing).toEqual([]);
    expect(keys.size).toBeGreaterThan(50);
  });
});

describe('assets', () => {
  it('every binary asset outside content/ has a row in ASSETS.md with a source and a licence', () => {
    // Rows look like: | `path` | source | author | licence | notes |
    const rows = new Map<string, string[]>();
    for (const line of readFileSync(join(ROOT, 'ASSETS.md'), 'utf8').split('\n')) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      const m = /^`([^`]+)`$/.exec(cells[0] ?? '');
      if (m) rows.set(m[1]!, cells);
    }
    const binary = /\.(png|jpe?g|gif|webp|svg|ogg|mp3|wav|ttf|otf|woff2?|aseprite|tsx|tmx)$/i;
    const files = walk(ROOT)
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => binary.test(f) && !f.startsWith('content/'));
    const unlisted = files.filter((f) => {
      const cells = rows.get(f);
      return !cells || !cells[1] || !cells[3];
    });
    expect(unlisted).toEqual([]);
  });
});
