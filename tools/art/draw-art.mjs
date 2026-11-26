// Draws Nines' own pixel art: the player, the three Junior Village NPCs, the tinted placeholder
// NPC and our own tiles (server racks, laptop, raised floor, ...). Everything is own work,
// released CC0, in the 26-colour palette of DESIGN.md. Re-running this script rebuilds the
// same pixels, so the PNGs in the repository are reproducible from this file.
//
//   node tools/art/draw-art.mjs           write the PNGs
//   node tools/art/draw-art.mjs --check   exit 1 when a committed PNG differs from this script
//
// A character sheet is 3 columns (step, stand, step) x 4 rows (down, left, right, up) of 16 x 16
// frames: 48 x 64 px (DESIGN.md, Sizes; the content validator enforces it).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---- the palette (DESIGN.md): every channel is a multiple of 8
export const PALETTE = {
  ink: '#101820', shadow: '#283840', slate: '#485860', grey: '#788890', mist: '#b0b8b8', paper: '#f8f0d8',
  deepGreen: '#183020', forest: '#306838', grass: '#58a058', leaf: '#88c070', bark: '#604830', wood: '#987048', sand: '#d0a868',
  night: '#183048', water: '#2860a0', sky: '#4880c8', ice: '#88b8e8',
  brick: '#882828', clay: '#c86848', orange: '#e89858', gold: '#f8d070',
  plum: '#683878', lilac: '#a868a8',
  screen: '#081008', phosphor: '#88e090',
};
const P = PALETTE;

function rgba(hex, alpha = 255) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

function image(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function set(img, x, y, hex, alpha = 255) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  img.data.set(rgba(hex, alpha), (y * img.width + x) * 4);
}

function rect(img, x, y, w, h, hex, alpha = 255) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(img, i, j, hex, alpha);
}

/** Draw a 16-row pattern at (ox, oy); each character picks a colour from `colours`, '.' is empty. */
function pattern(img, ox, oy, rows, colours, mirror = false) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      const c = colours[ch];
      if (c === undefined) throw new Error(`no colour for "${ch}"`);
      set(img, ox + (mirror ? row.length - 1 - x : x), oy + y, c);
    });
  });
}

// ---- characters
//
// O outline, H hair, h hair shade, S skin, s skin shade, E eye, C top, c top shade, A accent,
// P trousers, p trousers shade, F shoes. Rows 0-12 are the head and body; rows 13-15 the legs,
// which change per frame.

const BODY = {
  down: [
    '................',
    '.....OOOOOO.....',
    '....OHHHHHHO....',
    '...OHHHHHHHhO...',
    '...OHHHHHHHhO...',
    '...OHSSSSSShO...',
    '...OSESSSSESO...',
    '...OSESSSSESO...',
    '....OSSSSssO....',
    '...OcCCCCCCcO...',
    '..OcOCCCCCCOcO..',
    '..OcOCCCCCCOcO..',
    '..OSOCCCCCCOSO..',
  ],
  left: [
    '................',
    '.....OOOOOO.....',
    '....OHHHHHHO....',
    '...OHHHHHHHhO...',
    '...OHHHHHHHhO...',
    '...OSSSHHHHhO...',
    '..OSESSShHHhO...',
    '..OSESSSShHhO...',
    '...OOSSSSshO....',
    '....OcCCCCcO....',
    '....OCcCCCCO....',
    '....OCcCCCCO....',
    '....OCSCCCcO....',
  ],
  up: [
    '................',
    '.....OOOOOO.....',
    '....OHHHHHHO....',
    '...OHHHHHHHhO...',
    '...OHHHHHHHhO...',
    '...OHHHHHHHhO...',
    '...OHHHHHHHhO...',
    '...OhHHHHHHhO...',
    '....OhhhhhhO....',
    '...OcCCCCCCcO...',
    '..OcOCCCCCCOcO..',
    '..OcOCCCCCCOcO..',
    '..OSOCCCCCCOSO..',
  ],
};

