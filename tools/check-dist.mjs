// After `npm run build`: scan what actually ships (dist/) for ways to reach the network or run
// strings as code. Our own src/ is guarded by tests/guards.test.ts; this covers third-party code
// (Phaser) and the bundler's output. Run: node tools/check-dist.mjs  (CI does, after the build).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = join(import.meta.dirname, '..', 'dist');

// Strings Phaser carries that are not requests: its console banner (we turn it off) and two
// XML namespace identifiers.
const ALLOWED_URLS = new Set(['https://phaser.io', 'https://phaser.io/', 'http://www.w3.org/2000/svg', 'http://www.w3.org/1999/xhtml']);

// Phaser's global-object fallback, inside try/catch; the CSP (no 'unsafe-eval') blocks it.
const ALLOWED_SNIPPETS = ['new Function("return this")'];

// xterm.js's default handler for OSC 8 hyperlinks: it asks confirm() and then opens a window.
// It cannot run here: the overlay passes its own linkHandler (activation does nothing), and no
// escape sequence can reach xterm (content has no control characters, player text is stripped).
// Matched by shape, because the minifier renames the variables.
const ALLOWED_PATTERNS = [/confirm\(`Do you want to navigate to \$\{\w+\}\?[^`]*`\)\)\{let \w+=window\.open\(\);/g];

// The service worker (src/offline/sw.js) answers from its cache and asks its own origin for a
// file it does not have, after returning early for every request to another origin. That one
// call is allowed in sw.js only, exactly once, and only with the origin check in place;
// tests/guards.test.ts checks the source the same way.
const SW = { file: 'sw.js', call: 'return await fetch(request);', guard: "new URL(request.url).origin !== self.location.origin) return;" };

// tools/content/load.ts (DIST_REFUSES) checks locale strings against the same patterns.
const BANNED = [/\bfetch\s*\(/, /\bWebSocket\b/, /\bEventSource\b/, /\bsendBeacon\b/, /\bRTCPeerConnection\b/, /window\.open\s*\(/, /\beval\s*\(/, /\bFunction\s*\(/];

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

const problems = [];
let allowedHits = 0;
const files = walk(DIST).filter((f) => /\.(js|html|css|json)$/.test(f));
if (files.length === 0) problems.push('dist/ is empty: run npm run build first');
for (const file of files) {
  let text = readFileSync(file, 'utf8');
  for (const s of ALLOWED_SNIPPETS) text = text.split(s).join('');
  for (const re of ALLOWED_PATTERNS) {
    allowedHits += (text.match(re) ?? []).length;
    text = text.replace(re, '');
  }
  const name = relative(DIST, file);
  if (name === SW.file) {
    const calls = text.split(SW.call).length - 1;
    const guardAt = text.indexOf(SW.guard);
    if (calls !== 1 || guardAt < 0 || guardAt > text.indexOf(SW.call)) problems.push(`${name}: expected one same-origin fetch after the origin check, found ${calls}`);
    text = text.split(SW.call).join('');
  }
  for (const m of text.matchAll(/https?:\/\/[A-Za-z0-9.\-_~:/?#@!$&'()*+,;=%]*/g)) {
    const url = m[0].replace(/[)'",;]+$/, '');
    if (!ALLOWED_URLS.has(url)) problems.push(`${name}: URL ${url}`);
  }
  for (const re of BANNED) if (re.test(text)) problems.push(`${name}: ${re}`);
}

// exactly one copy of the allowed xterm handler: a second one (a new addon, say) is reviewed
if (files.length > 0 && allowedHits !== 1) problems.push(`expected xterm's OSC 8 handler exactly once, found ${allowedHits}`);
// the offline promise needs the service worker
if (files.length > 0 && !files.some((f) => relative(DIST, f) === SW.file)) problems.push(`${SW.file} is missing: the game would not run offline`);

if (problems.length > 0) {
  console.error(`dist/ check failed:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(`dist/ check passed: ${files.length} files, no network APIs, no remote URLs outside the allowlist.`);
