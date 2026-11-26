// The world: a Tiled map, the player on a 16 px grid, NPCs, doors and the things you can use.
// Rules live in src/world/grid.ts (pure, tested); this scene renders and reads the keyboard.
// Touch controls come in a later chunk.

import Phaser from 'phaser';
import content from 'virtual:nines-content';
import type { MapEntry, QuestEntry } from '../content/types';
import { createTranslator, defaultLocale, type Translate } from '../core/i18n';
import { progressEnv } from '../core/progress';
import { newGame, type GameState } from '../core/save';
import { compile, test } from '../rules/expr';
import { own } from '../rules/own';
import { PROGRESS_FACTS } from '../rules/registries';
import {
  ahead,
  canEnter,
  facingOf,
  isSolid,
  objectNamed,
  objectsAt,
  OPPOSITE,
  readMap,
  TILE,
  type Facing,
  type WorldMap,
} from '../world/grid';
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
  private dialogue: PlaceholderDialogue | null = null;
  private t!: Translate;
  /** The world reads progress for NPC lines; the real game state arrives with the save chunk. */
  gameState: GameState = newGame('en');
  private keys!: {
    up: Phaser.Input.Keyboard.Key[];
    down: Phaser.Input.Keyboard.Key[];
    left: Phaser.Input.Keyboard.Key[];
    right: Phaser.Input.Keyboard.Key[];
    use: Phaser.Input.Keyboard.Key[];
    back: Phaser.Input.Keyboard.Key[];
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
  }

  create(): void {
    const locale = defaultLocale(navigator.languages ?? [navigator.language]);
    this.t = createTranslator(content.locales, locale);
    this.entry = content.maps.find((m) => m.id === this.start.map) ?? content.maps.find((m) => m.id === DEFAULT_MAP) ?? content.maps[0]!;
    this.world = readMap(this.entry.id, this.entry.map);

    this.drawMap();
    this.placeNpcs();
    this.placePlayer();
    this.bindKeys();

    const cam = this.cameras.main;
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
      use: keys(K.ENTER, K.SPACE),
      back: keys(K.ESC),
    };
    for (const k of this.keys.use) k.on('down', () => this.onUse());
    for (const k of this.keys.back) k.on('down', () => this.dialogue?.close());
  }

  // ---- moving

  private occupied(): Set<string> {
    return new Set(this.npcs.map((n) => `${n.x},${n.y}`));
  }

  private heldDirection(): Facing | null {
    for (const f of ['up', 'down', 'left', 'right'] as const) if (this.keys[f].some((k) => k.isDown)) return f;
    return null;
  }

  private face(a: Actor, facing: Facing): void {
    a.facing = facing;
    a.sprite.stop();
    a.sprite.setFrame(standFrame(facing));
  }

  override update(time: number): void {
    if (this.moving || this.busy) return;
    const dir = this.heldDirection();
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

  private step(dir: Facing): void {
    const p = this.player;
    const to = ahead(p.x, p.y, dir);
    if (!canEnter(this.world, to.x, to.y, this.occupied())) {
      this.face(p, dir);
      return;
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
  }

  /** After a step: a door takes the player to its map. */
  private arrive(): void {
    const door = objectsAt(this.world, this.player.x, this.player.y).find((o) => o.type === 'door');
    if (!door) return;
    this.busy = true;
    this.player.sprite.stop();
    const next: WorldStart = { map: door.props.to_map ?? DEFAULT_MAP, point: door.props.to_point ?? 'player-start' };
    this.cameras.main.fadeOut(150, 16, 24, 32);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(next));
  }

  // ---- talking and using

  private onUse(): void {
    if (this.dialogue) {
      this.dialogue.advance();
      return;
    }
    if (this.busy || this.moving) return;
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
    const env = progressEnv(this.gameState, content.quests.map((q) => q.quest));
    const pick = npc.entry.npc.dialogue.find((d) => d.when === undefined || test(compile(d.when, PROGRESS_FACTS), env));
    const lines = (pick?.lines ?? []).map((k) => this.t(npc.entry.keyPrefix + k));
    this.dialogue = new PlaceholderDialogue(this, this.t(npc.entry.keyPrefix + npc.entry.npc.name), lines, this.release);
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
    if (kind === 'shop') {
      const items = content.shop.items.map((i) => `${this.t(i.title)}  ${this.t('ui.money', { amount: i.price })}`);
      this.dialogue = new PlaceholderDialogue(this, this.t('ui.shop.title'), [items.join('\n')], this.release);
      return;
    }
    const title = quest ? this.t(`quest.${quest.id}.${quest.quest.title}`) : object;
    const summary = quest ? this.t(`quest.${quest.id}.${quest.quest.summary}`) : '';
    this.dialogue = new PlaceholderDialogue(this, title, [summary], this.release);
  }
}
