// Load, validate and bundle /content. Runs in Node only: at build time (the Vite plugin), in
// `npm test` and in CI. Nothing here ships to the player; the game gets the resulting JSON.
//
// Two layers of checks:
//   1. JSON Schema (ajv) per file type: shape, types, patterns, sizes.
//   2. Semantic checks the schemas cannot express: ids match folders, references resolve,
//      every condition parses and type-checks, every locale key exists in both languages
//      with the same placeholders, sprites are real PNGs of the right size, and the content
//      folder holds data files only.

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import Ajv2020Import from 'ajv/dist/2020.js';
import { parse as parseYaml } from 'yaml';
import {
  type BattleSpec,
  type ContentBundle,
  type Credit,
  type LocaleId,
  type LocaleMap,
  LOCALES,
  type MapEntry,
  type NpcSpec,
  npcKey,
  type QuestEntry,
  type QuestSpec,
  questKey,
  type RoadmapSpec,
  type ScenarioSpec,
  type ShopSpec,
  type TiledMap,
  type TiledTileLayer,
} from '../../src/content/types';
import { GID_MASK, isFacing, isNpcSlot, objectTile, reachable, readMap, tileLayer, type WorldMap } from '../../src/world/grid';
import { compile, type Node, type Registry } from '../../src/rules/expr';
import { has } from '../../src/rules/own';
import { COMMANDS } from '../../src/sim/shell/commands';
import { BATTLE_FACTS, PROGRESS_FACTS, SCENARIO_FACTS } from '../../src/rules/registries';
import { normalize } from '../../src/sim/path';
import { createSession } from '../../src/sim/session';
import { parseLine } from '../../src/sim/shell/parse';
import { answerRound, compileBattle, startBattle } from '../../src/battle/engine';
import { perfectAnswer, worstAnswer } from '../../src/battle/score';

// ajv is CommonJS; depending on the loader the class is the default export or its .default.
type AjvClass = typeof Ajv2020Import;
const Ajv2020: AjvClass = ((Ajv2020Import as unknown as { default?: AjvClass }).default ?? Ajv2020Import) as AjvClass;

export interface LoadResult {
  bundle: ContentBundle | null;
  errors: string[];
  /** absolute paths of sprite sheets, for the bundler to emit as assets */
  sprites: SpriteRef[];
  /** tileset images of the maps, for the bundler to emit as assets */
  tilesets: TilesetRef[];
}

export interface TilesetRef {
  map: string;
  /** the tileset's name in the map */
  name: string;
  /** absolute path of the PNG */
  file: string;
}

export interface LoadOptions {
  /** the repository root, where tileset images and ASSETS.md live (default: the content folder's parent) */
  root?: string;
}

