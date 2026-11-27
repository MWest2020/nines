// Answers the world's events (src/game/world/events.ts) through the game API, so the world's
// placeholder dialogue is no longer used: talking runs the real conversation, the shop counter
// opens the shop, and entering a map saves the position and counts a pager tick.
//
// Using a terminal opens the quest's terminal overlay (src/game/terminal). Until the battle
// overlay exists, using a battle object shows the quest's title and summary in the dialogue
// box; that chunk replaces the branch: open the overlay with api.hold(), then recordBattle and
// showQuestDone.

import Phaser from 'phaser';
import { questKey } from '../content/types';
import type { GameApi } from './api';
import { openQuestTerminal } from './terminal/wire';
import { type EnterEvent, type TalkEvent, type UseEvent, WORLD_EVENTS } from './world/events';

export function bridgeWorld(game: Phaser.Game, api: GameApi): void {
  // Hand control back a step late, like the API's busy flag, so the key that closed a
  // dialogue is not read by the world as a new press.
  const giveBack = (done: () => void) => game.events.once(Phaser.Core.Events.POST_STEP, done);

  game.events.on(WORLD_EVENTS.talk, (e: TalkEvent) => {
    void api
      .talk(e.npc.id)
      .catch(() => null)
      .finally(() => giveBack(e.done));
  });

  game.events.on(WORLD_EVENTS.use, (e: UseEvent) => {
    const run = async (): Promise<void> => {
      if (e.kind === 'shop') return api.openShop();
      if (e.kind === 'terminal' && e.quest?.scenario) return openQuestTerminal(api, e.quest);
      if (e.quest) {
        const q = e.quest;
        return api.showDialogue([{ speaker: questKey(q.id, q.quest.title), text: questKey(q.id, q.quest.summary) }]);
      }
    };
    void run()
      .catch(() => undefined)
      .finally(() => giveBack(e.done));
  });

  game.events.on(WORLD_EVENTS.enter, (e: EnterEvent) => {
    // A pager battle that goes off here waits for the battle overlay (a later chunk).
    api.enterMap({ map: e.map, x: e.x, y: e.y, facing: e.facing });
  });
}