// legs per direction: [step, stand, step]
const LEGS = {
  down: [
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OFFO.OOO....'],
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OFFOOFFO....'],
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OOO.OFFO....'],
  ],
  left: [
    ['....OPPPPPpO....', '...OPPO.OPpO....', '...OFFO..OFFO...'],
    ['....OPPPPPpO....', '.....OPPPpO.....', '.....OFFFFO.....'],
    ['....OPPPPPpO....', '....OPPOPpO.....', '....OFFOFFO.....'],
  ],
  up: [
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OFFO.OOO....'],
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OFFOOFFO....'],
    ['...OPPPPPPPpO...', '....OPPOOPpO....', '....OOO.OFFO....'],
  ],
};

// In a step frame the arms swing: the hand of the leading side moves up one row.
function armSwing(rows, dir, step) {
  if (dir === 'left' || step === 1) return rows;
  const r = rows.map((x) => [...x]);
  const side = step === 0 ? 2 : 13; // which hand leads
  r[12][side] = 'O';
  r[11][side] = 'S';
  return r.map((x) => x.join(''));
}

/**
 * Per-character changes on top of the body: hair styles, glasses, a beard, headphones.
 * Each is a list of [direction, row, column, character] edits ('*' = all directions but up).
 */
const STYLES = {
  short: [],
  bun: [
    ['down', 0, 6, 'O'], ['down', 0, 7, 'O'], ['down', 0, 8, 'O'], ['down', 0, 9, 'O'],
    ['down', 1, 6, 'H'], ['down', 1, 7, 'H'], ['down', 1, 8, 'H'], ['down', 1, 9, 'h'],
    ['down', 6, 4, 'H'], ['down', 7, 4, 'H'], ['down', 6, 11, 'h'], ['down', 7, 11, 'h'],
    ['up', 0, 6, 'O'], ['up', 0, 7, 'O'], ['up', 0, 8, 'O'], ['up', 0, 9, 'O'],
    ['up', 1, 6, 'H'], ['up', 1, 7, 'H'], ['up', 1, 8, 'H'], ['up', 1, 9, 'h'],
    ['up', 8, 5, 'H'], ['up', 8, 10, 'h'],
    ['left', 0, 8, 'O'], ['left', 0, 9, 'O'], ['left', 0, 10, 'O'],
    ['left', 1, 8, 'H'], ['left', 1, 9, 'H'], ['left', 1, 10, 'h'],
    ['left', 8, 10, 'H'], ['left', 9, 10, 'h'],
  ],
  glasses: [
    ['down', 6, 4, 'A'], ['down', 6, 6, 'A'], ['down', 6, 9, 'A'], ['down', 6, 11, 'A'],
    ['down', 6, 7, 'O'], ['down', 6, 8, 'O'],
    ['left', 6, 4, 'A'], ['left', 6, 5, 'O'], ['left', 6, 6, 'O'],
  ],
  beard: [
    ['down', 7, 4, 'H'], ['down', 7, 11, 'h'], ['down', 8, 5, 'H'], ['down', 8, 6, 'H'], ['down', 8, 7, 'H'], ['down', 8, 8, 'H'], ['down', 8, 9, 'h'], ['down', 8, 10, 'h'],
    ['left', 7, 4, 'H'], ['left', 7, 5, 'H'], ['left', 8, 5, 'H'], ['left', 8, 6, 'H'], ['left', 8, 7, 'H'], ['left', 8, 8, 'h'],
  ],
  headphones: [
    ['down', 2, 4, 'A'], ['down', 1, 5, 'A'], ['down', 1, 10, 'A'], ['down', 2, 11, 'A'],
    ['down', 5, 3, 'A'], ['down', 6, 3, 'A'], ['down', 5, 12, 'A'], ['down', 6, 12, 'A'],
    ['up', 2, 4, 'A'], ['up', 1, 5, 'A'], ['up', 1, 10, 'A'], ['up', 2, 11, 'A'],
    ['up', 5, 3, 'A'], ['up', 6, 3, 'A'], ['up', 5, 12, 'A'], ['up', 6, 12, 'A'],
    ['left', 1, 7, 'A'], ['left', 1, 8, 'A'], ['left', 2, 8, 'A'], ['left', 3, 8, 'A'], ['left', 4, 8, 'A'], ['left', 5, 8, 'A'], ['left', 6, 8, 'A'], ['left', 5, 9, 'A'], ['left', 6, 9, 'A'],
  ],
  lanyard: [
    ['down', 10, 8, 'A'], ['down', 9, 7, 'A'], ['down', 11, 8, 'A'],
  ],
};

