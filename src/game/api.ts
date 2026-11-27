// The small API the other parts of the game call: the world (talk to an NPC, use the shop
// counter, enter a map), the terminal (apply events, finish a quest, hint boost) and battles
// (record a result). It is the one way into the game state from Phaser code, and it opens the
// UI screens. Get it in any scene with getGameApi(this).
//
// While a dialogue or a screen is open, isBusy() is true and the game emits 'nines-ui' with
// true/false on game.events: the world should not move the player meanwhile (keyboard input
// reaches every scene).

import type Phaser from 'phaser';
import type { LocaleId } from '../content/types';
import type { QuestRefusal, Reward } from '../core/game';
import type { Params, Translate } from '../core/i18n';
import type { GameState } from '../core/save';
import type { HintOffer } from '../core/tokens';
import type { Conversation } from '../core/talk';
import type { FiredEvent } from '../sim/session';
import type { GameStore } from './store';

/** One line of dialogue: locale keys, never raw text. */
export interface DialogueLine {
  /** locale key of the speaker's name; omitted for narration */
  speaker?: string;
  text: string;
  params?: Params;
}

export interface GameApi {
  readonly store: GameStore;
  readonly t: Translate;
  /** a dialogue, a screen or an overlay is open */
  isBusy(): boolean;
  /** Mark the UI busy (the terminal and battle overlays do, while open); call the returned
   *  function once to release. Release lands a frame later, so the key that closed something
   *  does not also act in the world. */
  hold(): () => void;

  // ---- dialogue and screens (each promise settles when the player closes it)
  showDialogue(lines: readonly DialogueLine[]): Promise<void>;
  /** Talk to an NPC: offers, reminders or their own lines. An offered quest is accepted after
   *  the lines; a returned `battle` is a battle quest the battle overlay should open now. */
  talk(npcId: string): Promise<Conversation | null>;
  /** Open a screen; resolves when it closes (also when it was already open). */
  openShop(): Promise<void>;
  openTrail(): Promise<void>;
  openCredits(): Promise<void>;
  /** A short line over the world, such as "+€150". */
  toast(key: string, params?: Params): void;

  // ---- quests, terminal and battles
  /** Accept a quest: 'started', 'active' when it already was, or why it was refused. */
  startQuest(id: string): 'started' | 'active' | QuestRefusal;
  /** Finish a quest: pays at once (once only), saves and shows a reward toast. Null when the
   *  quest was already done, locked or unknown (nothing changes then). The giver's "done" lines
   *  are a separate step, showQuestDone, for after a DOM overlay has closed. */
  completeQuest(id: string): Reward | null;
  /** A battle ended. Won pays like completeQuest; lost keeps the quest active and costs nothing. */
  recordBattle(id: string, outcome: 'won' | 'lost'): Reward | null;
  /** The quest giver's "done" lines in the dialogue box; resolves when read. */
  showQuestDone(reward: Reward): Promise<void>;
  /** Apply what a terminal step fired (RunResult.events): money and flags. */
  applyTerminalEvents(questId: string, events: readonly FiredEvent[]): void;
  /** hintBoost to pass to createSession and startBattle. */
  hintBoost(): number;
  /** What asking the AI for a quest's hint (its locale key) would cost now. */
  hintOffer(questId: string, key: string): HintOffer;
  /** Ask the AI: pay a token (saved at once) unless it was paid before. False when refused. */
  askHint(questId: string, key: string): boolean;

  // ---- world
  /** Entered a map: saves the position, counts a pager tick; returns a pager battle to open, or null. */
  enterMap(player: GameState['player']): string | null;
  setLocale(locale: LocaleId): void;
}

const KEY = 'nines.api';

export function setGameApi(game: Phaser.Game, api: GameApi): void {
  game.registry.set(KEY, api);
}

/** From a scene, or from the game itself (both share the registry). */
export function getGameApi(scene: Pick<Phaser.Scene, 'registry'>): GameApi {
  const api = scene.registry.get(KEY) as GameApi | undefined;
  if (!api) throw new Error('the game API is not installed (see src/main.ts)');
  return api;
}
