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

  // the road to Medior City is closed until the interview
  for (const y of [13, 16]) m.put('detail', 38, y, U(221), true);
  m.put('detail', 39, 13, U(222), true);
  m.put('detail', 39, 14, U(222), true);
  m.put('detail', 39, 15, U(222), true);
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
  m.object('server-room-exit', 'spawn', 7, 13, { facing: 'down' });
  m.object('server-room-door', 'door', 7, 12, { to_map: 'server-room', to_point: 'entrance' });
  m.object('ravi-laptop', 'terminal', 9, 21);
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
  return m;
}

export const MAPS = { 'junior-village': juniorVillage, 'server-room': serverRoom };

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
