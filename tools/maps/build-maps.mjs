// Writes the first versions of the Tiled maps in content/maps/ from the layouts below, so the
// maps are reproducible and reviewable as text. The JSON files are ordinary Tiled maps: open
// them in Tiled (https://www.mapeditor.org) to change them. If you edit a map in Tiled, update
// the layout here too or delete it from MAPS, so the next run does not undo your edit.
//
//   node tools/maps/build-maps.mjs           write content/maps/*.json
//   node tools/maps/build-maps.mjs --check   exit 1 when a committed map differs from this script
//
// Map rules (ARCHITECTURE.md, The Phaser layer; checked by tools/content/load.ts):
//   tile layers ground, detail, props, above (drawn over the player) and collision (hidden;
//   tiles whose tile has the property collides: true), plus one object layer "objects" with
//   named objects: spawn points (player-start, npc-n, cameo-n, gate-<town>, door arrivals),
//   terminals and battles (named as a quest's start.object), doors (to_map, to_point) and shops.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = 16;

// ---- tilesets, embedded in every map (same firstgids everywhere)
const TILESETS = [
  { name: 'kenney-rpg-urban', image: '../../assets/kenney/rpg-urban-pack/tilemap_packed.png', imagewidth: 432, imageheight: 288, columns: 27, tilecount: 486, spacing: 0 },
  { name: 'kenney-tiny-town', image: '../../assets/kenney/tiny-town/tilemap_packed.png', imagewidth: 192, imageheight: 176, columns: 12, tilecount: 132, spacing: 0 },
  { name: 'kenney-roguelike-indoors', image: '../../assets/kenney/roguelike-indoors/roguelikeIndoor_transparent.png', imagewidth: 458, imageheight: 305, columns: 27, tilecount: 486, spacing: 1 },
  { name: 'nines-tiles', image: '../../assets/tiles/nines-tiles.png', imagewidth: 128, imageheight: 32, columns: 8, tilecount: 16, spacing: 0, tiles: [{ id: 0, properties: [{ name: 'collides', type: 'bool', value: true }] }] },
];
{
  let gid = 1;
  for (const ts of TILESETS) {
    ts.firstgid = gid;
    gid += ts.tilecount;
  }
}
const U = (i) => TILESETS[0].firstgid + i; // RPG Urban Pack
const TT = (i) => TILESETS[1].firstgid + i; // Tiny Town
const IN = (i) => TILESETS[2].firstgid + i; // Roguelike Indoors
const N = (i) => TILESETS[3].firstgid + i; // our own tiles (tools/art/draw-art.mjs)
const COLLIDE = N(0);

// 3 x 3 border sets: [top-left, top, top-right, left, centre, right, bottom-left, bottom, bottom-right]
const SIDEWALK = [8, 9, 10, 35, 36, 37, 62, 63, 64].map(U);
const ROOF_SLATE = [81, 82, 83, 108, 109, 110, 135, 136, 137].map(U);
const ROOF_SAND = [89, 90, 91, 116, 117, 118, 143, 144, 145].map(U);
const PATH = [12, 13, 14, 24, 25, 26, 36, 37, 38].map(TT);
const WATER = [170, 171, 172, 197, 198, 199, 224, 225, 226].map(U);

const WALLS = {
  brick: { top: [17, 18, 19].map(U), bottom: [98, 99, 100].map(U) },
  clay: { top: [124 + 1, 124 + 2, 124 + 3].map(U), bottom: [205 + 1, 205 + 2, 205 + 3].map(U) },
};

function mapBuilder(width, height) {
  const layer = () => new Array(width * height).fill(0);
  const m = { width, height, ground: layer(), detail: layer(), props: layer(), above: layer(), collision: layer(), objects: [] };
  m.put = (name, x, y, gid, solid = false) => {
    if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`(${x},${y}) is outside the map`);
    m[name][y * width + x] = gid;
    if (solid) m.collision[y * width + x] = COLLIDE;
  };
  m.solid = (x, y, on = true) => {
    m.collision[y * width + x] = on ? COLLIDE : 0;
  };
  m.fill = (name, x0, y0, w, h, gid, solid = false) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) m.put(name, x, y, gid, solid);
  };
  m.blob = (name, x0, y0, w, h, set, solid = false) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const col = x === x0 ? 0 : x === x0 + w - 1 ? 2 : 1;
        const row = y === y0 ? 0 : y === y0 + h - 1 ? 2 : 1;
        m.put(name, x, y, set[row * 3 + col], solid);
      }
    }
  };
  m.object = (name, type, x, y, properties = {}) => {
    m.objects.push({ name, type, x, y, properties });
  };
  return m;
}

