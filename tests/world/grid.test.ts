// The world grid on the real maps: where the player starts, what blocks, what doors do.

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ahead, canEnter, facingOf, isNpcSlot, isSolid, objectNamed, objectsAt, objectTile, readMap, reachable, type WorldMap } from '../../src/world/grid';
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

  it('the server room racks are terminals of the two server-room quests, reachable from the entrance', () => {
    const r = world('server-room');
    const starts = content().quests.filter((q) => q.quest.start.map === 'server-room').map((q) => q.quest.start.object).sort();
    expect(starts).toEqual(['rack-app-01', 'rack-web-01']);
    const seen = reachable(r, [objectNamed(r, 'entrance')!]);
    for (const name of starts) {
      const o = objectNamed(r, name)!;
      expect(o.type).toBe('terminal');
      expect(isSolid(r, o.x, o.y)).toBe(true); // a rack is furniture: you face it, you do not stand on it
      expect(seen[(o.y + 1) * r.width + o.x], `${name} from below`).toBe(1);
    }
  });

  it('every content NPC stands on a spawn slot of its map', () => {
    const npcs = [...content().npcs, ...content().quests.flatMap((q) => (q.npc ? [q.npc] : []))];
    expect(npcs.map((n) => n.id).sort()).toEqual(['bas', 'daan', 'femke', 'ingrid', 'ravi']);
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

describe('own art', () => {
  it('the committed PNGs are what tools/art/draw-art.mjs draws', () => {
    expect(() => execFileSync(process.execPath, [join(ROOT, 'tools', 'art', 'draw-art.mjs'), '--check'], { stdio: 'pipe' })).not.toThrow();
  });
});