export const CHARACTERS = {
  player: {
    file: 'assets/sprites/player.png',
    styles: ['short', 'headphones'],
    colours: { H: P.shadow, h: P.ink, S: P.orange, s: P.clay, C: P.grey, c: P.slate, A: P.gold, P: P.night, p: P.ink, F: P.brick },
  },
  femke: {
    file: 'content/quests/disk-full/femke.png',
    styles: ['bun', 'lanyard'],
    colours: { H: P.bark, h: P.shadow, S: P.orange, s: P.clay, C: P.clay, c: P.brick, A: P.gold, P: P.slate, p: P.shadow, F: P.ink },
  },
  ravi: {
    file: 'content/quests/broken-pipeline/ravi.png',
    styles: ['short', 'glasses'],
    colours: { H: P.shadow, h: P.ink, S: P.wood, s: P.bark, C: P.sky, c: P.water, A: P.ice, P: P.sand, p: P.wood, F: P.bark },
  },
  bas: {
    file: 'content/quests/service-down/bas.png',
    styles: ['short', 'beard'],
    colours: { H: P.gold, h: P.sand, S: P.orange, s: P.clay, C: P.grass, c: P.forest, A: P.gold, P: P.night, p: P.ink, F: P.slate },
  },
  // Clothes in mist and grey are recoloured at runtime with the npc.yaml `tint`.
  placeholder: {
    file: 'assets/sprites/npc-placeholder.png',
    styles: ['short'],
    colours: { H: P.slate, h: P.shadow, S: P.sand, s: P.wood, C: P.mist, c: P.grey, A: P.mist, P: P.shadow, p: P.ink, F: P.ink },
  },
};

const ROWS = ['down', 'left', 'right', 'up'];

function frameRows(dir, step, styles) {
  const base = dir === 'right' ? 'left' : dir;
  const body = BODY[base].map((r) => [...r]);
  for (const s of styles) {
    for (const [d, row, col, ch] of STYLES[s]) if (d === base) body[row][col] = ch;
  }
  return [...armSwing(body.map((r) => r.join('')), base, step), ...LEGS[base][step]];
}

export function drawCharacter(spec) {
  const img = image(48, 64);
  const colours = { O: P.ink, E: P.ink, ...spec.colours };
  ROWS.forEach((dir, row) => {
    for (let step = 0; step < 3; step++) {
      pattern(img, step * 16, row * 16, frameRows(dir, step, spec.styles), colours, dir === 'right');
    }
  });
  return img;
}

// ---- our own tiles: 8 columns x 2 rows of 16 x 16 (assets/tiles/nines-tiles.png)
//
//  0 collision marker (hidden layer)  1 rack top, LEDs a  2 rack top, LEDs b  3 rack bottom, LEDs a
//  4 rack bottom, LEDs b  5 laptop  6 raised floor  7 raised floor, vent  8 wall, upper
//  9 wall, lower  10 whiteboard  11 dark edge  12 Raspberry Pi  13 exit mat  14 desk monitor

export const TILE_NAMES = [
  'collision', 'rack-top-a', 'rack-top-b', 'rack-bottom-a', 'rack-bottom-b', 'laptop', 'floor', 'floor-vent',
  'wall-upper', 'wall-lower', 'whiteboard', 'edge', 'raspberry-pi', 'exit-mat', 'monitor', 'empty',
];