/** A building: a roof (roofRows high) over a two-row front wall. Everything is solid. */
function building(m, x0, y0, w, roofRows, roof, wall) {
  m.blob('ground', x0, y0, w, roofRows, roof, true);
  const wy = y0 + roofRows;
  for (let x = x0; x < x0 + w; x++) {
    const i = x === x0 ? 0 : x === x0 + w - 1 ? 2 : 1;
    m.put('ground', x, wy, wall.top[i], true);
    m.put('ground', x, wy + 1, wall.bottom[i], true);
  }
}

/** A tall tree: trunk solid, crown drawn over the player. */
function tree(m, x, y, kind = 'green') {
  const [top, bottom] = kind === 'green' ? [TT(4), TT(16)] : [TT(3), TT(15)];
  if (y > 0) m.put('above', x, y - 1, top);
  m.put('detail', x, y, bottom, true);
}

/** A street lamp: post solid, head drawn over the player. */
function lamp(m, x, y) {
  m.put('above', x, y - 1, U(164));
  m.put('detail', x, y, U(191), true);
}

// ---- Junior Village: 40 x 30
function juniorVillage() {
  const m = mapBuilder(40, 30);
  m.fill('ground', 0, 0, 40, 30, TT(0));
  // a little texture in the grass
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
    const h = (x * 73 + y * 151) % 17;
    if (h === 0) m.put('ground', x, y, TT(1));
    else if (h === 5) m.put('ground', x, y, TT(2));
  }

  // the woods around the village; the road east to Medior City stays open
  for (let x = 0; x < 40; x++) {
    tree(m, x, 1, x % 3 === 1 ? 'orange' : 'green');
    tree(m, x, 29, x % 4 === 2 ? 'orange' : 'green');
    m.solid(x, 0);
    m.put('detail', x, 0, x % 2 ? TT(4) : TT(3), true);
  }
  for (let y = 2; y < 29; y++) {
    if (y >= 13 && y <= 16) continue;
    tree(m, 0, y, y % 3 === 0 ? 'orange' : 'green');
    tree(m, 39, y, y % 4 === 1 ? 'orange' : 'green');
  }
  for (let y = 3; y < 28; y += 2) {
    if (y >= 11 && y <= 17) continue;
    tree(m, 1, y, 'green');
    tree(m, 38, y, 'green');
  }

  // the main street, west to east, and the road out to Medior City
  m.blob('ground', 2, 13, 38, 4, SIDEWALK);
  m.fill('ground', 38, 13, 2, 4, SIDEWALK[4]);

  // north side: the data centre (server room), the office, the Homelab Store
  building(m, 4, 7, 7, 4, ROOF_SAND, WALLS.clay);
  m.put('detail', 5, 11, U(443));
  m.put('detail', 9, 11, U(443));
  m.put('detail', 7, 12, U(285)); // the data centre's glass door
  m.solid(7, 12, false);
  m.put('above', 6, 7, U(333)); // a rooftop unit
  m.put('above', 8, 8, U(334));

  building(m, 13, 6, 10, 5, ROOF_SLATE, WALLS.brick);
  for (const x of [14, 16, 20, 22]) m.put('detail', x, 11, U(362));
  for (const x of [14, 22]) m.put('detail', x, 12, U(362));
  m.put('detail', 17, 12, U(284)); // the meeting room door (no interior yet)
  m.put('detail', 18, 12, U(284));
  m.put('detail', 18, 11, N(10)); // whiteboard in the window
  m.put('detail', 15, 12, U(305), true); // mailbox

  building(m, 26, 7, 8, 4, ROOF_SAND, WALLS.brick);
  for (let x = 26; x < 34; x++) m.put('detail', x, 11, x === 26 ? U(328) : x === 33 ? U(332) : U(329)); // awning
  m.put('detail', 27, 12, U(386));
  m.put('detail', 28, 12, U(387));
  m.put('detail', 29, 12, U(285)); // the store's door, the counter is inside
  m.put('detail', 30, 12, U(387));
  m.put('detail', 31, 12, U(388));
  m.put('detail', 32, 12, N(12)); // a Raspberry Pi in the window

  // street furniture
  for (const x of [3, 12, 24, 35]) lamp(m, x, 13);
  for (const x of [8, 20, 31]) lamp(m, x, 17);
  m.put('detail', 11, 13, U(280), true); // bin
  m.put('detail', 25, 13, U(301), true); // planter
  m.put('detail', 34, 13, U(302), true);
  m.put('detail', 23, 16, U(270), true); // bench
  m.put('detail', 13, 16, U(271), true);

  // the road to Medior City is closed until the interview: the two barriers on the road itself
  // are the gate (doors with town: medior), drawn on the props layer, which the world clears
  // once the road is open (WorldScene, src/world/grid.ts closedGates)
  for (const y of [13, 16]) m.put('detail', 38, y, U(221), true);
  m.put('detail', 39, 13, U(222), true);
  m.put('props', 39, 14, U(222));
  m.put('props', 39, 15, U(222));
  m.put('detail', 39, 16, U(222), true);

  // south side: paths from the street
  m.fill('ground', 6, 17, 2, 2, PATH[4]);
  m.fill('ground', 18, 17, 3, 2, PATH[4]);
  m.fill('ground', 27, 17, 2, 2, PATH[4]);

  // the café terrace, where Ravi works on his laptop
  m.blob('ground', 3, 19, 10, 6, SIDEWALK);
  for (const [x, y] of [[5, 21], [9, 21], [5, 23]]) {
    m.put('detail', x, y, IN(7), true); // round table
  }
  m.put('props', 9, 21, N(5)); // Ravi's laptop
  m.put('detail', 6, 21, IN(83), true); // chairs
  m.put('detail', 4, 23, IN(82), true);
  m.put('detail', 12, 19, U(291), true); // potted tree
  m.put('detail', 3, 19, U(292), true);

  // the pond in the park
  m.blob('ground', 15, 20, 7, 5, WATER, true);
  tree(m, 23, 22);
  tree(m, 14, 26);
  tree(m, 21, 26, 'orange');
  m.put('detail', 18, 19, U(381), true); // a bench by the pond

  // the on-call corner: a picnic table with the on-call laptop
  m.blob('ground', 25, 19, 7, 5, PATH);
  m.put('detail', 28, 21, IN(7), true);
  m.put('props', 28, 21, N(5));
  m.put('detail', 30, 20, TT(83), true); // signpost
  tree(m, 33, 20, 'orange');
  tree(m, 34, 24);
  tree(m, 5, 27);
  tree(m, 9, 26, 'orange');
  m.put('detail', 32, 25, TT(5), true); // bush
  m.put('detail', 11, 26, TT(5), true);

  // behind the office, out of sight of the street: Vince's corner, a crate with a laptop and a
  // bin (DESIGN.md, Side hustles)
  m.put('detail', 20, 4, IN(7), true);
  m.put('props', 20, 4, N(5));
  m.put('detail', 16, 4, U(280), true);
  // the Repair Café's stall in the park, where community service happens (DESIGN.md, Karma)
  m.put('detail', 26, 25, IN(7), true);
  m.put('props', 26, 25, N(5));
  m.put('detail', 27, 25, IN(83), true);

  // spawn points and objects
  m.object('player-start', 'spawn', 19, 15, { facing: 'down' });
  m.object('npc-1', 'spawn', 9, 14); // Femke, by the data centre
  m.object('npc-2', 'spawn', 10, 21); // Ravi, at his laptop
  m.object('npc-3', 'spawn', 28, 22); // Bas, at the on-call corner
  m.object('npc-4', 'spawn', 20, 13); // Daan, by the office
  m.object('gate-medior', 'spawn', 37, 14); // Ingrid, on the road to Medior City
  m.object('cameo-1', 'spawn', 12, 23);
  m.object('cameo-2', 'spawn', 33, 22);
  m.object('npc-5', 'spawn', 24, 17); // Mila, on the square
  m.object('npc-6', 'spawn', 18, 4); // Vince, behind the office
  m.object('npc-7', 'spawn', 15, 14); // Sanne, the pentester, in front of the office
  m.object('npc-8', 'spawn', 24, 25); // Henk, at the Repair Café stall
  m.object('server-room-exit', 'spawn', 7, 13, { facing: 'down' });
  m.object('medior-road-exit', 'spawn', 38, 15, { facing: 'left' }); // back from Medior City
  m.object('road-to-medior-1', 'door', 39, 14, { to_map: 'medior-city', to_point: 'village-road', town: 'medior' });
  m.object('road-to-medior-2', 'door', 39, 15, { to_map: 'medior-city', to_point: 'village-road', town: 'medior' });
  m.object('server-room-door', 'door', 7, 12, { to_map: 'server-room', to_point: 'entrance' });
  m.object('ravi-laptop', 'terminal', 9, 21);
  m.object('back-alley-laptop', 'terminal', 20, 4);
  m.object('repair-cafe-laptop', 'terminal', 26, 25);
  m.object('on-call-laptop', 'battle', 28, 21);
  m.object('meeting-room', 'battle', 17, 12);
  m.object('homelab-store', 'shop', 29, 12);
  m.solid(17, 12);
  m.solid(29, 12);
  return m;
}

