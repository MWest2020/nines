// The world: a Tiled map, the player on a 16 px grid, NPCs, doors and the things you can use.
// Rules live in src/world/grid.ts (pure, tested); this scene renders and reads the keyboard, the
// on-screen D-pad and use button (src/game/touch), and taps: a tap on open ground walks there
// along the shortest path, a tap on an NPC or a thing you can use walks up to it and uses it.

import Phaser from 'phaser';
import content from 'virtual:nines-content';
import type { MapEntry, QuestEntry } from '../content/types';
import { progressEnv } from '../core/progress';
import { compile, test } from '../rules/expr';
import { own } from '../rules/own';
import { PROGRESS_FACTS } from '../rules/registries';
import {
  ahead,
  approach,
  canEnter,
  doorTiles,
  findPath,
  facingOf,
  isFacing,
  isSolid,
  objectNamed,
  objectsAt,
  OPPOSITE,
  readMap,
  TILE,
  type Facing,
  type WorldMap,
} from '../world/grid';
import { type GameApi, getGameApi } from './api';
import { PAD_EVENTS, padState } from './touch/pad';
import { BAND, VIEW } from './ui/theme';
import { freshKeys } from './ui/widgets';
import { WORLD_EVENTS, type EnterEvent, type TalkEvent, type UseEvent, type WorldStart } from './world/events';
import { PlaceholderDialogue } from './world/PlaceholderDialogue';
import { allNpcs, type NpcEntry, PLAYER_KEY, standFrame, tilesetKey, walkAnim } from './world/sprites';

const STEP_MS = 250; // one tile per 250 ms (DESIGN.md)
const TURN_MS = 90; // a tap turns, holding walks
const DEFAULT_MAP = 'junior-village';

interface Actor {
  sprite: Phaser.GameObjects.Sprite;
  key: string;
  x: number;
  y: number;
  facing: Facing;
}

interface Npc extends Actor {
  entry: NpcEntry;
}

export class WorldScene extends Phaser.Scene {
  private start: WorldStart = {};
  private entry!: MapEntry;
  private world!: WorldMap;
  private player!: Actor;
  private npcs: Npc[] = [];
  private moving = false;
  private busy = false;
  private turnedAt = 0;
  /** a walk from a tap: the steps still to take, then what to face and use at the end */
  private route: Facing[] = [];
  private routeEnd: { facing: Facing; use: boolean } | null = null;
  /** the pointer went down while the world was free (so a tap that closed a dialogue is not a walk) */
  private tapStarted = false;
  private dialogue: PlaceholderDialogue | null = null;
  /** strings, progress and the busy flag come from the one live game (src/game/api.ts) */
  private api!: GameApi;
  private keys!: {
    up: Phaser.Input.Keyboard.Key[];
    down: Phaser.Input.Keyboard.Key[];
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
  };

  constructor() {
    super('world');
  }

  init(data: WorldStart): void {
    this.start = data ?? {};
    this.npcs = [];
    this.moving = false;
    this.busy = false;
    this.dialogue = null;
    this.route = [];
    this.routeEnd = null;
    this.tapStarted = false;
  }

  create(): void {
    this.api = getGameApi(this);
    this.entry = content.maps.find((m) => m.id === this.start.map) ?? content.maps.find((m) => m.id === DEFAULT_MAP) ?? content.maps[0]!;
    this.world = readMap(this.entry.id, this.entry.map);

    this.drawMap();
    this.placeNpcs();
    this.placePlayer();
    this.bindKeys();
    this.bindTouch();

    const cam = this.cameras.main;
    // the view sits under the HUD band, so the bar never hides a row of the map
    cam.setViewport(0, BAND, VIEW.width, VIEW.height);
    cam.setBounds(0, 0, this.world.width * TILE, this.world.height * TILE);
    cam.startFollow(this.player.sprite, true);
    cam.setRoundPixels(true);
    cam.fadeIn(150, 16, 24, 32);

    const enter: EnterEvent = { map: this.world.id, x: this.player.x, y: this.player.y, facing: this.player.facing };
    this.game.events.emit(WORLD_EVENTS.enter, enter);
  }

