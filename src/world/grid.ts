// The world as a grid (pure: no Phaser, no DOM). WorldScene renders it; the content validator
// uses the same code to check that every NPC, terminal and door can be reached.

import type { MapObjectType, TiledMap, TiledObject, TiledObjectLayer, TiledTileLayer } from '../content/types';
import { own, setOwn } from '../rules/own';

export const TILE = 16;

export type Facing = 'up' | 'down' | 'left' | 'right';
export const FACINGS: readonly Facing[] = ['down', 'left', 'right', 'up'];
export const STEP: Record<Facing, { dx: number; dy: number }> = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};
export const OPPOSITE: Record<Facing, Facing> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** Tiled stores flips in the top bits of a tile id. */
export const GID_MASK = 0x0fffffff;

export interface WorldObject {
  name: string;
  type: MapObjectType;
  x: number;
  y: number;
  props: Record<string, string>;
}

export interface WorldMap {
  id: string;
  width: number;
  height: number;
  /** 1 where the collision layer blocks the tile */
  solid: Uint8Array;
  objects: WorldObject[];
}

export const isFacing = (s: unknown): s is Facing => typeof s === 'string' && (FACINGS as readonly string[]).includes(s);

/** NPC slots: an NPC may stand on these, so they are not free to walk through. */
export const isNpcSlot = (name: string): boolean => /^(npc|cameo)-[0-9]+$|^gate-[a-z0-9-]+$/.test(name);

export function tileLayer(map: TiledMap, name: string): TiledTileLayer | undefined {
  return map.layers.find((l): l is TiledTileLayer => l.type === 'tilelayer' && l.name === name);
}

export function objectLayer(map: TiledMap): TiledObjectLayer | undefined {
  return map.layers.find((l): l is TiledObjectLayer => l.type === 'objectgroup');
}

/** The tile an object stands on: its centre, so points and rectangles both work. */
export function objectTile(o: Pick<TiledObject, 'x' | 'y' | 'width' | 'height'>): { x: number; y: number } {
  return { x: Math.floor((o.x + (o.width ?? 0) / 2) / TILE), y: Math.floor((o.y + (o.height ?? 0) / 2) / TILE) };
}

/** Tile ids (global) whose tile has collides: true. */
export function collidingGids(map: TiledMap): Set<number> {
  const out = new Set<number>();
  for (const ts of map.tilesets) {
    for (const t of ts.tiles ?? []) {
      if (t.properties.some((p) => p.name === 'collides' && p.value === true)) out.add(ts.firstgid + t.id);
    }
  }
  return out;
}

export function readMap(id: string, map: TiledMap): WorldMap {
  const solid = new Uint8Array(map.width * map.height);
  const collides = collidingGids(map);
  const layer = tileLayer(map, 'collision');
  layer?.data.forEach((gid, i) => {
    if (collides.has(gid & GID_MASK)) solid[i] = 1;
  });
  const objects = (objectLayer(map)?.objects ?? []).map((o) => {
    const props: Record<string, string> = {};
    for (const p of o.properties ?? []) if (typeof p.value === 'string') setOwn(props, p.name, p.value);
    return { name: o.name, type: o.type, ...objectTile(o), props };
  });
  return { id, width: map.width, height: map.height, solid, objects };
}

export const inside = (w: WorldMap, x: number, y: number): boolean => x >= 0 && y >= 0 && x < w.width && y < w.height;

export const isSolid = (w: WorldMap, x: number, y: number): boolean => !inside(w, x, y) || w.solid[y * w.width + x] === 1;

export function objectNamed(w: WorldMap, name: string): WorldObject | undefined {
  return w.objects.find((o) => o.name === name);
}

export function objectsAt(w: WorldMap, x: number, y: number): WorldObject[] {
  return w.objects.filter((o) => o.x === x && o.y === y);
}

export function ahead(x: number, y: number, facing: Facing): { x: number; y: number } {
  return { x: x + STEP[facing].dx, y: y + STEP[facing].dy };
}