/** Rows of ASSETS.md as path -> cells: | `path` | source | author | licence | notes | */
export function assetRows(markdown: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const m = /^`([^`]+)`$/.exec(cells[0] ?? '');
    if (m) rows.set(m[1]!, cells);
  }
  return rows;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Width and height of a PNG, or null when the bytes are not a PNG. */
function pngSize(b: Buffer): { w: number; h: number } | null {
  if (b.length < 24 || !PNG_SIGNATURE.every((x, i) => b[i] === x)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

export interface SpriteRef {
  /** a quest folder's giver, or a world npc */
  owner: 'quest' | 'npc';
  id: string;
  file: string;
}

/** Control characters other than tab, newline and carriage return (ANSI/OSC escapes start here). */
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/** Functions whose first argument names something; it must be a literal so it can be checked. */
const NAME_ARGS = new Set(['service', 'pods_running', 'restarted', 'flag', 'ran', 'quest', 'has_item', 'xp']);

function callsIn(node: Node, out: { name: string; first: Node | undefined }[] = []) {
  switch (node.kind) {
    case 'call':
      out.push({ name: node.name, first: node.args[0] });
      node.args.forEach((a) => callsIn(a, out));
      break;
    case 'not':
      callsIn(node.expr, out);
      break;
    case 'logic':
    case 'cmp':
      callsIn(node.left, out);
      callsIn(node.right, out);
      break;
    default:
      break;
  }
  return out;
}

/** Ids in a cycle of "requires" edges, or [] when there is none. */
function findCycle(edges: Record<string, readonly string[]>): string[] {
  const state = new Map<string, 'open' | 'done'>();
  const stack: string[] = [];
  const visit = (id: string): string[] => {
    if (state.get(id) === 'done') return [];
    if (state.get(id) === 'open') return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 'open');
    stack.push(id);
    for (const next of has(edges, id) ? edges[id]! : []) {
      const c = visit(next);
      if (c.length > 0) return c;
    }
    stack.pop();
    state.set(id, 'done');
    return [];
  };
  for (const id of Object.keys(edges)) {
    const c = visit(id);
    if (c.length > 0) return c;
  }
  return [];
}

const SCHEMA_FILES = ['common', 'quest', 'scenario', 'battle', 'npc', 'locale', 'roadmap', 'shop', 'map'];
const SCHEMA_BASE = 'https://nines.invalid/schemas/';

/**
 * Words that would point at someone else's IP. Content must never need them. The second half
 * is the franchise's battle language, in English and Dutch: its "a wild ... appeared!"
 * catchphrase, its effectiveness and fainting lines, its town leaders and its battle menu.
 * Battles say "PAGER: ..." or "Incoming: ..." instead (DESIGN.md, Battles).
 */
const DENIED = new RegExp(
  [
    'pok[eé]\\s?mon', 'pikachu', 'pok[eé]\\s?dex', 'pok[eé]\\s?ball', 'nintendo', 'game\\s?freak', 'game\\s?boy',
    '\\bwilde?\\b[^!?\\n]{0,40}\\b(appear|versch(ijnt|een|enen))', '\\bversch(ijnt|een|enen)\\b[^!?\\n]{0,20}\\bwilde?\\b',
    "\\bit'?s\\s+(super[\\s-]?effective|not\\s+very\\s+effective)", '\\bhet\\s+is\\s+(super[\\s-]?effectief|niet\\s+erg\\s+effectief)',
    '\\bfainted\\b', 'flauwgevallen', '\\bgym\\s?leader', '\\belite\\s?four\\b', '\\btrainer\\s+battle',
    '\\bfight\\b[^\\n]{0,40}\\bbag\\b[^\\n]{0,40}\\brun\\b',
  ].join('|'),
  'i',
);

/** Look-alike letters (Cyrillic, Greek) that would slip a name past the denylist, as Latin. */
const LOOKALIKES: Record<string, string> = {
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', ӏ: 'l', к: 'k', м: 'm', т: 't', н: 'h', в: 'b',
  А: 'A', Е: 'E', О: 'O', Р: 'P', С: 'C', У: 'Y', Х: 'X', І: 'I', Ј: 'J', Ѕ: 'S', К: 'K', М: 'M', Т: 'T', Н: 'H', В: 'B',
  α: 'a', ε: 'e', ι: 'i', ο: 'o', ρ: 'p', κ: 'k', ν: 'v', τ: 't', Α: 'A', Ε: 'E', Ι: 'I', Ο: 'O', Ρ: 'P', Κ: 'K', Ν: 'N', Τ: 'T',
};

/** True when text uses a denied name or phrase, also when hidden by invisible or look-alike characters. */
export const DENYLIST = {
  test(text: string): boolean {
    const plain = text
      .normalize('NFKC')
      .replace(/[\u00AD\u200B-\u200F\u2060-\u2064\uFEFF]/g, '')
      .replace(/[\u0370-\u03FF\u0400-\u04FF\u0500-\u052F]/g, (c) => LOOKALIKES[c] ?? c);
    return DENIED.test(plain);
  },
};

const dirnameOf = (p: string): string => (p.lastIndexOf('/') <= 0 ? '/' : p.slice(0, p.lastIndexOf('/')));

const PLACEHOLDER = /\{([a-z0-9_]+)\}/g;
const placeholders = (s: string): string => [...s.matchAll(PLACEHOLDER)].map((m) => m[1]).sort().join(',');

export function loadContent(contentDir: string, schemaDir: string, options: LoadOptions = {}): LoadResult {
  const errors: string[] = [];
  const sprites: SpriteRef[] = [];
  const tilesets: TilesetRef[] = [];
  const root = options.root ?? join(contentDir, '..');
  const rel = (p: string) => relative(join(contentDir, '..'), p);
  const err = (file: string, msg: string) => errors.push(`${rel(file)}: ${msg}`);

  const ajv = new Ajv2020({ allErrors: true, strict: true, discriminator: true });
  for (const name of SCHEMA_FILES) {
    ajv.addSchema(JSON.parse(readFileSync(join(schemaDir, `${name}.schema.json`), 'utf8')) as object);
  }

  function read<T>(file: string, schema: string): T | null {
    if (!existsSync(file)) {
      err(file, 'missing');
      return null;
    }
    let data: unknown;
    const json = file.endsWith('.json');
    try {
      // maps are Tiled JSON: parsed as JSON, so a YAML file named .json is refused
      data = json ? JSON.parse(readFileSync(file, 'utf8')) : parseYaml(readFileSync(file, 'utf8'), { uniqueKeys: true, prettyErrors: true });
    } catch (e) {
      err(file, `${json ? 'JSON' : 'YAML'}: ${(e as Error).message.split('\n')[0]}`);
      return null;
    }
    const raw = readFileSync(file, 'utf8');
    if (DENYLIST.test(raw)) err(file, 'uses a name or phrase we must not use (IP rule, AGENTS.md)');
    const strings: string[] = [];
    const collect = (v: unknown): void => {
      if (typeof v === 'string') strings.push(v);
      else if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (strings.push(k), collect(x));
    };
    collect(data);
    if (strings.some((x) => CONTROL.test(x))) err(file, 'contains control characters (escape sequences are not allowed in content)');
    const validate = ajv.getSchema(`${SCHEMA_BASE}${schema}.schema.json`)!;
    if (!validate(data)) {
      for (const e of validate.errors ?? []) err(file, `${e.instancePath || '/'} ${e.message ?? 'is invalid'}`);
      return null;
    }
    return data as T;
  }

  // ---- the content folder holds data only
  const allowed = [
    /^locales\/(en|nl)\.yaml$/,
    /^(roadmap|shop)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/(quest|scenario|battle|npc)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/locales\/(en|nl)\.yaml$/,
    /^(quests|npcs)\/[^/]+\/[a-z0-9-]+\.png$/,
    /^maps\/[a-z0-9]+(-[a-z0-9]+)*\.json$/,
  ];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      const st = lstatSync(p);
      if (st.isSymbolicLink()) {
        err(p, 'symbolic links are not allowed in content');
        return [];
      }
      return st.isDirectory() ? walk(p) : [p];
    });
  const contentFiles = walk(contentDir);
  for (const file of contentFiles) {
    const r = relative(contentDir, file).split('\\').join('/');
    if (DENYLIST.test(r)) err(file, 'the path uses a name or phrase we must not use (IP rule, AGENTS.md)');
    if (!allowed.some((re) => re.test(r))) err(file, 'unexpected file: content holds YAML, PNG sprites and Tiled JSON maps only');
  }

  // ---- locales
  function readLocales(dir: string): Record<LocaleId, LocaleMap> | null {
    const maps = {} as Record<LocaleId, LocaleMap>;
    for (const l of LOCALES) {
      const m = read<LocaleMap>(join(dir, `${l}.yaml`), 'locale');
      if (!m) return null;
      maps[l] = m;
    }
    const enFile = join(dir, 'en.yaml');
    for (const k of Object.keys(maps.en)) if (!has(maps.nl, k)) err(join(dir, 'nl.yaml'), `missing key "${k}"`);
    for (const k of Object.keys(maps.nl)) if (!has(maps.en, k)) err(enFile, `missing key "${k}"`);
    for (const k of Object.keys(maps.en)) {
      const nl = has(maps.nl, k) ? maps.nl[k] : undefined;
      if (nl !== undefined && placeholders(maps.en[k]!) !== placeholders(nl)) {
        err(join(dir, 'nl.yaml'), `"${k}" has placeholders {${placeholders(nl)}}, en has {${placeholders(maps.en[k]!)}}`);
      }
    }
    for (const l of LOCALES) {
      for (const [k, v] of Object.entries(maps[l])) {
        if (DENYLIST.test(v)) err(join(dir, `${l}.yaml`), `"${k}" uses a name or phrase we must not use (IP rule, AGENTS.md)`);
      }
    }
    return maps;
  }

  const global = readLocales(join(contentDir, 'locales'));
  const roadmap = read<RoadmapSpec>(join(contentDir, 'roadmap.yaml'), 'roadmap');
  const shop = read<ShopSpec>(join(contentDir, 'shop.yaml'), 'shop');

  const needGlobal = (file: string, key: string) => {
    if (global && !has(global.en, key)) err(file, `unknown locale key "${key}" (content/locales)`);
  };
  if (roadmap) {
    const f = join(contentDir, 'roadmap.yaml');
    const ids = new Set<string>();
    for (const x of [...roadmap.towns, ...roadmap.branches, ...roadmap.nodes]) needGlobal(f, x.title);
    for (const n of roadmap.nodes) {
      if (ids.has(n.id)) err(f, `duplicate node "${n.id}"`);
      ids.add(n.id);
    }
    for (const n of roadmap.nodes) for (const r of n.requires) if (!ids.has(r)) err(f, `node "${n.id}" requires unknown node "${r}"`);
  }
  if (shop) {
    const f = join(contentDir, 'shop.yaml');
    const ids = new Set(shop.items.map((i) => i.id));
    if (ids.size !== shop.items.length) err(f, 'duplicate item ids');
    for (const i of shop.items) {
      needGlobal(f, i.title);
      needGlobal(f, i.description);
      for (const r of i.requires) if (!ids.has(r)) err(f, `item "${i.id}" requires unknown item "${r}"`);
    }
  }

  // ---- maps: Tiled JSON, tilesets embedded, images in the repository and in ASSETS.md
  const mapsDir = join(contentDir, 'maps');
  const assetsFile = join(root, 'ASSETS.md');
  const assets = existsSync(assetsFile) ? assetRows(readFileSync(assetsFile, 'utf8')) : new Map<string, string[]>();
  const maps: MapEntry[] = [];
  const worlds = new Map<string, WorldMap>();
  const mapIds = existsSync(mapsDir) ? readdirSync(mapsDir).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)).sort() : [];
  for (const id of mapIds) {
    const file = join(mapsDir, `${id}.json`);
    const map = read<TiledMap>(file, 'map');
    if (!map) continue;
    const before = errors.length;
    const cells = map.width * map.height;

    // tile layers: known names, once each, the map's size
    const names = map.layers.map((l) => l.name);
    for (const n of new Set(names)) if (names.filter((x) => x === n).length > 1) err(file, `layer "${n}" appears twice`);
    for (const need of ['ground', 'collision', 'objects']) if (!names.includes(need as never)) err(file, `needs a layer "${need}"`);
    const tileLayers = map.layers.filter((l): l is TiledTileLayer => l.type === 'tilelayer');
    for (const l of tileLayers) {
      if (l.width !== map.width || l.height !== map.height) err(file, `layer "${l.name}" is ${l.width}x${l.height}, the map ${map.width}x${map.height}`);
      if (l.data.length !== cells) err(file, `layer "${l.name}" has ${l.data.length} tiles, the map needs ${cells}`);
    }
    if (tileLayer(map, 'collision')?.visible !== false) err(file, 'the collision layer must be hidden (visible: false)');

    // tilesets: ranges in order, the image where it says, the size it says, listed in ASSETS.md
    const ranges: { first: number; last: number; name: string }[] = [];
    for (const ts of map.tilesets) {
      const sp = ts.spacing ?? 0;
      const cols = Math.floor((ts.imagewidth + sp) / (16 + sp));
      const rows = Math.floor((ts.imageheight + sp) / (16 + sp));
      if (ts.columns !== cols || ts.tilecount !== cols * rows) err(file, `tileset "${ts.name}": a ${ts.imagewidth}x${ts.imageheight} image with spacing ${sp} has ${cols} columns and ${cols * rows} tiles`);
      for (const t of ts.tiles ?? []) if (t.id >= ts.tilecount) err(file, `tileset "${ts.name}": tile ${t.id} does not exist`);
      const prev = ranges[ranges.length - 1];
      if (prev && ts.firstgid <= prev.last) err(file, `tileset "${ts.name}" overlaps "${prev.name}" (firstgid ${ts.firstgid})`);
      ranges.push({ first: ts.firstgid, last: ts.firstgid + ts.tilecount - 1, name: ts.name });
      if (ranges.filter((r) => r.name === ts.name).length > 1) err(file, `tileset name "${ts.name}" is used twice`);
      const logical = posix.normalize(posix.join('content/maps', ts.image));
      if (logical.startsWith('../') || posix.isAbsolute(ts.image)) {
        err(file, `tileset "${ts.name}": image ${ts.image} lies outside the repository`);
        continue;
      }
      if (logical.startsWith('content/')) {
        err(file, `tileset "${ts.name}": tileset images live outside content/ (in assets/) with a row in ASSETS.md`);
        continue;
      }
      const img = join(root, ...logical.split('/'));
      if (!existsSync(img)) {
        err(file, `tileset "${ts.name}": image ${logical} not found`);
        continue;
      }
      const size = pngSize(readFileSync(img));
      if (!size) err(file, `tileset "${ts.name}": ${logical} is not a PNG`);
      else if (size.w !== ts.imagewidth || size.h !== ts.imageheight) err(file, `tileset "${ts.name}": ${logical} is ${size.w}x${size.h}, the map says ${ts.imagewidth}x${ts.imageheight}`);
      const row = assets.get(logical);
      if (!row || !row[1] || !row[3]) err(file, `tileset "${ts.name}": ${logical} has no row with a source and a licence in ASSETS.md`);
      else if (!/^CC0\b/.test(row[3])) err(file, `tileset "${ts.name}": ${logical} is licensed "${row[3]}" in ASSETS.md; tiles must be CC0`);
      tilesets.push({ map: id, name: ts.name, file: img });
    }

    // every tile id belongs to a tileset; the collision layer only uses colliding tiles
    const known = (gid: number) => ranges.some((r) => gid >= r.first && gid <= r.last);
    for (const l of tileLayers) {
      const bad = l.data.findIndex((g) => g !== 0 && !known(g & GID_MASK));
      if (bad >= 0) err(file, `layer "${l.name}": tile id ${l.data[bad]! & GID_MASK} at (${bad % map.width},${Math.floor(bad / map.width)}) is in no tileset`);
    }
    const collides = new Set<number>();
    for (const ts of map.tilesets) for (const t of ts.tiles ?? []) if (t.properties.some((x) => x.name === 'collides' && x.value === true)) collides.add(ts.firstgid + t.id);
    const col = tileLayer(map, 'collision');
    const loose = col ? col.data.findIndex((g) => g !== 0 && !collides.has(g & GID_MASK)) : -1;
    if (col && loose >= 0) err(file, `collision layer: the tile at (${loose % map.width},${Math.floor(loose / map.width)}) has no property collides: true`);

    // objects: unique names, inside the map, the right properties per type
    const objects = map.layers.flatMap((l) => (l.type === 'objectgroup' ? l.objects : []));
    const objNames = objects.map((o) => o.name);
    for (const n of new Set(objNames)) if (objNames.filter((x) => x === n).length > 1) err(file, `object name "${n}" is used twice`);
    for (const o of objects) {
      const at = objectTile(o);
      if (at.x >= map.width || at.y >= map.height) err(file, `object "${o.name}" lies outside the map`);
      const props = new Map((o.properties ?? []).map((x) => [x.name, x.value]));
      const allowed = o.type === 'spawn' ? ['facing'] : o.type === 'door' ? ['to_map', 'to_point', 'facing'] : [];
      for (const k of props.keys()) if (!allowed.includes(k)) err(file, `object "${o.name}" (${o.type}) may not have the property "${k}"`);
      if (props.has('facing') && !isFacing(props.get('facing'))) err(file, `object "${o.name}": facing must be up, down, left or right`);
      if (o.type === 'door' && (!props.has('to_map') || !props.has('to_point'))) err(file, `door "${o.name}" needs the properties to_map and to_point`);
    }
    if (errors.length === before) {
      maps.push({ id, map });
      worlds.set(id, readMap(id, map));
    }
  }

  // doors lead to a spawn point in a map that exists; spawn points and doors stand on open ground
  for (const [id, w] of worlds) {
    const file = join(mapsDir, `${id}.json`);
    for (const o of w.objects) {
      const open = !w.solid[o.y * w.width + o.x];
      if ((o.type === 'spawn' || o.type === 'door') && !open) err(file, `${o.type} "${o.name}" stands on a collision tile`);
      if (o.type !== 'door') continue;
      const target = worlds.get(o.props.to_map ?? '');
      if (!target) {
        if (!mapIds.includes(o.props.to_map ?? '')) err(file, `door "${o.name}" leads to unknown map "${o.props.to_map ?? ''}"`);
        continue;
      }
      const point = target.objects.find((x) => x.name === o.props.to_point);
      if (!point || point.type !== 'spawn') err(file, `door "${o.name}" leads to "${o.props.to_point ?? ''}", which is no spawn point in ${target.id}`);
    }
  }
  const playerStarts = [...worlds.values()].flatMap((w) => w.objects.filter((o) => o.name === 'player-start'));
  if (mapIds.length > 0 && worlds.size === mapIds.length && playerStarts.length !== 1) errors.push(`content/maps: exactly one map needs a spawn point "player-start" (found ${playerStarts.length})`);

  // ---- conditions
  const checkExpr = (file: string, where: string, src: string, reg: Registry): void => {
    try {
      compile(src, reg);
    } catch (e) {
      err(file, `${where}: ${(e as Error).message} in: ${src}`);
    }
  };

  // Name-like arguments must be literals, and the names must exist.
  const checkNames = (file: string, src: string, reg: Registry, known: (name: string, arg: string) => string | null): void => {
    let ast: Node;
    try {
      ast = compile(src, reg).ast;
    } catch {
      return; // already reported
    }
    for (const c of callsIn(ast)) {
      if (!NAME_ARGS.has(c.name)) continue;
      if (c.first?.kind !== 'lit') {
        err(file, `${c.name}() needs a quoted name, not an expression, in: ${src}`);
        continue;
      }
      const problem = known(c.name, String(c.first.value));
      if (problem) err(file, `${c.name}("${String(c.first.value)}"): ${problem}`);
    }
  };

  // ---- sprites
  const checkSprite = (dir: string, npc: NpcSpec): string | null => {
    if (!npc.sprite) return null;
    const file = join(dir, npc.sprite.file);
    if (!existsSync(file)) {
      err(join(dir, 'npc.yaml'), `sprite ${npc.sprite.file} not found`);
      return null;
    }
    const b = readFileSync(file);
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (b.length < 24 || !sig.every((x, i) => b[i] === x)) {
      err(file, 'not a PNG');
      return null;
    }
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const f = npc.sprite.frame;
    if (w !== 3 * f || h !== 4 * f) err(file, `sheet is ${w}x${h}; with ${f}px frames it must be ${3 * f}x${4 * f} (3 columns x 4 rows)`);
    return file;
  };

  // A town's map that content/maps does not have yet is planned: content written ahead of its
  // map (Senior Summit's interviews, say) may name it. Everything else about that content is
  // checked; only the map objects wait until the map lands, and the game cannot reach it before.
  const plannedMaps = new Set((roadmap?.towns ?? []).flatMap((t) => (t.map !== undefined && !mapIds.includes(t.map) ? [t.map] : [])));
  const checkMap = (file: string, map: string) => {
    if (!mapIds.includes(map) && !plannedMaps.has(map)) err(file, `unknown map "${map}" (neither in content/maps nor planned for a town in roadmap.yaml)`);
  };
  /** The object `name` in `map` must exist and have one of the types. Skipped when the map itself is broken. */
  const checkObject = (file: string, what: string, map: string, name: string, types: readonly string[]) => {
    const w = worlds.get(map);
    if (!w) return;
    const o = w.objects.find((x) => x.name === name);
    if (!o) err(file, `${what}: map ${map} has no object "${name}"`);
    else if (!types.includes(o.type)) err(file, `${what}: "${name}" in ${map} is a ${o.type}, expected ${types.join(' or ')}`);
  };

  // ---- npcs and quests
  const npcs: { npc: NpcSpec; dir: string; questId?: string }[] = [];
  const progressExprs: { file: string; src: string }[] = [];
  const progressFlags = new Set<string>();
  const checkNpc = (dir: string, npc: NpcSpec, local: LocaleMap | null, questId?: string) => {
    const file = join(dir, 'npc.yaml');
    const keys = [npc.name, ...npc.dialogue.flatMap((d) => d.lines)];
    for (const k of keys) if (local && !has(local, k)) err(file, `unknown locale key "${k}"`);
    npc.dialogue.forEach((d, i) => {
      if (d.when === undefined) return;
      checkExpr(file, `dialogue[${i}].when`, d.when, PROGRESS_FACTS);
      progressExprs.push({ file, src: d.when });
    });
    checkMap(file, npc.spawn.map);
    checkObject(file, 'spawn', npc.spawn.map, npc.spawn.slot, ['spawn']);
    if (!isNpcSlot(npc.spawn.slot)) err(file, `spawn.slot "${npc.spawn.slot}" must be npc-<n>, cameo-<n> or gate-<town>`);
    if (DENYLIST.test(npc.author.name)) err(file, 'author name uses a name we must not use (IP rule, AGENTS.md)');
    const sprite = checkSprite(dir, npc);
    if (sprite) sprites.push(questId ? { owner: 'quest', id: questId, file: sprite } : { owner: 'npc', id: npc.id, file: sprite });
    npcs.push({ npc, dir, ...(questId ? { questId } : {}) });
    return keys;
  };

  const worldNpcs: NpcSpec[] = [];
  const npcLocales: Record<LocaleId, LocaleMap> = { en: {}, nl: {} };
  const npcsDir = join(contentDir, 'npcs');
  if (existsSync(npcsDir)) {
    for (const id of readdirSync(npcsDir).sort()) {
      const dir = join(npcsDir, id);
      const npc = read<NpcSpec>(join(dir, 'npc.yaml'), 'npc');
      const loc = readLocales(join(dir, 'locales'));
      if (!npc) continue;
      if (npc.id !== id) err(join(dir, 'npc.yaml'), `id "${npc.id}" must equal the folder name "${id}"`);
      const used = checkNpc(dir, npc, loc?.en ?? null);
      if (loc) {
        for (const k of Object.keys(loc.en)) if (!used.includes(k)) err(join(dir, 'locales', 'en.yaml'), `unused key "${k}"`);
        for (const l of LOCALES) for (const [k, v] of Object.entries(loc[l])) npcLocales[l][npcKey(id, k)] = v;
      }
      worldNpcs.push(npc);
    }
  }

  // ---- battles: shape, references, and that the battle can be won and lost
  const STAGES = ['junior', 'medior', 'senior'];
  const gates = new Map<string, string>();
  const checkBattle = (file: string, id: string, quest: QuestSpec, b: BattleSpec, need: (file: string, key: string) => void): void => {
    [b.attacker, ...b.intro, ...b.outro.won, ...b.outro.lost].forEach((k) => need(file, k));
    const roundIds = b.rounds.map((r) => r.id);
    if (new Set(roundIds).size !== roundIds.length) err(file, 'round ids must be unique');
    for (const r of b.rounds) {
      const at = `round "${r.id}"`;
      r.prompt.forEach((k) => need(file, k));
      if (r.type === 'order') {
        const ids = r.items.map((i) => i.id);
        if (new Set(ids).size !== ids.length) err(file, `${at}: item ids must be unique`);
        r.items.forEach((i) => (need(file, i.text), need(file, i.why)));
        const ranks = r.items.map((i, n) => i.rank ?? n + 1);
        if (ranks.some((x, n) => n > 0 && x < ranks[n - 1]!)) err(file, `${at}: list the items in the right order (ranks must not go down)`);
        if (new Set(ranks).size === 1) err(file, `${at}: all items have the same rank, so there is nothing to order`);
        continue;
      }
      const ids = r.options.map((o) => o.id);
      if (new Set(ids).size !== ids.length) err(file, `${at}: option ids must be unique`);
      r.options.forEach((o) => (need(file, o.text), need(file, o.why)));
      const bests = r.options.filter((o) => o.grade === 'best').length;
      if (bests === 0) err(file, `${at}: needs an option graded best`);
      if (r.type === 'flaw') r.proposal.forEach((k) => need(file, k));
      if (r.type === 'clarify' && (r.pick ?? 1) >= r.options.length) err(file, `${at}: pick must be smaller than the number of options`);
      if (r.type === 'estimate') {
        need(file, r.working);
        if (bests !== 1) err(file, `${at}: exactly one range is graded best`);
        r.options.forEach((o, n) => {
          const last = n === r.options.length - 1;
          if (o.max === undefined && !last) err(file, `${at}: only the last range may leave out max`);
          if (o.max !== undefined && o.max <= o.min) err(file, `${at}: range "${o.id}" must have max above min`);
          const next = r.options[n + 1];
          if (next && o.max !== next.min) err(file, `${at}: range "${o.id}" must end where "${next.id}" starts (ranges ascend and touch)`);
        });
        const best = r.options.find((o) => o.grade === 'best');
        if (best && (r.value < best.min || (best.max !== undefined && r.value >= best.max))) err(file, `${at}: value ${r.value} is not in the range graded best`);
      }
    }
    const hintIds = (b.hints ?? []).map((h) => h.id);
    if (new Set(hintIds).size !== hintIds.length) err(file, 'hint ids must be unique');
    (b.hints ?? []).forEach((h, i) => {
      need(file, h.text);
      if (h.round !== undefined && !roundIds.includes(h.round)) err(file, `hints[${i}]: no round "${h.round}"`);
      checkExpr(file, `hints[${i}].when`, h.when, BATTLE_FACTS);
    });
    const t = b.trigger;
    if (t.kind === 'pager') {
      checkExpr(file, 'trigger.when', t.when, PROGRESS_FACTS);
      progressExprs.push({ file, src: t.when });
    }
    if (t.kind === 'gate' && roadmap) {
      const town = roadmap.towns.find((x) => x.id === t.town);
      if (!town) err(file, `trigger: unknown town "${t.town}"`);
      else if (STAGES.indexOf(town.stage) !== STAGES.indexOf(quest.stage) + 1) err(file, `trigger: the gate to ${town.id} (${town.stage}) must be a quest of the stage before it, not ${quest.stage}`);
      if (gates.has(t.town)) err(file, `trigger: ${gates.get(t.town)} already guards the road to ${t.town}`);
      gates.set(t.town, id);
    }
    // Play it both ways: a perfect play must win, the worst play must lose.
    try {
      const c = compileBattle(id, b);
      for (const [how, pick, want] of [['a perfect play', perfectAnswer, 'won'], ['the worst play', worstAnswer, 'lost']] as const) {
        let st = startBattle(c);
        for (let n = 0; n < b.rounds.length && st.status === 'active'; n++) st = answerRound(c, st, pick(b.rounds[st.round]!)).state;
        if (st.status !== want) err(file, `${how} ends ${st.status}; raise or lower the rounds' stakes (pressure ${c.max.pressure}, stakes add up to ${b.rounds.reduce((x, r) => x + r.stakes, 0)})`);
      }
    } catch (e) {
      err(file, `cannot start: ${(e as Error).message}`);
    }
  };

  const quests: QuestEntry[] = [];
  const questLocales: Record<LocaleId, LocaleMap> = { en: {}, nl: {} };
  const questsDir = join(contentDir, 'quests');
  const questIds = existsSync(questsDir) ? readdirSync(questsDir).sort() : [];
  for (const id of questIds) {
    const dir = join(questsDir, id);
    const qFile = join(dir, 'quest.yaml');
    const sFile = join(dir, 'scenario.yaml');
    const bFile = join(dir, 'battle.yaml');
    const quest = read<QuestSpec>(qFile, 'quest');
    const hasScenario = existsSync(sFile);
    const hasBattle = existsSync(bFile);
    if (hasScenario && hasBattle) err(bFile, 'a quest folder has scenario.yaml (a terminal quest) or battle.yaml (a battle), not both');
    const scenario = hasScenario || !hasBattle ? read<ScenarioSpec>(sFile, 'scenario') : null;
    const battle = hasBattle && !hasScenario ? read<BattleSpec>(bFile, 'battle') : null;
    const npc = existsSync(join(dir, 'npc.yaml')) ? read<NpcSpec>(join(dir, 'npc.yaml'), 'npc') : null;
    const loc = readLocales(join(dir, 'locales'));
    if (!quest || !loc || (!scenario && !battle)) continue;

    const used = new Set<string>();
    const need = (file: string, key: string) => {
      used.add(key);
      if (!has(loc.en, key)) err(file, `unknown locale key "${key}"`);
    };

    if (quest.id !== id) err(qFile, `id "${quest.id}" must equal the folder name "${id}"`);
    if (DENYLIST.test(quest.author.name)) err(qFile, 'author name uses a name we must not use (IP rule, AGENTS.md)');
    [quest.title, quest.summary, ...quest.dialogue.offer, ...quest.dialogue.active, ...quest.dialogue.done].forEach((k) => need(qFile, k));
    for (const r of quest.requires) {
      if (r === id) err(qFile, 'a quest cannot require itself');
      else if (!questIds.includes(r)) err(qFile, `requires unknown quest "${r}"`);
    }
    const node = roadmap?.nodes.find((n) => n.id === quest.roadmap_node);
    if (roadmap && !node) err(qFile, `unknown roadmap_node "${quest.roadmap_node}"`);
    if (node && node.branch !== quest.branch) err(qFile, `roadmap_node "${node.id}" is on branch ${node.branch}, the quest on ${quest.branch}`);
    checkMap(qFile, quest.start.map);
    // a terminal quest starts at a terminal; a battle at a battle object or where its giver stands
    checkObject(qFile, 'start', quest.start.map, quest.start.object, hasScenario ? ['terminal'] : ['battle', 'spawn']);

    if (scenario) {
      // scenario: paths, references, conditions
      const paths = [scenario.home, scenario.cwd, ...(scenario.dirs ?? []), ...Object.keys(scenario.files ?? {}), ...scenario.mounts.map((m) => m.path)];
      for (const p of paths) if (p !== undefined && normalize(p) !== p) err(sFile, `path "${p}" is not normalised (no trailing /, . or ..)`);
      if (!scenario.mounts.some((m) => m.path === '/')) err(sFile, 'a mount for "/" is required');
      if (new Set(scenario.mounts.map((m) => m.path)).size !== scenario.mounts.length) err(sFile, 'mount paths must be unique');
      need(sFile, scenario.motd);
      scenario.objectives.forEach((o, i) => {
        need(sFile, o.text);
        checkExpr(sFile, `objectives[${i}].done_when`, o.done_when, SCENARIO_FACTS);
      });
      (scenario.hints ?? []).forEach((h, i) => {
        need(sFile, h.text);
        checkExpr(sFile, `hints[${i}].when`, h.when, SCENARIO_FACTS);
      });
      (scenario.events ?? []).forEach((e, i) => {
        need(sFile, e.say);
        checkExpr(sFile, `events[${i}].when`, e.when, SCENARIO_FACTS);
      });
      if (scenario.outage?.say) need(sFile, scenario.outage.say);
      for (const [name, s] of Object.entries(scenario.services ?? {})) {
        if (s.restart?.succeeds_if) checkExpr(sFile, `services.${name}.restart.succeeds_if`, s.restart.succeeds_if, SCENARIO_FACTS);
      }
      for (const [name, d] of Object.entries(scenario.deployments ?? {})) {
        if (d.restart?.succeeds_if) checkExpr(sFile, `deployments.${name}.restart.succeeds_if`, d.restart.succeeds_if, SCENARIO_FACTS);
      }
      const ids = [...scenario.objectives, ...(scenario.hints ?? []), ...(scenario.events ?? [])].map((x) => x.id);
      if (new Set(ids).size !== ids.length) err(sFile, 'objective, hint and event ids must be unique');
      // quick commands: lines this terminal can parse, starting with one of its commands
      (scenario.quick ?? []).forEach((line, i) => {
        const parsed = parseLine(line);
        const ok = parsed.ok && parsed.pipeline.every((stage) => stage[0] !== undefined && has(COMMANDS, stage[0].text));
        if (!ok) err(sFile, `quick[${i}]: "${line}" must parse, and every stage must start with a command of this terminal`);
      });
      if (scenario.git?.pipeline) {
        const pf = normalize(`${scenario.git.root}/${scenario.git.pipeline.file}`);
        const f = scenario.files?.[pf];
        if (f === undefined || (typeof f !== 'string' && f.content === undefined)) err(sFile, `pipeline file ${pf} must be listed under files with content`);
      }
      // names used in conditions must exist in this scenario
      const allExprs = [
        ...scenario.objectives.map((o) => o.done_when),
        ...(scenario.hints ?? []).map((h) => h.when),
        ...(scenario.events ?? []).map((e) => e.when),
        ...Object.values(scenario.services ?? {}).flatMap((s) => (s.restart?.succeeds_if ? [s.restart.succeeds_if] : [])),
        ...Object.values(scenario.deployments ?? {}).flatMap((d) => (d.restart?.succeeds_if ? [d.restart.succeeds_if] : [])),
      ];
      const services = Object.keys(scenario.services ?? {});
      const deployments = Object.keys(scenario.deployments ?? {});
      const flags = (scenario.events ?? []).flatMap((e) => (e.set_flag ? [e.set_flag] : []));
      flags.forEach((f) => progressFlags.add(f));
      for (const src of allExprs) {
        checkNames(sFile, src, SCENARIO_FACTS, (name, arg) => {
          if (name === 'service' && !services.includes(arg)) return `no such service in this scenario`;
          if (name === 'pods_running' && !deployments.includes(arg)) return `no such deployment in this scenario`;
          if (name === 'restarted' && !services.includes(arg) && !deployments.includes(arg)) return `no such service or deployment`;
          if (name === 'flag' && !flags.includes(arg)) return `no event in this scenario sets that flag`;
          if (name === 'ran' && !has(COMMANDS, arg.split(' ')[0] ?? '')) return `not a command of this terminal`;
          return null;
        });
      }
      // the machine must make sense: nothing below a file, home and cwd are directories
      const filePaths = new Set(Object.keys(scenario.files ?? {}));
      for (const p of [...filePaths, ...(scenario.dirs ?? []), ...scenario.mounts.map((m) => m.path), ...(scenario.git ? [scenario.git.root] : []), scenario.home, scenario.cwd ?? scenario.home]) {
        for (let a = dirnameOf(p); a !== '/'; a = dirnameOf(a)) {
          if (filePaths.has(a)) err(sFile, `"${p}" lies below the file "${a}"`);
        }
      }
      for (const p of [scenario.home, scenario.cwd]) if (p !== undefined && filePaths.has(p)) err(sFile, `"${p}" must be a directory, it is a file`);
      // the whole thing must start
      try {
        createSession(scenario, { t: (k) => k });
      } catch (e) {
        err(sFile, `cannot start: ${(e as Error).message}`);
      }
    }
    if (battle) checkBattle(bFile, id, quest, battle, need);

    if (npc) {
      if (npc.id !== quest.giver) err(join(dir, 'npc.yaml'), `a quest folder's npc must be its giver ("${quest.giver}")`);
      for (const k of checkNpc(dir, npc, loc.en, id)) used.add(k);
    }

    for (const k of Object.keys(loc.en)) if (!used.has(k)) err(join(dir, 'locales', 'en.yaml'), `unused key "${k}"`);
    for (const l of LOCALES) for (const [k, v] of Object.entries(loc[l])) questLocales[l][questKey(id, k)] = v;
    quests.push({ id, quest, ...(scenario ? { scenario } : {}), ...(battle ? { battle } : {}), ...(npc ? { npc } : {}) });
  }

  // ---- every PNG is a sprite some npc.yaml declares (with its source and licence)
  const declared = new Set(sprites.map((x) => x.file));
  for (const file of contentFiles) {
    if (file.endsWith('.png') && !declared.has(file)) err(file, 'no npc.yaml declares this image (sprite: file, source, license)');
  }

  // ---- progress conditions name real quests, items, branches and flags
  const shopIds = shop?.items.map((i) => i.id) ?? [];
  const branchIds = roadmap?.branches.map((b) => b.id as string) ?? [];
  for (const { file, src } of progressExprs) {
    checkNames(file, src, PROGRESS_FACTS, (name, arg) => {
      if (name === 'quest' && !questIds.includes(arg)) return 'no such quest';
      if (name === 'has_item' && !shopIds.includes(arg)) return 'no such shop item';
      if (name === 'xp' && !branchIds.includes(arg)) return 'no such branch';
      if (name === 'flag' && !progressFlags.has(arg)) return 'no event sets that flag';
      return null;
    });
  }

  // ---- no "requires" cycles: a cycle would lock its members forever
  const cycleCheck = (what: string, edges: Record<string, readonly string[]>) => {
    const c = findCycle(edges);
    if (c.length > 0) errors.push(`content: ${what} requirements form a cycle: ${c.join(' -> ')}`);
  };
  cycleCheck('quest', Object.fromEntries(quests.map((q) => [q.id, q.quest.requires])));
  if (roadmap) cycleCheck('roadmap node', Object.fromEntries(roadmap.nodes.map((n) => [n.id, n.requires])));
  if (shop) cycleCheck('shop item', Object.fromEntries(shop.items.map((i) => [i.id, i.requires])));

  // ---- cross-folder checks
  const npcIds = npcs.map((n) => n.npc.id);
  for (const id of new Set(npcIds)) if (npcIds.filter((x) => x === id).length > 1) errors.push(`content: npc id "${id}" is used twice`);
  const slots = npcs.map((n) => `${n.npc.spawn.map}/${n.npc.spawn.slot}`);
  for (const s of new Set(slots)) if (slots.filter((x) => x === s).length > 1) errors.push(`content: spawn slot ${s} is taken twice`);
  for (const q of quests) {
    if (!npcIds.includes(q.quest.giver)) errors.push(`content/quests/${q.id}/quest.yaml: giver "${q.quest.giver}" is not an npc`);
  }

  // ---- maps against content: every terminal and battle object starts a quest, gates exist, and
  // everything can be reached on foot from where the player arrives
  const questStarts = new Set(quests.map((q) => `${q.quest.start.map}/${q.quest.start.object}`));
  for (const [id, w] of worlds) {
    const file = join(mapsDir, `${id}.json`);
    for (const o of w.objects) {
      if ((o.type === 'terminal' || o.type === 'battle') && !questStarts.has(`${id}/${o.name}`)) {
        err(file, `${o.type} "${o.name}" starts no quest (no quest.yaml has start: {map: ${id}, object: ${o.name}})`);
      }
    }
    // where the player can appear: player-start and every spawn point a door leads to
    const arrivals = new Set<string>(w.objects.filter((o) => o.name === 'player-start').map((o) => o.name));
    for (const other of worlds.values()) for (const d of other.objects) if (d.type === 'door' && d.props.to_map === id && d.props.to_point) arrivals.add(d.props.to_point);
    const startTiles = w.objects.filter((o) => arrivals.has(o.name));
    if (startTiles.length === 0) {
      err(file, 'the player can never get here: no player-start and no door leads to this map');
      continue;
    }
    const occupied = new Set(w.objects.filter((o) => isNpcSlot(o.name)).map((o) => `${o.x},${o.y}`));
    const seen = reachable(w, startTiles, occupied);
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w.width && y < w.height && seen[y * w.width + x] === 1;
    for (const o of w.objects) {
      const standOn = (o.type === 'spawn' && !isNpcSlot(o.name)) || o.type === 'door';
      const ok = standOn ? at(o.x, o.y) : at(o.x, o.y - 1) || at(o.x, o.y + 1) || at(o.x - 1, o.y) || at(o.x + 1, o.y);
      if (!ok) err(file, `${o.type} "${o.name}" at (${o.x},${o.y}) cannot be reached on foot`);
    }
  }
  for (const q of quests) {
    const t = q.battle?.trigger;
    if (t?.kind === 'gate' && worlds.size > 0 && ![...worlds.values()].some((w) => w.objects.some((o) => o.name === `gate-${t.town}`))) {
      errors.push(`content/quests/${q.id}/battle.yaml: no map has the object "gate-${t.town}" for this gate`);
    }
  }

  if (errors.length > 0 || !global || !roadmap || !shop) return { bundle: null, errors, sprites, tilesets };

  // ---- credits, from author fields
  const credits = new Map<string, Credit>();
  const credit = (a: { name: string; handle?: string; url?: string }, what: string) => {
    const c = credits.get(a.name) ?? { name: a.name, ...(a.handle ? { handle: a.handle } : {}), ...(a.url ? { url: a.url } : {}), for: [] };
    c.for.push(what);
    credits.set(a.name, c);
  };
  for (const q of quests) credit(q.quest.author, `quest:${q.id}`);
  for (const n of npcs) credit(n.npc.author, `npc:${n.npc.id}`);

  const merged = {} as Record<LocaleId, LocaleMap>;
  for (const l of LOCALES) merged[l] = { ...global[l], ...npcLocales[l], ...questLocales[l] };

  return {
    bundle: { locales: merged, quests, npcs: worldNpcs, roadmap, shop, credits: [...credits.values()], maps },
    errors,
    sprites,
    tilesets,
  };
}