// ---- the server room: 15 x 10, one screen
function serverRoom() {
  const m = mapBuilder(15, 10);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 15; x++) m.put('ground', x, y, (x + y) % 5 === 0 ? N(7) : N(6));
  for (let x = 0; x < 15; x++) {
    m.put('ground', x, 0, N(8), true);
    m.put('ground', x, 1, N(9), true);
    m.put('ground', x, 9, N(11), true);
  }
  for (let y = 0; y < 10; y++) {
    m.put('ground', 0, y, N(11), true);
    m.put('ground', 14, y, N(11), true);
  }
  m.put('ground', 7, 9, N(13)); // the way out
  m.solid(7, 9, false);
  m.put('detail', 3, 0, N(10)); // whiteboard
  m.put('detail', 11, 1, N(14)); // a dashboard on the wall

  // two rows of racks with an aisle down the middle
  const rack = (x, y) => {
    m.put('detail', x, y, N(1), true);
    m.put('detail', x, y + 1, N(3), true);
  };
  for (const x of [2, 3, 4, 5]) rack(x, 2);
  for (const x of [9, 10, 11, 12]) rack(x, 2);
  for (const x of [2, 3, 4]) rack(x, 5);
  for (const x of [10, 11, 12]) rack(x, 5);

  // the admin desk
  m.put('detail', 1, 8, IN(324), true);
  m.put('detail', 2, 8, IN(326), true);
  m.put('props', 1, 8, N(14));
  m.put('detail', 13, 8, IN(16), true); // plant
  m.put('detail', 13, 2, IN(17), true);

  m.object('entrance', 'spawn', 7, 8, { facing: 'up' });
  m.object('exit', 'door', 7, 9, { to_map: 'junior-village', to_point: 'server-room-exit' });
  m.object('rack-web-01', 'terminal', 4, 3);
  m.object('rack-app-01', 'terminal', 10, 3);
  m.object('cameo-rack-1', 'terminal', 3, 6);
  m.object('cameo-rack-2', 'terminal', 11, 6);
  m.object('rack-k8s-01', 'terminal', 12, 3); // the Kubernetes jump host
  m.object('rack-bank-01', 'terminal', 9, 3); // Polderbank's staging server, for the pentest
  m.object('rack-bakery-01', 'terminal', 5, 3); // the bakery's web shop, for the contractor hotfix
  return m;
}