function rackFront(img, ox, oy, fromRow, toRow, blink) {
  rect(img, ox + 1, oy + fromRow, 14, toRow - fromRow, P.ink);
  rect(img, ox + 2, oy + fromRow, 12, toRow - fromRow, P.shadow);
  for (let y = fromRow; y < toRow; y++) {
    const unit = (y + 16 - fromRow) % 4; // a 4-pixel server unit
    if (unit === 1 || unit === 2) {
      rect(img, ox + 3, oy + y, 10, 1, unit === 1 ? P.slate : P.slate);
      if (unit === 1) {
        const on = ((y >> 2) + (blink ? 1 : 0)) % 2 === 0;
        set(img, ox + 4, oy + y, on ? P.phosphor : P.forest);
        set(img, ox + 6, oy + y, on ? P.forest : P.orange);
        rect(img, ox + 8, oy + y, 4, 1, P.grey);
      } else {
        rect(img, ox + 8, oy + y, 4, 1, P.shadow);
      }
    }
  }
}

function drawRackTop(img, ox, oy, blink) {
  // top face of the rack, seen from above
  rect(img, ox + 1, oy + 0, 14, 4, P.ink);
  rect(img, ox + 2, oy + 1, 12, 2, P.grey);
  rect(img, ox + 2, oy + 1, 12, 1, P.mist);
  rackFront(img, ox, oy, 4, 16, blink);
}

function drawRackBottom(img, ox, oy, blink) {
  rackFront(img, ox, oy, 0, 12, blink);
  rect(img, ox + 1, oy + 12, 14, 3, P.ink);
  rect(img, ox + 2, oy + 12, 12, 1, P.slate);
  rect(img, ox + 1, oy + 15, 2, 1, P.ink);
  rect(img, ox + 13, oy + 15, 2, 1, P.ink);
}