  // ---- building the scene

  private drawMap(): void {
    const map = this.make.tilemap({ key: `map:${this.entry.id}` });
    const tilesets = this.entry.map.tilesets.flatMap((ts) => {
      const url = own(this.entry.images ?? {}, ts.name);
      const set = url ? map.addTilesetImage(ts.name, tilesetKey(url), TILE, TILE, 0, ts.spacing ?? 0) : null;
      return set ? [set] : [];
    });
    const depth: Record<string, number> = { ground: 0, detail: 1, props: 2, above: 5000 };
    for (const name of ['ground', 'detail', 'props', 'above']) {
      if (!this.entry.map.layers.some((l) => l.name === name)) continue;
      map.createLayer(name, tilesets)?.setDepth(depth[name] ?? 0);
    }
    // the racks' LEDs blink: swap the two LED states of our own rack tiles
    const own_ = this.entry.map.tilesets.find((ts) => ts.name === 'nines-tiles');
    const detail = map.getLayer('detail')?.tilemapLayer;
    if (own_ && detail) {
      const g = own_.firstgid;
      this.time.addEvent({
        delay: 700,
        loop: true,
        callback: () => {
          detail.swapByIndex(g + 1, g + 2);
          detail.swapByIndex(g + 3, g + 4);
        },
      });
    }
  }

  private actor(key: string, x: number, y: number, facing: Facing): Actor {
    const sprite = this.add.sprite(x * TILE + TILE / 2, y * TILE + TILE, key, standFrame(facing)).setOrigin(0.5, 1);
    sprite.setDepth(10 + y);
    return { sprite, key, x, y, facing };
  }

  private placeNpcs(): void {
    for (const entry of allNpcs(content)) {
      if (entry.npc.spawn.map !== this.world.id) continue;
      const slot = objectNamed(this.world, entry.npc.spawn.slot);
      if (!slot) continue;
      const a = this.actor(entry.textureKey, slot.x, slot.y, entry.npc.spawn.facing ?? 'down');
      this.npcs.push({ ...a, entry });
    }
  }

  private placePlayer(): void {
    const s = this.start;
    let x: number | undefined;
    let y: number | undefined;
    let facing: Facing = s.facing ?? 'down';
    const point = objectNamed(this.world, s.point ?? '') ?? (s.x === undefined ? objectNamed(this.world, 'player-start') : undefined);
    if (point) {
      x = point.x;
      y = point.y;
      facing = s.facing ?? facingOf(point.props);
    } else if (s.x !== undefined && s.y !== undefined && !isSolid(this.world, s.x, s.y)) {
      x = s.x;
      y = s.y;
    }
    if (x === undefined || y === undefined) {
      // a saved spot that no longer fits the map: fall back to the first spawn point
      const any = objectNamed(this.world, 'player-start') ?? this.world.objects.find((o) => o.type === 'spawn')!;
      x = any.x;
      y = any.y;
    }
    this.player = this.actor(PLAYER_KEY, x, y, facing);
  }

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    const K = Phaser.Input.Keyboard.KeyCodes;
    const keys = (...codes: number[]) => codes.map((c) => kb.addKey(c));
    this.keys = {
      up: keys(K.UP, K.W),
      down: keys(K.DOWN, K.S),
      left: keys(K.LEFT, K.A),
      right: keys(K.RIGHT, K.D),
    };
    // freshKeys: Phaser can deliver one key event twice within a frame; act on each press once
    kb.on(
      'keydown',
      freshKeys((e: KeyboardEvent) => {
        if (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter') this.onUse();
        else if (e.code === 'Escape') this.dialogue?.close();
      }),
    );
  }