/** A tower: a flat roof over `floors` rows of brick wall with windows, the bottom row the street front. */
function tower(m, x0, y0, w, roofRows, floors, roof) {
  m.blob('ground', x0, y0, w, roofRows, roof, true);
  const rows = [[17, 18, 19], ...Array.from({ length: floors - 2 }, (_, i) => (i === 0 ? [44, 45, 46] : [71, 72, 73])), [98, 99, 100]];
  rows.forEach((tiles, r) => {
    const y = y0 + roofRows + r;
    for (let x = x0; x < x0 + w; x++) {
      const i = x === x0 ? 0 : x === x0 + w - 1 ? 2 : 1;
      m.put('ground', x, y, U(tiles[i]), true);
      // windows on every floor but the street front, every other column
      if (r > 0 && r < rows.length - 1 && x > x0 && x < x0 + w - 1 && (x - x0) % 2 === 1) m.put('detail', x, y, U(362));
    }
  });
}

/** A parked car seen from the side: two tiles wide, solid. */
function taxi(m, x, y) {
  m.put('detail', x, y, U(420), true);
  m.put('detail', x + 1, y, U(421), true);
}

// ---- Medior City: 44 x 34, a bigger, busier town east of the village (DESIGN.md, Medior City)
function mediorCity() {
  const W = 44;
  const H = 34;
  const m = mapBuilder(W, H);
  const PAVE = SIDEWALK[4];
  m.fill('ground', 0, 0, W, H, PAVE);

  // the edge of town: trees to the north, south and east; the road west to Junior Village open
  for (let x = 0; x < W; x++) {
    m.put('detail', x, 0, x % 2 ? TT(4) : TT(3), true);
    tree(m, x, 1, x % 3 === 0 ? 'orange' : 'green');
    tree(m, x, H - 1, x % 4 === 1 ? 'orange' : 'green');
  }
  for (let y = 2; y < H - 1; y++) {
    if (y < 13 || y > 16) tree(m, 0, y, y % 3 === 0 ? 'orange' : 'green');
    tree(m, W - 1, y, y % 4 === 2 ? 'orange' : 'green');
  }
  // the back alley behind the buildings (y 2 and 3) is paved; the north trees close it off
  for (let x = 1; x < W - 1; x++) m.put('ground', x, 1, TT(0));

  // the boulevard: three lanes of asphalt west to east, sidewalks on both sides
  m.fill('ground', 0, 14, W, 3, U(406));
  for (let x = 1; x < W - 1; x += 2) m.put('ground', x, 15, U(433)); // the centre line
  for (const x of [15, 16]) for (let y = 14; y <= 16; y++) m.put('ground', x, y, U(432)); // a zebra crossing
  for (const x of [33, 34]) for (let y = 14; y <= 16; y++) m.put('ground', x, y, U(432));
  m.fill('ground', 1, 13, W - 2, 1, SIDEWALK[7]);
  m.fill('ground', 1, 17, W - 2, 1, SIDEWALK[1]);
  taxi(m, 22, 16);
  taxi(m, 37, 14);
  m.put('detail', 8, 16, U(426), true); // a van, nose first
  // the road to Senior Summit is closed: no gate for it yet
  m.put('detail', W - 2, 14, U(221), true);
  m.put('detail', W - 2, 15, U(222), true);
  m.put('detail', W - 2, 16, U(221), true);
  m.put('detail', W - 3, 13, TT(83), true); // a signpost: Senior Summit, later

  // north side, west to east: the Career Office, The Stack (co-working and colocation), the
  // Grachtgarant tower, the Byte Bakery
  building(m, 3, 5, 8, 4, ROOF_SAND, WALLS.clay);
  for (let x = 3; x < 11; x++) m.put('detail', x, 9, x === 3 ? U(328) : x === 10 ? U(332) : U(329)); // awning
  m.put('detail', 4, 10, U(386));
  m.put('detail', 5, 10, U(387));
  m.put('detail', 6, 10, U(284), true); // the Career Office's door (no interior)
  m.put('detail', 7, 10, U(284), true);
  m.put('detail', 8, 10, U(387));
  m.put('detail', 9, 10, U(388));

  building(m, 12, 4, 11, 5, ROOF_SLATE, WALLS.brick);
  for (const x of [13, 15, 19, 21]) m.put('detail', x, 9, U(362));
  for (const x of [13, 14, 15]) m.put('detail', x, 10, U(359 + (x - 13)));
  for (const x of [19, 20, 21]) m.put('detail', x, 10, U(359 + (x - 19)));
  m.put('detail', 17, 10, U(285)); // The Stack's glass door
  m.solid(17, 10, false);
  m.put('above', 14, 4, U(333)); // rooftop units
  m.put('above', 20, 5, U(334));
  m.put('detail', 18, 10, N(14)); // a status screen in the window

  tower(m, 25, 4, 8, 2, 5, ROOF_SLATE);
  m.put('detail', 28, 10, U(285), true); // the insurer's lobby (no interior)
  m.put('detail', 29, 10, U(285), true);
  m.put('detail', 26, 10, U(305), true); // mailbox

  building(m, 35, 6, 6, 3, ROOF_SAND, WALLS.brick);
  for (let x = 35; x < 41; x++) m.put('detail', x, 9, x === 35 ? U(328) : x === 40 ? U(332) : U(330));
  m.put('detail', 36, 10, U(386));
  m.put('detail', 37, 10, U(283), true); // the bakery door
  m.put('detail', 38, 10, U(387));
  m.put('detail', 39, 10, U(388));

  // the gap between The Stack and the tower leads to the back alley
  m.put('detail', 23, 3, U(280), true); // bins in the alley
  m.put('detail', 24, 2, U(279), true);
  m.put('detail', 11, 3, U(278), true);
  // Mo's corner, behind the tower: a crate with a laptop
  m.put('detail', 31, 2, U(250), true);

  // street furniture on the north sidewalk
  for (const x of [2, 11, 24, 34, 41]) lamp(m, x, 12);
  m.put('detail', 14, 12, U(270), true); // bench
  m.put('detail', 32, 12, U(301), true); // planter
  m.put('detail', 22, 12, U(166), true); // a bus stop sign

  // south side: the plaza with its fountain, west
  m.blob('ground', 2, 19, 20, 12, SIDEWALK);
  m.blob('ground', 9, 23, 5, 4, WATER, true);
  for (const [x, y] of [[4, 20], [19, 20], [4, 29], [19, 29]]) tree(m, x, y, (x + y) % 2 ? 'green' : 'orange');
  m.put('detail', 11, 22, U(270), true); // benches round the fountain
  m.put('detail', 11, 27, U(271), true);
  m.put('detail', 8, 24, U(381), true);
  m.put('detail', 14, 24, U(381), true);
  // the café terrace on the plaza, where Lars reviews code
  for (const [x, y] of [[6, 21], [16, 21]]) m.put('detail', x, y, IN(7), true);
  m.put('props', 6, 21, N(5));
  m.put('detail', 16, 21, IN(7), true);
  m.put('detail', 7, 21, IN(83), true);
  m.put('detail', 17, 21, IN(82), true);
  // Hugo's whiteboard on the plaza
  m.put('detail', 6, 28, N(10), true);
  m.put('detail', 16, 28, U(291), true); // potted trees
  m.put('detail', 3, 25, U(292), true);

  // trees and a bench along the south sidewalk
  for (const x of [3, 12, 26, 38]) lamp(m, x, 18);
  m.put('detail', 22, 18, U(270), true);
  m.put('detail', 9, 18, U(302), true);
  m.put('detail', 30, 18, U(301), true);

  // the car park, south-east, with its pay station
  m.blob('ground', 24, 19, 18, 7, SIDEWALK);
  for (let x = 26; x < 40; x += 2) {
    m.put('ground', x, 20, U(437));
    m.put('ground', x + 1, 20, U(438));
  }
  m.put('detail', 25, 20, U(442), true); // P
  taxi(m, 28, 20);
  m.put('detail', 34, 20, U(427), true); // a van, from behind
  m.put('detail', 33, 23, U(412), true); // the pay station
  m.put('props', 33, 23, N(5));

  // the park, south-east: grass and trees
  m.fill('ground', 23, 27, 20, 6, TT(0));
  for (let y = 27; y < 33; y++) for (let x = 23; x < 43; x++) {
    const h = (x * 31 + y * 17) % 13;
    if (h === 0) m.put('ground', x, y, TT(1));
    else if (h === 6) m.put('ground', x, y, TT(2));
  }
  for (const [x, y] of [[25, 29], [29, 31], [36, 28], [40, 31], [33, 30]]) tree(m, x, y, (x + y) % 3 ? 'green' : 'orange');
  m.put('detail', 38, 29, TT(5), true);
  m.put('detail', 27, 28, U(381), true);

  // spawn points and objects
  m.object('village-road', 'spawn', 2, 15, { facing: 'right' });
  m.object('back-to-village-1', 'door', 0, 14, { to_map: 'junior-village', to_point: 'medior-road-exit' });
  m.object('back-to-village-2', 'door', 0, 15, { to_map: 'junior-village', to_point: 'medior-road-exit' });
  m.object('stack-exit', 'spawn', 17, 11, { facing: 'down' });
  m.object('stack-door', 'door', 17, 10, { to_map: 'the-stack', to_point: 'entrance' });
  m.object('npc-1', 'spawn', 8, 12); // Petra, the career coach, at the Career Office
  m.object('npc-2', 'spawn', 6, 22); // Lars, at the café terrace
  m.object('npc-3', 'spawn', 17, 24); // Amara, by the fountain
  m.object('npc-4', 'spawn', 20, 26); // Kim, on the plaza
  m.object('npc-5', 'spawn', 7, 28); // Hugo, at his whiteboard
  m.object('npc-6', 'spawn', 30, 12); // Marieke, in front of the Grachtgarant tower
  m.object('npc-7', 'spawn', 30, 2); // Mo, in the back alley
  m.object('cameo-1', 'spawn', 38, 12);
  m.object('cameo-2', 'spawn', 31, 29);
  m.object('garage-pay-station', 'terminal', 33, 23);
  return m;
}

