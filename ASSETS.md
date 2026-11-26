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
| `assets/kenney/rpg-urban-pack/tilemap_packed.png` | RPG Urban Pack 1.0, https://kenney.nl/assets/rpg-urban-pack (`Tilemap/tilemap_packed.png` from the zip downloaded 26 Nov 2026, sha256 of the zip `4541d89d639fc7d1e905dd925e55b1c4977a41d983516228db1d57173bb9afaf`) | Kenney (kenney.nl) | CC0 1.0 | unmodified; Kenney's `License.txt` is next to it. Streets, buildings, doors, windows, lamps, benches, water. |
| `assets/kenney/tiny-town/tilemap_packed.png` | Tiny Town 1.1, https://kenney.nl/assets/tiny-town (`Tilemap/tilemap_packed.png` from the zip downloaded 26 Nov 2026, sha256 of the zip `9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977`) | Kenney (kenney.nl) | CC0 1.0 | unmodified; `License.txt` next to it. Grass, trees, paths, a signpost. |
| `assets/kenney/roguelike-indoors/roguelikeIndoor_transparent.png` | Roguelike Indoors (version not stated in the pack or its License.txt), https://kenney.nl/assets/roguelike-indoors (`Tilesheets/roguelikeIndoor_transparent.png` from the zip downloaded 26 Nov 2026, sha256 of the zip `578cfdb066c4a9de78a52535adaf953728889b2cf268441bd4d338844f7aa586`) | Kenney (kenney.nl) | CC0 1.0 | unmodified; `License.txt` next to it. Tables, chairs, cabinets, plants. 16 px tiles with 1 px spacing. |
| `assets/tiles/nines-tiles.png` | own work, drawn by `tools/art/draw-art.mjs` | Nines team | CC0 1.0 | server racks (two LED states), laptop, raised floor, server-room wall, whiteboard, Raspberry Pi, exit mat, monitor, and the collision marker of the hidden collision layer |
| `assets/sprites/player.png` | own work, drawn by `tools/art/draw-art.mjs` | Nines team | CC0 1.0 | the player: 3 x 4 frames of 16 x 16 |
| `assets/sprites/npc-placeholder.png` | own work, drawn by `tools/art/draw-art.mjs` | Nines team | CC0 1.0 | the placeholder NPC; its mist and grey clothes are recoloured with the `tint` of an `npc.yaml` that has no sheet |

Only the one sheet the maps use is kept from each pack, not the whole download. The Pixel UI
Pack and Kenney Fonts are not used: the dialogue box is drawn in code in our own shape.

The sheets of Femke, Ravi and Bas (`content/quests/*/<name>.png`) are own work by the same
script and are recorded in their `npc.yaml` (source and `CC0-1.0`), as for any content sprite.
Run `node tools/art/draw-art.mjs --check` to confirm the committed PNGs match the script
(`npm test` does).
