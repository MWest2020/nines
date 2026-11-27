// Opens a quest's terminal over the world and connects it to the game state through the
// GameApi: the homelab's hint boost, money and flags from consequences, the reward on a win,
// and the giver's "done" lines once the overlay has closed.

import type { QuestEntry } from '../../content/types';
import type { Reward } from '../../core/game';
import { findNpc } from '../../core/talk';
import type { GameApi } from '../api';
import { openTerminal, type TerminalOverlay } from './TerminalOverlay';

/** The terminal that is open now, if any: only one at a time. */
let current: TerminalOverlay | null = null;

/**
 * Open the terminal of a terminal quest. Resolves once the overlay and any closing dialogue are
 * gone, so the world can take control back. A locked quest only says so; an available one is
 * accepted first, so the machine can be fixed before talking to its giver.
 */
export function openQuestTerminal(api: GameApi, quest: QuestEntry): Promise<void> {
  if (!quest.scenario || current) return Promise.resolve();
  const state = api.store.questState(quest.id);
  if (state === 'locked') return api.showDialogue([{ text: 'ui.terminal.locked' }]);
  return new Promise((done, fail) => {
    try {
      open(api, quest, done);
    } catch (err) {
      fail(err);
    }
  });
}

function open(api: GameApi, quest: QuestEntry, done: () => void): void {
  const state = api.store.questState(quest.id);
  if (state === 'available') api.startQuest(quest.id);
  const giver = findNpc(api.store.content, quest.quest.giver);
  const release = api.hold();
  let reward: Reward | null = null;
  try {
    current = openTerminal(quest, {
      t: api.t,
      hintBoost: api.hintBoost(),
      hints: { offer: (key) => api.hintOffer(quest.id, key), ask: (key) => api.askHint(quest.id, key) },
      ...(giver ? { speaker: giver.key(giver.spec.name) } : {}),
      applyEvents: (events) => {
        const before = api.store.game.money;
        api.applyTerminalEvents(quest.id, events);
        return api.store.game.money - before;
      },
      complete: () => {
        reward = api.completeQuest(quest.id);
        return reward ? { money: reward.money, income: reward.income, xp: reward.xp, percent: reward.percent, hints: reward.hints } : null;
      },
      closed: () => {
        current = null;
        release();
        const finish = reward ? api.showQuestDone(reward) : Promise.resolve();
        void finish.then(done);
      },
    });
  } catch (err) {
    // Never leave the game busy or a half-built overlay on screen. The error rejects the
    // promise, and the bridge gives the world its control back.
    document.querySelector('.nt-overlay')?.remove();
    current = null;
    release();
    throw err;
  }
}

/** True while a terminal is open. */
export const terminalOpen = (): boolean => current !== null;
