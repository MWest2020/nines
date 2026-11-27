// Ships the licence texts of the runtime dependencies as dist/THIRD-PARTY-LICENSES.txt, because
// MIT and ISC ask for their notices in every copy (the web build and the Android app). The
// minified bundles drop the licence comments, so this file is where the notices live.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export function thirdPartyLicenses(root: string): Plugin {
  return {
    name: 'nines-licenses',
    apply: 'build',
    generateBundle() {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string> };
      const parts = Object.keys(pkg.dependencies ?? {})
        .sort()
        .map((name) => {
          const dir = join(root, 'node_modules', name);
          const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string; license?: string };
          const file = readdirSync(dir).find((f) => /^licen[cs]e(\.md|\.txt)?$/i.test(f));
          if (!file) throw new Error(`${name} ships no licence file`);
          const text = readFileSync(join(dir, file), 'utf8').trim();
          return `${name} ${meta.version} (${meta.license ?? 'see below'})\n${'-'.repeat(60)}\n${text}\n`;
        });
      const intro = 'Nines bundles the following third-party code. Their licences follow.\n\n';
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: intro + parts.join('\n') });
    },
  };
}
