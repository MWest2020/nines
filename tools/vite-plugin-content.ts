// Bundles /content into the build as `virtual:nines-content`. The YAML is parsed and validated
// here, at build time; an invalid content folder fails the build. The game receives plain JSON
// (plus same-origin URLs for sprite sheets) and never fetches content at runtime.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';
import { loadContent } from './content/load';

const VIRTUAL_ID = 'virtual:nines-content';
const RESOLVED_ID = '\0' + VIRTUAL_ID;

export function ninesContent(): Plugin {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const contentDir = join(root, 'content');
  const schemaDir = join(root, 'schemas');
  return {
    name: 'nines-content',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_ID) return null;
      this.addWatchFile(contentDir);
      const { bundle, errors, sprites } = loadContent(contentDir, schemaDir);
      if (!bundle) {
        this.error(`content is invalid:\n  ${errors.join('\n  ')}`);
      }
      const imports = sprites.map((s, i) => `import sprite${i} from ${JSON.stringify(`${s.file}?url`)};`);
      // A quest's giver sheet goes on the quest entry, a world npc's on the npc.
      const assigns = sprites.map((s, i) =>
        s.owner === 'quest'
          ? `bundle.quests.find((q) => q.id === ${JSON.stringify(s.id)}).spriteUrl = sprite${i};`
          : `bundle.npcs.find((n) => n.id === ${JSON.stringify(s.id)}).spriteUrl = sprite${i};`,
      );
      return [...imports, `const bundle = ${JSON.stringify(bundle)};`, ...assigns, 'export default bundle;'].join('\n');
    },
  };
}