// ---- The Stack: co-working desks on the left, a small colocation floor on the right. 20 x 12
function theStack() {
  const W = 20;
  const H = 12;
  const m = mapBuilder(W, H);
  // wooden boards under the desks, the raised floor of the colocation room on the right
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.put('ground', x, y, x >= 13 ? ((x + y) % 5 === 0 ? N(7) : N(6)) : IN(24));
  for (let x = 0; x < W; x++) {
    m.put('ground', x, 0, N(8), true);
    m.put('ground', x, 1, N(9), true);
    m.put('ground', x, H - 1, N(11), true);
  }
  for (let y = 0; y < H; y++) {
    m.put('ground', 0, y, N(11), true);
    m.put('ground', W - 1, y, N(11), true);
  }
  // the glass wall of the colocation floor, with a door gap
  for (let y = 2; y < H - 1; y++) if (y !== 6) m.put('ground', 12, y, N(11), true);
  m.put('ground', 9, H - 1, N(13)); // the way out
  m.solid(9, H - 1, false);
  m.put('detail', 3, 0, N(10)); // a whiteboard
  m.put('detail', 8, 1, N(14)); // a dashboard

  // desks: a table with a laptop, a chair
  const desk = (x, y, laptop = true) => {
    m.put('detail', x, y, IN(7), true);
    if (laptop) m.put('props', x, y, N(5));
  };
  desk(3, 3);
  desk(7, 3);
  desk(3, 7);
  desk(7, 7);
  desk(10, 4, false);
  m.put('detail', 4, 3, IN(83), true);
  m.put('detail', 8, 3, IN(83), true);
  m.put('detail', 4, 7, IN(83), true);
  m.put('detail', 1, 9, IN(16), true); // plants
  m.put('detail', 11, 9, IN(17), true);
  m.put('detail', 1, 2, IN(16), true);

  // the colocation floor: two rows of racks
  const rack = (x, y) => {
    m.put('detail', x, y, N(1), true);
    m.put('detail', x, y + 1, N(3), true);
  };
  for (const x of [14, 15, 16, 17]) rack(x, 3);
  for (const x of [14, 15, 17]) rack(x, 7);
  m.put('detail', 18, 10, IN(16), true);

  m.object('entrance', 'spawn', 9, 10, { facing: 'up' });
  m.object('exit', 'door', 9, 11, { to_map: 'medior-city', to_point: 'stack-exit' });
  m.object('npc-1', 'spawn', 6, 4); // Ruben, DevOps
  m.object('npc-2', 'spawn', 2, 7); // Esra, the pentester
  m.object('npc-3', 'spawn', 9, 6); // Jesse, the app team lead
  m.object('npc-4', 'spawn', 16, 6); // Wim, systems, on the colocation floor
  m.object('stack-desk-ci', 'terminal', 7, 3); // Ruben's pipeline
  m.object('stack-desk-pentest', 'terminal', 3, 7); // the assessment laptop
  m.object('stack-jump-k8s', 'terminal', 7, 7); // the Kubernetes jump host
  m.object('stack-rack-storage', 'terminal', 15, 4); // the file server with the RAID
  m.object('stack-rack-portal', 'terminal', 17, 8); // Grachtgarant's portal, colocated
  m.object('cameo-desk-1', 'terminal', 3, 3); // a spare desk for a terminal cameo
  return m;
}