  /** The on-screen use and back buttons, and taps on the map. */
  private bindTouch(): void {
    const events = this.game.events;
    const onUse = () => {
      if (!this.dialogue) this.onUse();
    };
    const onBack = () => this.dialogue?.close();
    events.on(PAD_EVENTS.use, onUse);
    events.on(PAD_EVENTS.back, onBack);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      events.off(PAD_EVENTS.use, onUse);
      events.off(PAD_EVENTS.back, onBack);
    });
    this.input.on('pointerdown', () => {
      this.tapStarted = !this.waiting();
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      const started = this.tapStarted;
      this.tapStarted = false;
      // a tap (the main button), not a drag, that began and ends while the world is free
      if (!started || this.waiting() || p.button !== 0 || p.getDistance() > 12) return;
      const cam = this.cameras.main;
      if (p.y < cam.y || p.y >= cam.y + cam.height) return; // the HUD band is not the map
      const at = cam.getWorldPoint(p.x, p.y);
      this.tapTile(Math.floor(at.x / TILE), Math.floor(at.y / TILE));
    });
  }

  /** Walk to a tapped tile; walk up to an NPC or a usable thing and use it. */
  private tapTile(x: number, y: number): void {
    const p = this.player;
    const occupied = this.occupied();
    const doors = doorTiles(this.world);
    const usable =
      this.npcs.some((n) => n.x === x && n.y === y) || objectsAt(this.world, x, y).some((o) => o.type === 'terminal' || o.type === 'battle' || o.type === 'shop');
    this.route = [];
    this.routeEnd = null;
    if (x === p.x && y === p.y) return;
    if (usable) {
      // a person or a thing: stand next to it, face it and use it
      const a = approach(this.world, p, { x, y }, occupied, doors);
      if (!a) return;
      this.route = a.path;
      this.routeEnd = { facing: a.facing, use: true };
      return;
    }
    // open ground: walk there; a wall or a tree: nothing
    this.route = findPath(this.world, p, { x, y }, occupied, doors) ?? [];
  }

  /** Take the next step of a tap walk, or finish it. Returns false when there is none. */
  private followRoute(): boolean {
    const next = this.route.shift();
    if (next) {
      this.player.facing = next;
      if (!this.step(next)) {
        // someone stepped in the way: stop here
        this.route = [];
        this.routeEnd = null;
      }
      return true;
    }
    const end = this.routeEnd;
    if (!end) return false;
    this.routeEnd = null;
    this.face(this.player, end.facing);
    if (end.use) this.onUse();
    return true;
  }

  /** The world waits while it hands control to someone, or while a dialogue or screen is open. */
  private waiting(): boolean {
    return this.busy || (this.dialogue === null && this.api.isBusy());
  }

  // ---- moving

  private occupied(): Set<string> {
    return new Set(this.npcs.map((n) => `${n.x},${n.y}`));
  }

  private heldDirection(): Facing | null {
    for (const f of ['up', 'down', 'left', 'right'] as const) if (this.keys[f].some((k) => k.isDown)) return f;
    return padState.held;
  }

  private face(a: Actor, facing: Facing): void {
    a.facing = facing;
    a.sprite.stop();
    a.sprite.setFrame(standFrame(facing));
  }

  override update(time: number): void {
    if (this.moving || this.waiting()) return;
    const dir = this.heldDirection();
    if (dir) {
      // a key or the D-pad takes over from a tap walk
      this.route = [];
      this.routeEnd = null;
    } else if (this.followRoute()) {
      return;
    }
    if (!dir) {
      if (this.player.sprite.anims.isPlaying) this.face(this.player, this.player.facing);
      return;
    }
    if (dir !== this.player.facing) {
      this.face(this.player, dir);
      this.turnedAt = time;
      return;
    }
    if (time - this.turnedAt < TURN_MS) return;
    this.step(dir);
  }

  /** One tile in a direction; false (and only a turn) when the tile is blocked. */
  private step(dir: Facing): boolean {
    const p = this.player;
    const to = ahead(p.x, p.y, dir);
    if (!canEnter(this.world, to.x, to.y, this.occupied())) {
      this.face(p, dir);
      return false;
    }
    this.moving = true;
    p.x = to.x;
    p.y = to.y;
    p.sprite.setDepth(10 + p.y);
    if (p.sprite.anims.currentAnim?.key !== walkAnim(p.key, dir) || !p.sprite.anims.isPlaying) p.sprite.play(walkAnim(p.key, dir));
    this.tweens.add({
      targets: p.sprite,
      x: to.x * TILE + TILE / 2,
      y: to.y * TILE + TILE,
      duration: STEP_MS,
      onComplete: () => {
        this.moving = false;
        this.arrive();
      },
    });
    return true;
  }

  /** After a step: a door takes the player to its map. */
  private arrive(): void {
    const door = objectsAt(this.world, this.player.x, this.player.y).find((o) => o.type === 'door');
    if (!door) return;
    this.busy = true;
    this.player.sprite.stop();
    const facing = door.props.facing;
    const next: WorldStart = { map: door.props.to_map ?? DEFAULT_MAP, point: door.props.to_point ?? 'player-start', ...(isFacing(facing) ? { facing } : {}) };
    this.cameras.main.fadeOut(150, 16, 24, 32);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(next));
  }

  // ---- talking and using

  private onUse(): void {
    if (this.dialogue) {
      this.dialogue.advance();
      return;
    }
    if (this.waiting() || this.moving) return;
    const p = this.player;
    const at = ahead(p.x, p.y, p.facing);
    const npc = this.npcs.find((n) => n.x === at.x && n.y === at.y);
    if (npc) {
      this.talk(npc);
      return;
    }
    const obj = objectsAt(this.world, at.x, at.y).find((o) => o.type === 'terminal' || o.type === 'battle' || o.type === 'shop');
    if (obj) this.use(obj.name, obj.type as UseEvent['kind']);
  }

  private release = (): void => {
    this.busy = false;
    this.dialogue = null;
  };

  private talk(npc: Npc): void {
    this.face(npc, OPPOSITE[this.player.facing]);
    this.busy = true;
    const ev: TalkEvent = {
      map: this.world.id,
      npc: npc.entry.npc,
      keyPrefix: npc.entry.keyPrefix,
      quests: content.quests.filter((q) => q.quest.giver === npc.entry.npc.id),
      done: this.release,
    };
    if (this.game.events.listenerCount(WORLD_EVENTS.talk) > 0) {
      this.game.events.emit(WORLD_EVENTS.talk, ev);
      return;
    }
    // placeholder: the NPC's first dialogue entry whose condition holds
    const t = this.api.t;
    const env = progressEnv(this.api.store.game, content.quests.map((q) => q.quest));
    const pick = npc.entry.npc.dialogue.find((d) => d.when === undefined || test(compile(d.when, PROGRESS_FACTS), env));
    const lines = (pick?.lines ?? []).map((k) => t(npc.entry.keyPrefix + k));
    this.dialogue = new PlaceholderDialogue(this, t(npc.entry.keyPrefix + npc.entry.npc.name), lines, this.release);
  }

  private questAt(object: string): QuestEntry | undefined {
    return content.quests.find((q) => q.quest.start.map === this.world.id && q.quest.start.object === object);
  }

  private use(object: string, kind: UseEvent['kind']): void {
    this.busy = true;
    const quest = this.questAt(object);
    const ev: UseEvent = { map: this.world.id, object, kind, ...(quest ? { quest } : {}), done: this.release };
    if (this.game.events.listenerCount(WORLD_EVENTS.use) > 0) {
      this.game.events.emit(WORLD_EVENTS.use, ev);
      return;
    }
    // placeholder: say what would open here
    const t = this.api.t;
    if (kind === 'shop') {
      const items = content.shop.items.map((i) => `${t(i.title)}  ${t('ui.money', { amount: i.price })}`);
      this.dialogue = new PlaceholderDialogue(this, t('ui.shop.title'), [items.join('\n')], this.release);
      return;
    }
    const title = quest ? t(`quest.${quest.id}.${quest.quest.title}`) : object;
    const summary = quest ? t(`quest.${quest.id}.${quest.quest.summary}`) : '';
    this.dialogue = new PlaceholderDialogue(this, title, [summary], this.release);
  }
}
