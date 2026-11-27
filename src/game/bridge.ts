// Answers the world's events (src/game/world/events.ts) through the game API, so the world's
// placeholder dialogue is no longer used: talking runs the real conversation, the shop counter
// opens the shop, and entering a map saves the position and counts a pager tick.
//
// Battles (src/game/battle/open.ts): a talk whose conversation names a battle opens it (an npc
// or gate trigger); a battle object replays its quest's battle once that quest is under way or
// done; a pager that goes off on entering a map starts its quest and opens at once. A gate
// giver whose town has no map yet says that the town opens later.
//
// Using a terminal opens the quest's terminal overlay (src/game/terminal).

import Phaser from 'phaser';
import { questKey } from '../content/types';
import type { GameApi } from './api';
import { battleOpen, gateLater, openBattle } from './battle/open';
import { openQuestTerminal } from './terminal/wire';
import { type EnterEvent, type TalkEvent, type UseEvent, WORLD_EVENTS } from './world/events';

export function bridgeWorld(game: Phaser.Game, api: GameApi): void {
  // Hand control back a step late, like the API's busy flag, so the key that closed a
  // dialogue is not read by the world as a new press.
  const giveBack = (done: () => void) => game.events.once(Phaser.Core.Events.POST_STEP, done);

  game.events.on(WORLD_EVENTS.talk, (e: TalkEvent) => {
    const run = async (): Promise<void> => {
      const c = await api.talk(e.npc.id);
      if (c?.battle) return openBattle(game, api, c.battle);
      // a won gate into a town that is not built yet
      const gate = e.quests.find((q) => q.battle?.trigger.kind === 'gate' && api.store.questState(q.id) === 'done');
      const later = gate ? gateLater(api, gate) : null;
      if (later) await api.showDialogue([{ text: 'ui.battle.gate_later', params: later }]);
    };
    void run()
      .catch(() => undefined)
      .finally(() => giveBack(e.done));
  });

  game.events.on(WORLD_EVENTS.use, (e: UseEvent) => {
    const run = async (): Promise<void> => {
      if (e.kind === 'shop') return api.openShop();
      if (e.kind === 'terminal' && e.quest?.scenario) return openQuestTerminal(api, e.quest);
      if (e.quest) {
        const q = e.quest;
        const state = api.store.questState(q.id);
        if (q.battle && (state === 'active' || state === 'done')) return openBattle(game, api, q.id);
        return api.showDialogue([{ speaker: questKey(q.id, q.quest.title), text: questKey(q.id, q.quest.summary) }]);
      }
    };
    void run()
      .catch(() => undefined)
      .finally(() => giveBack(e.done));
  });

  game.events.on(WORLD_EVENTS.enter, (e: EnterEvent) => {
    const pager = api.enterMap({ map: e.map, x: e.x, y: e.y, facing: e.facing });
    // not over another overlay or a dialogue (the save notice at boot, say): the page is missed
    if (!pager || battleOpen() || api.isBusy()) return;
    // The 3 AM page: the quest starts now, and the battle opens over the world.
    api.startQuest(pager);
    void openBattle(game, api, pager).catch(() => undefined);
  });
}