export const MAPS = { 'junior-village': juniorVillage, 'server-room': serverRoom, 'medior-city': mediorCity, 'the-stack': theStack };

function toTiled(m) {
  const names = ['ground', 'detail', 'props', 'above', 'collision'];
  let id = 1;
  const layers = names.map((name) => ({
    data: m[name],
    height: m.height,
    id: id++,
    name,
    opacity: 1,
    type: 'tilelayer',
    visible: name !== 'collision',
    width: m.width,
    x: 0,
    y: 0,
  }));
  let oid = 1;
  layers.push({
    draworder: 'topdown',
    id: id++,
    name: 'objects',
    objects: m.objects.map((o) => ({
      height: 0,
      id: oid++,
      name: o.name,
      point: true,
      ...(Object.keys(o.properties).length > 0
        ? { properties: Object.entries(o.properties).map(([name, value]) => ({ name, type: 'string', value })) }
        : {}),
      rotation: 0,
      type: o.type,
      visible: true,
      width: 0,
      x: o.x * T + T / 2,
      y: o.y * T + T / 2,
    })),
    opacity: 1,
    type: 'objectgroup',
    visible: true,
    x: 0,
    y: 0,
  });
  return {
    compressionlevel: -1,
    height: m.height,
    infinite: false,
    layers,
    nextlayerid: id,
    nextobjectid: oid,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    tiledversion: '1.10.2',
    tileheight: T,
    tilesets: TILESETS.map((ts) => ({
      columns: ts.columns,
      firstgid: ts.firstgid,
      image: ts.image,
      imageheight: ts.imageheight,
      imagewidth: ts.imagewidth,
      margin: 0,
      name: ts.name,
      spacing: ts.spacing,
      tilecount: ts.tilecount,
      tileheight: T,
      ...(ts.tiles ? { tiles: ts.tiles } : {}),
      tilewidth: T,
    })),
    tilewidth: T,
    type: 'map',
    version: '1.10',
    width: m.width,
  };
}

/** Tiled-like JSON: one tile row per line, so diffs stay readable. */
export function serialize(map) {
  const json = JSON.stringify(map, null, 1);
  return (
    json.replace(/"data": \[([\s\d,]+)\]/g, (_, body) => {
      const nums = body.split(',').map((s) => s.trim());
      const rows = [];
      for (let i = 0; i < nums.length; i += map.width) rows.push(nums.slice(i, i + map.width).join(','));
      return `"data": [\n${rows.join(',\n')}]`;
    }) + '\n'
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  let bad = 0;
  for (const [id, build] of Object.entries(MAPS)) {
    const file = join(ROOT, 'content', 'maps', `${id}.json`);
    const text = serialize(toTiled(build()));
    if (check) {
      let same = false;
      try {
        same = readFileSync(file, 'utf8') === text;
      } catch {
        same = false;
      }
      if (!same) {
        console.error(`content/maps/${id}.json differs from tools/maps/build-maps.mjs`);
        bad++;
      }
    } else {
      writeFileSync(file, text);
      console.log(`wrote content/maps/${id}.json`);
    }
  }
  process.exit(bad > 0 ? 1 : 0);
}
