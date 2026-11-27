// The world grid on the real maps: where the player starts, what blocks, what doors do.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ahead,
  approach,
  canEnter,
  doorTiles,
  type Facing,
  facingOf,
  findPath,
  isNpcSlot,
  isSolid,
  objectNamed,
  objectsAt,
  objectTile,
  readMap,
  reachable,
  type WorldMap,
} from '../../src/world/grid';
import { content, ROOT } from '../helpers';

const world = (id: string): WorldMap => {
  const m = content().maps.find((x) => x.id === id);
  if (!m) throw new Error(`no map ${id}`);
  return readMap(id, m.map);
};

describe('the world grid', () => {
  it('both maps are in the bundle at the sizes DESIGN.md gives', () => {
    expect(content().maps.map((m) => m.id).sort()).toEqual(['junior-village', 'server-room']);
    const v = world('junior-village');
    const r = world('server-room');
    expect([v.width, v.height]).toEqual([40, 30]);
    expect([r.width, r.height]).toEqual([15, 10]);
  });

  it('the player starts on open ground in Junior Village, facing down', () => {
    const v = world('junior-village');
    const start = objectNamed(v, 'player-start')!;
    expect(isSolid(v, start.x, start.y)).toBe(false);
    expect(facingOf(start.props)).toBe('down');
  });

  it('walls, buildings and the map edge block; NPCs block the tile they stand on', () => {
    const v = world('junior-village');
    expect(isSolid(v, -1, 5)).toBe(true);
    expect(isSolid(v, 40, 5)).toBe(true);
    expect(isSolid(v, 0, 0)).toBe(true); // the woods
    expect(isSolid(v, 5, 8)).toBe(true); // the data centre's roof
    const femke = objectNamed(v, 'npc-1')!;
    expect(canEnter(v, femke.x, femke.y)).toBe(true);
    expect(canEnter(v, femke.x, femke.y, new Set([`${femke.x},${femke.y}`]))).toBe(false);
  });

  it('the data centre door leads into the server room and back out', () => {
    const v = world('junior-village');
    const r = world('server-room');
    const door = objectNamed(v, 'server-room-door')!;
    expect(door.type).toBe('door');
    expect(door.props).toMatchObject({ to_map: 'server-room', to_point: 'entrance' });
    const entrance = objectNamed(r, 'entrance')!;
    const exit = objectNamed(r, 'exit')!;
    expect(exit.props).toMatchObject({ to_map: 'junior-village', to_point: 'server-room-exit' });
    // arriving never lands on a door, so a door cannot bounce the player straight back
    expect(objectsAt(r, entrance.x, entrance.y).some((o) => o.type === 'door')).toBe(false);
    const back = objectNamed(v, 'server-room-exit')!;
    expect(objectsAt(v, back.x, back.y).some((o) => o.type === 'door')).toBe(false);
    // walking down from the entrance reaches the exit mat
    expect(ahead(entrance.x, entrance.y, 'down')).toEqual({ x: exit.x, y: exit.y });
  });

  it('the server room racks are terminals: the server-room quests\' (the Kubernetes jump host too) and two spare cameo racks, reachable from the entrance', () => {
    const r = world('server-room');
    const racks = r.objects.filter((o) => o.type === 'terminal').map((o) => o.name).sort();
    expect(racks).toEqual(['cameo-rack-1', 'cameo-rack-2', 'rack-app-01', 'rack-bakery-01', 'rack-bank-01', 'rack-k8s-01', 'rack-web-01']);
    // more quests may start here (a cameo claims a spare rack), but not on a machine that is not there
    const starts = content().quests.filter((q) => q.quest.start.map === 'server-room').map((q) => q.quest.start.object);
    expect(starts).toEqual(expect.arrayContaining(['rack-app-01', 'rack-bakery-01', 'rack-bank-01', 'rack-k8s-01', 'rack-web-01']));
    for (const s of starts) expect(racks).toContain(s);
    const seen = reachable(r, [objectNamed(r, 'entrance')!]);
    for (const name of racks) {
      const o = objectNamed(r, name)!;
      expect(isSolid(r, o.x, o.y)).toBe(true); // a rack is furniture: you face it, you do not stand on it
      expect(seen[(o.y + 1) * r.width + o.x], `${name} from below`).toBe(1);
    }
  });

  it('every content NPC stands on a spawn slot of its map', () => {
    // NPCs on a planned map (roadmap.yaml names it, content/maps has no file yet) wait for it
    const built = new Set(content().maps.map((m) => m.id));
    const all = [...content().npcs, ...content().quests.flatMap((q) => (q.npc ? [q.npc] : []))];
    const npcs = all.filter((n) => built.has(n.spawn.map));
    // at least these; a guest cameo adds its own
    expect(npcs.map((n) => n.id)).toEqual(expect.arrayContaining(['bas', 'daan', 'femke', 'ingrid', 'ravi']));
    const planned = new Set(content().roadmap.towns.flatMap((t) => (t.map ? [t.map] : [])));
    for (const n of all) if (!built.has(n.spawn.map)) expect(planned.has(n.spawn.map), n.id).toBe(true);
    for (const n of npcs) {
      const slot = objectNamed(world(n.spawn.map), n.spawn.slot);
      expect(slot?.type, n.id).toBe('spawn');
      expect(isNpcSlot(n.spawn.slot), n.id).toBe(true);
    }
  });

  it('object tiles come from the object centre, for points and rectangles', () => {
    expect(objectTile({ x: 24, y: 40 })).toEqual({ x: 1, y: 2 });
    expect(objectTile({ x: 16, y: 32, width: 16, height: 16 })).toEqual({ x: 1, y: 2 });
  });
});