/** Can the player step onto (x, y)? `occupied` holds "x,y" keys of tiles where someone stands. */
export function canEnter(w: WorldMap, x: number, y: number, occupied: ReadonlySet<string> = new Set()): boolean {
  return !isSolid(w, x, y) && !occupied.has(`${x},${y}`);
}

/** Tiles reachable on foot from the starts, as a 0/1 grid. */
export function reachable(w: WorldMap, starts: readonly { x: number; y: number }[], occupied: ReadonlySet<string> = new Set()): Uint8Array {
  const seen = new Uint8Array(w.width * w.height);
  const queue: [number, number][] = [];
  for (const s of starts) {
    if (inside(w, s.x, s.y) && !seen[s.y * w.width + s.x]) {
      seen[s.y * w.width + s.x] = 1;
      queue.push([s.x, s.y]);
    }
  }
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const f of FACINGS) {
      const n = ahead(x, y, f);
      if (canEnter(w, n.x, n.y, occupied) && !seen[n.y * w.width + n.x]) {
        seen[n.y * w.width + n.x] = 1;
        queue.push([n.x, n.y]);
      }
    }
  }
  return seen;
}

/** Facing from a property value, or the fallback. */
export function facingOf(props: Record<string, string>, fallback: Facing = 'down'): Facing {
  const f = own(props, 'facing');
  return isFacing(f) ? f : fallback;
}

const key = (x: number, y: number): string => `${x},${y}`;

/** Door tiles of a map, as "x,y" keys: a walk only steps on one when it is the goal. */
export function doorTiles(w: WorldMap): Set<string> {
  return new Set(w.objects.filter((o) => o.type === 'door').map((o) => key(o.x, o.y)));
}

/**
 * The shortest walk from one tile to another (tap to walk): the steps to take, [] when already
 * there, null when it cannot be reached. Breadth-first over the four directions, so it is
 * deterministic. Tiles in `occupied` (NPCs) never take a step; tiles in `avoid` (doors) only
 * when they are the goal, so a walk never leaves the map by accident.
 */
export function findPath(
  w: WorldMap,
  from: { x: number; y: number },
  to: { x: number; y: number },
  occupied: ReadonlySet<string> = new Set(),
  avoid: ReadonlySet<string> = new Set(),
): Facing[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  if (!canEnter(w, to.x, to.y, occupied)) return null;
  const prev = new Map<string, { from: string; dir: Facing }>();
  const start = key(from.x, from.y);
  const goal = key(to.x, to.y);
  const seen = new Set([start]);
  const queue: [number, number][] = [[from.x, from.y]];
  while (queue.length > 0) {
    const [x, y] = queue.shift()!;
    for (const f of FACINGS) {
      const n = ahead(x, y, f);
      const k = key(n.x, n.y);
      if (seen.has(k) || !canEnter(w, n.x, n.y, occupied) || (avoid.has(k) && k !== goal)) continue;
      seen.add(k);
      prev.set(k, { from: key(x, y), dir: f });
      if (k === goal) {
        const steps: Facing[] = [];
        for (let at = goal; at !== start; ) {
          const p = prev.get(at)!;
          steps.push(p.dir);
          at = p.from;
        }
        return steps.reverse();
      }
      queue.push([n.x, n.y]);
    }
  }
  return null;
}

/**
 * How to walk up to a tile and face it (tap an NPC, a terminal or the shop counter): the
 * shortest walk to a free neighbour, and the facing that looks at the target from there. Null
 * when no neighbour can be reached.
 */
export function approach(
  w: WorldMap,
  from: { x: number; y: number },
  target: { x: number; y: number },
  occupied: ReadonlySet<string> = new Set(),
  avoid: ReadonlySet<string> = new Set(),
): { path: Facing[]; facing: Facing } | null {
  let best: { path: Facing[]; facing: Facing } | null = null;
  for (const facing of FACINGS) {
    // stand one step back from the target, looking towards it
    const spot = { x: target.x - STEP[facing].dx, y: target.y - STEP[facing].dy };
    if (avoid.has(key(spot.x, spot.y))) continue;
    const path = findPath(w, from, spot, occupied, avoid);
    if (path && (!best || path.length < best.path.length)) best = { path, facing };
  }
  return best;
}
