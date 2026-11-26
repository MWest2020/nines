# Assets

**The rule.** Every image, sound, font and map tile in this repository is either our own work
or CC0. Nothing that could be recognised as Nintendo or Pokémon: no sprites, names, sounds, UI
or creatures. Each file gets a row here before it is committed: its path, where it came from,
and its licence. `npm test` fails when a binary file outside `content/` is missing from this
table. A sprite inside a `content/` quest folder records its source and licence in that
folder's `npc.yaml` instead, so a guest cameo stays one folder: the validator refuses any PNG
in `content/` that no `npc.yaml` declares with a source and the licence `CC0-1.0`, and the
credits screen lists every sprite with its source. (Waiting on Mark:
https://github.com/MWest2020/nines/issues/2; default as described.)

Kenney packs: record the pack name, its URL and the version you downloaded, and keep Kenney's
`License.txt` next to the files.

| File | Source | Author | Licence | Notes |
| ---- | ------ | ------ | ------- | ----- |

(No asset files yet. The planned packs are listed in DESIGN.md.)

Drawn in code rather than shipped as files, all own work for Nines, released CC0 1.0: the pixel
font (`src/game/ui/font.ts`, glyphs as text rows), the UI panels, Career Trail stones and HUD icons
(`src/game/ui/`), and the Raspberry Pi in the shop (`src/game/ui/ShopScene.ts`).
