// What the world tells the rest of the game. WorldScene emits these on `game.events`; the later
// pieces (dialogue, the terminal overlay, battles, the shop, saves) listen.
//
// A talk or use event hands over control: the world stops taking input until the listener
// calls `done()`. When nobody listens yet, WorldScene shows a placeholder dialogue box instead,
// so the world can be walked and tested on its own.

import type { NpcSpec, QuestEntry } from '../../content/types';
import type { Facing } from '../../world/grid';

export const WORLD_EVENTS = {
  /** the player talks to an NPC: TalkEvent */
  talk: 'world:talk',
  /** the player uses a terminal, a battle object or the shop: UseEvent */
  use: 'world:use',
  /** the world shows a map, at the start and after every door: EnterEvent */
  enter: 'world:enter',
} as const;

export interface TalkEvent {
  map: string;
  npc: NpcSpec;
  /** locale key prefix for the NPC's strings: `quest.<id>.` or `npc.<id>.` */
  keyPrefix: string;
  /** quests this NPC gives, in content order */
  quests: QuestEntry[];
  /** give control back to the world */
  done: () => void;
}

export interface UseEvent {
  map: string;
  /** the object's name in the map, e.g. rack-web-01 */
  object: string;
  kind: 'terminal' | 'battle' | 'shop';
  /** the quest whose start is this object, if any */
  quest?: QuestEntry;
  done: () => void;
}

export interface EnterEvent {
  map: string;
  x: number;
  y: number;
  facing: Facing;
}

/** Where WorldScene starts: a saved position, or a map's player-start / door arrival. */
export interface WorldStart {
  map?: string;
  x?: number;
  y?: number;
  /** a spawn point by name; used by doors */
  point?: string;
  facing?: Facing;
}