/** Walk a path step by step, checking every tile on the way can be entered. */
function walk(w: WorldMap, from: { x: number; y: number }, steps: readonly Facing[], occupied = new Set<string>()): { x: number; y: number } {
  let at = from;
  for (const f of steps) {
    at = ahead(at.x, at.y, f);
    expect(canEnter(w, at.x, at.y, occupied), `step onto ${at.x},${at.y}`).toBe(true);
  }
  return at;
}

describe('tap to walk: paths on the grid', () => {
  it('finds the shortest walk between two open tiles, and [] for no walk at all', () => {
    const r = world('server-room');
    const entrance = objectNamed(r, 'entrance')!;
    expect(findPath(r, entrance, entrance)).toEqual([]);
    const goal = { x: entrance.x, y: entrance.y - 3 };
    const path = findPath(r, entrance, goal)!;
    expect(path).toEqual(['up', 'up', 'up']);
    expect(walk(r, entrance, path)).toEqual(goal);
  });

  it('refuses a solid goal, an occupied goal and a goal that cannot be reached', () => {
    const v = world('junior-village');
    const start = objectNamed(v, 'player-start')!;
    expect(findPath(v, start, { x: 0, y: 0 })).toBeNull(); // the woods
    const femke = objectNamed(v, 'npc-1')!;
    expect(findPath(v, start, femke, new Set([`${femke.x},${femke.y}`]))).toBeNull();
    expect(findPath(v, start, { x: -1, y: 3 })).toBeNull();
  });

  it('walks around NPCs and never through a door unless the door is the goal', () => {
    const v = world('junior-village');
    const start = objectNamed(v, 'player-start')!;
    const door = objectNamed(v, 'server-room-door')!;
    const doors = doorTiles(v);
    expect(doors.has(`${door.x},${door.y}`)).toBe(true);
    const occupied = new Set(['npc-1', 'npc-2', 'npc-3', 'npc-4'].map((n) => objectNamed(v, n)!).map((o) => `${o.x},${o.y}`));
    const toDoor = findPath(v, start, door, occupied, doors)!;
    expect(walk(v, start, toDoor, occupied)).toEqual({ x: door.x, y: door.y });
    // a walk past the door to the tile just outside it does not step on the door
    const exit = objectNamed(v, 'server-room-exit')!;
    const toExit = findPath(v, start, exit, occupied, doors)!;
    let at = { x: start.x, y: start.y };
    for (const f of toExit) {
      at = ahead(at.x, at.y, f);
      expect(doors.has(`${at.x},${at.y}`)).toBe(false);
    }
    expect(at).toEqual({ x: exit.x, y: exit.y });
  });

  it('walks up to a terminal, an NPC and the shop counter and faces it', () => {
    const v = world('junior-village');
    const start = objectNamed(v, 'player-start')!;
    const doors = doorTiles(v);
    const occupied = new Set(['npc-1', 'npc-2', 'npc-3', 'npc-4'].map((n) => objectNamed(v, n)!).map((o) => `${o.x},${o.y}`));
    for (const name of ['ravi-laptop', 'homelab-store', 'npc-1']) {
      const target = objectNamed(v, name)!;
      const a = approach(v, start, target, occupied, doors);
      expect(a, name).not.toBeNull();
      const at = walk(v, start, a!.path, occupied);
      expect(ahead(at.x, at.y, a!.facing), name).toEqual({ x: target.x, y: target.y });
    }
    // standing next to it already: no steps, only the facing
    const r = world('server-room');
    const rack = objectNamed(r, 'rack-web-01')!;
    expect(approach(r, { x: rack.x, y: rack.y + 1 }, rack)).toEqual({ path: [], facing: 'up' });
  });
});

describe('own art', () => {
  it('the committed PNGs are what tools/art/draw-art.mjs draws', () => {
    expect(() => execFileSync(process.execPath, [join(ROOT, 'tools', 'art', 'draw-art.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
