// Emits dist/sw.js: the hand-written service worker (src/offline/sw.js) with the list of built
// files to keep and a version that is a hash of all of them, so every build that changes a
// file gets a fresh cache and the old one is dropped. No dependency.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const SW_FILE = 'sw.js';

export function serviceWorker(root: string): Plugin {
  return {
    name: 'nines-sw',
    apply: 'build',
    // after the other plugins, so index.html and the licence file are in the bundle
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f !== SW_FILE && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const out = bundle[f]!;
        hash.update(f).update('\0');
        hash.update(out.type === 'chunk' ? out.code : out.source).update('\0');
      }
      const version = hash.digest('hex').slice(0, 16);
      // './' is the page itself, as a visitor opens it: the folder, not index.html
      const head = `const VERSION = ${JSON.stringify(version)};\nconst FILES = ${JSON.stringify(['./', ...files], null, 2)};\n\n`;
      const template = readFileSync(join(root, 'src', 'offline', 'sw.js'), 'utf8');
      this.emitFile({ type: 'asset', fileName: SW_FILE, source: head + template });
    },
  };
}
