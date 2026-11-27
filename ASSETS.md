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
| `assets/store/icon-512.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | the Google Play listing icon, 512 x 512 (PLAY_STORE.md); not shipped in the app or the site |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | Android launcher icon, 48 x 48: the player on night blue |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | round launcher icon, 48 x 48 |
| `android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | adaptive icon foreground, 108 x 108, the player inside the safe zone; the ground is a colour resource |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | Android launcher icon, 72 x 72: the player on night blue |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | round launcher icon, 72 x 72 |
| `android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | adaptive icon foreground, 162 x 162, the player inside the safe zone; the ground is a colour resource |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | Android launcher icon, 96 x 96: the player on night blue |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | round launcher icon, 96 x 96 |
| `android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | adaptive icon foreground, 216 x 216, the player inside the safe zone; the ground is a colour resource |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | Android launcher icon, 144 x 144: the player on night blue |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | round launcher icon, 144 x 144 |
| `android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | adaptive icon foreground, 324 x 324, the player inside the safe zone; the ground is a colour resource |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | Android launcher icon, 192 x 192: the player on night blue |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | round launcher icon, 192 x 192 |
| `android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png` | own work, drawn by `tools/art/draw-art.mjs` (`drawIcons`) | Nines team | CC0 1.0 | adaptive icon foreground, 432 x 432, the player inside the safe zone; the ground is a colour resource |

The Android launcher icons replace Capacitor's template icons and splash images, which are not
ours and are not shipped: the launch screen is the game's background colour
(`android/app/src/main/res/drawable/splash.xml`), with the launcher icon on Android 12+.

Only the one sheet the maps use is kept from each pack, not the whole download. The Pixel UI
Pack and Kenney Fonts are not used: the dialogue box is drawn in code in our own shape.

The sheets of Femke, Ravi and Bas (`content/quests/*/<name>.png`) are own work by the same
script and are recorded in their `npc.yaml` (source and `CC0-1.0`), as for any content sprite.
Run `node tools/art/draw-art.mjs --check` to confirm the committed PNGs match the script
(`npm test` does).

Drawn in code rather than shipped as files, all own work for Nines, released CC0 1.0: the pixel
font (`src/game/ui/font.ts`, glyphs as text rows), the UI panels, Career Trail stones and HUD icons
(`src/game/ui/`), and the shop's Raspberry Pi icon (`src/game/ui/ShopScene.ts`). The real
dialogue box (`src/game/ui/DialogueBox.ts`) replaces the world's placeholder once the game API
answers the world's events.

## Code that ships

Third-party code bundled into `dist/` (and so into the Android app), with its licence. Versions
are pinned exactly in `package.json`; ARCHITECTURE.md (Dependencies) says why each one is there.

| Package | Version | Licence | What ships |
| ------- | ------- | ------- | ---------- |
| phaser | 3.90.0 | MIT | the game engine (`dist/assets/phaser-*.js`) |
| yaml | 2.9.1 | ISC | parses the player's pipeline file in the broken-pipeline quest |
| @xterm/xterm | 6.0.0 | MIT | the terminal's output renderer and its stylesheet `css/xterm.css`, bundled into `dist/assets/index-*.js` and `index-*.css` |
| @capacitor/android | 8.6.0 | MIT | Android app only: the native shell that serves `dist/` inside the app (its Java code and `native-bridge.js`); none of its code is in the web build, only its licence text in `THIRD-PARTY-LICENSES.txt`. AndroidX libraries (Apache 2.0) come with it |

The minified bundles drop licence comments, so the build writes every runtime dependency's
licence text to `dist/THIRD-PARTY-LICENSES.txt` (`tools/vite-plugin-licenses.ts`), which ships
with the site and the app. The terminal uses the device's own monospace font: no font file
ships.
