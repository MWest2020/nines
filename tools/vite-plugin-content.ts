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
      const { bundle, errors, sprites, tilesets } = loadContent(contentDir, schemaDir, { root });
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
      // Tileset images: one import per file, then each map gets tileset name -> URL.
      const files = [...new Set(tilesets.map((t) => t.file))];
      const tileImports = files.map((f, i) => `import tiles${i} from ${JSON.stringify(`${f}?url`)};`);
      const tileAssigns = tilesets.map(
        (t) =>
          `(bundle.maps.find((m) => m.id === ${JSON.stringify(t.map)}).images ??= {})[${JSON.stringify(t.name)}] = tiles${files.indexOf(t.file)};`,
      );
      for (const f of files) this.addWatchFile(f);
      return [...imports, ...tileImports, `const bundle = ${JSON.stringify(bundle)};`, ...assigns, ...tileAssigns, 'export default bundle;'].join('\n');
    },
  };
}