export function drawTiles() {
  const img = image(128, 32);
  const at = (i) => [(i % 8) * 16, Math.floor(i / 8) * 16];
  let ox;
  let oy;

  // 0 collision: hatched, half transparent; only visible in Tiled
  [ox, oy] = at(0);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if ((x + y) % 4 === 0 || x === 0 || y === 0 || x === 15 || y === 15) set(img, ox + x, oy + y, P.brick, 160);

  // 1-4 server rack, 16 x 32, in two LED states
  [ox, oy] = at(1);
  drawRackTop(img, ox, oy, false);
  [ox, oy] = at(2);
  drawRackTop(img, ox, oy, true);
  [ox, oy] = at(3);
  drawRackBottom(img, ox, oy, false);
  [ox, oy] = at(4);
  drawRackBottom(img, ox, oy, true);

  // 5 laptop, open, screen towards the viewer, a terminal on it
  [ox, oy] = at(5);
  rect(img, ox + 3, oy + 2, 10, 8, P.ink);
  rect(img, ox + 4, oy + 3, 8, 6, P.screen);
  rect(img, ox + 5, oy + 4, 4, 1, P.phosphor);
  rect(img, ox + 5, oy + 6, 6, 1, P.phosphor);
  rect(img, ox + 5, oy + 8, 2, 1, P.ice);
  rect(img, ox + 2, oy + 10, 12, 4, P.ink);
  rect(img, ox + 3, oy + 10, 10, 3, P.mist);
  for (let x = 4; x < 12; x += 2) set(img, ox + x, oy + 11, P.grey);
  rect(img, ox + 6, oy + 12, 4, 1, P.grey);

  // 6 raised floor; 7 raised floor with a vent
  for (const [i, vent] of [[6, false], [7, true]]) {
    [ox, oy] = at(i);
    rect(img, ox, oy, 16, 16, P.grey);
    rect(img, ox, oy, 16, 1, P.mist);
    rect(img, ox, oy, 1, 16, P.mist);
    rect(img, ox, oy + 15, 16, 1, P.slate);
    rect(img, ox + 15, oy, 1, 16, P.slate);
    if (vent) for (let y = 4; y < 12; y += 2) for (let x = 4; x < 12; x += 2) set(img, ox + x, oy + y, P.shadow);
  }

  // 8, 9 the server room's back wall, two tiles high
  [ox, oy] = at(8);
  rect(img, ox, oy, 16, 16, P.slate);
  rect(img, ox, oy, 16, 3, P.ink);
  rect(img, ox, oy + 3, 16, 1, P.shadow);
  rect(img, ox + 15, oy + 4, 1, 12, P.shadow);
  set(img, ox + 2, oy + 6, P.grey);
  set(img, ox + 13, oy + 6, P.grey);
  [ox, oy] = at(9);
  rect(img, ox, oy, 16, 16, P.slate);
  rect(img, ox + 15, oy, 1, 12, P.shadow);
  rect(img, ox, oy + 11, 16, 1, P.ink);
  rect(img, ox, oy + 12, 16, 4, P.shadow);
  set(img, ox + 2, oy + 8, P.grey);
  set(img, ox + 13, oy + 8, P.grey);

  // 10 whiteboard on the wall
  [ox, oy] = at(10);
  rect(img, ox + 1, oy + 2, 14, 10, P.ink);
  rect(img, ox + 2, oy + 3, 12, 8, P.paper);
  rect(img, ox + 3, oy + 4, 5, 1, P.sky);
  rect(img, ox + 3, oy + 6, 8, 1, P.sky);
  rect(img, ox + 9, oy + 8, 3, 2, P.brick);
  rect(img, ox + 3, oy + 8, 4, 1, P.grass);
  rect(img, ox + 2, oy + 12, 12, 1, P.grey);

  // 11 dark edge: the side and front walls of a room seen from above
  [ox, oy] = at(11);
  rect(img, ox, oy, 16, 16, P.ink);
  rect(img, ox + 6, oy, 4, 16, P.shadow);

  // 12 Raspberry Pi, a small green board
  [ox, oy] = at(12);
  rect(img, ox + 3, oy + 5, 10, 7, P.ink);
  rect(img, ox + 4, oy + 6, 8, 5, P.forest);
  rect(img, ox + 4, oy + 6, 8, 1, P.gold);
  rect(img, ox + 9, oy + 8, 2, 2, P.mist);
  rect(img, ox + 5, oy + 8, 2, 2, P.shadow);

  // 13 exit mat, with an arrow pointing out of the room (down)
  [ox, oy] = at(13);
  rect(img, ox + 1, oy + 2, 14, 12, P.shadow);
  rect(img, ox + 2, oy + 3, 12, 10, P.ink);
  rect(img, ox + 7, oy + 4, 2, 5, P.gold);
  rect(img, ox + 5, oy + 9, 6, 1, P.gold);
  rect(img, ox + 6, oy + 10, 4, 1, P.gold);
  rect(img, ox + 7, oy + 11, 2, 1, P.gold);

  // 14 desk monitor with a dashboard
  [ox, oy] = at(14);
  rect(img, ox + 2, oy + 2, 12, 9, P.ink);
  rect(img, ox + 3, oy + 3, 10, 7, P.night);
  rect(img, ox + 4, oy + 7, 1, 2, P.phosphor);
  rect(img, ox + 6, oy + 5, 1, 4, P.phosphor);
  rect(img, ox + 8, oy + 6, 1, 3, P.orange);
  rect(img, ox + 10, oy + 4, 1, 5, P.phosphor);
  rect(img, ox + 7, oy + 11, 2, 2, P.slate);
  rect(img, ox + 5, oy + 13, 6, 1, P.ink);

  return img;
}

export const TILES_FILE = 'assets/tiles/nines-tiles.png';

export function allArt() {
  const out = Object.values(CHARACTERS).map((c) => [c.file, drawCharacter(c)]);
  out.push([TILES_FILE, drawTiles()]);
  return out;
}

const sameImage = (a, b) => a.width === b.width && a.height === b.height && Buffer.from(a.data).equals(Buffer.from(b.data));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const [file, img] of allArt()) {
    const path = join(ROOT, file);
    if (check) {
      let ok = false;
      try {
        ok = sameImage(decodePng(readFileSync(path)), img);
      } catch {
        ok = false;
      }
      if (!ok) {
        console.error(`${file} differs from tools/art/draw-art.mjs; run: node tools/art/draw-art.mjs`);
        bad++;
      }
    } else {
      writeFileSync(path, encodePng(img));
      console.log(`wrote ${file}`);
    }
  }
  process.exit(bad > 0 ? 1 : 0);
}
