// Opens a quest's terminal over the world and connects it to the game state through the
// GameApi: the homelab's hint boost, money and flags from consequences, the reward on a win,
// and the giver's "done" lines once the overlay has closed.

import type { QuestEntry } from '../../content/types';
import { contracted, type Reward } from '../../core/game';
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
      // the mode at opening holds for the whole session (the menu is shut while it is open)
      skipProcedures: contracted(api.store.game, quest),
      hints: { offer: (key) => api.hintOffer(quest.id, key), ask: (key) => api.askHint(quest.id, key) },
      ...(giver ? { speaker: giver.key(giver.spec.name) } : {}),
      applyEvents: (events) => api.applyTerminalEvents(quest.id, events),
      complete: (risk) => {
        if (quest.quest.kind === 'hustle') {
          const r = api.finishHustle(quest.id, risk ?? 0);
          if (!r.ok) return null;
          if (r.outcome === 'caught') return { kind: 'caught', fine: r.fine, karma: r.karma, strikes: r.strikes, arrested: r.arrested, agency: r.agency };
          reward = r.reward;
        } else {
          reward = api.completeQuest(quest.id);
        }
        if (!reward) return null;
        const { money, income, xp, percent, hints, karma, contract, agency } = reward;
        return { kind: 'paid', money, income, xp, percent, hints, karma, contract, agency };
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
