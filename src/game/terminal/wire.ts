// Opens a quest's terminal over the world and connects it to the game state through the
// GameApi: the homelab's hint boost, money and flags from consequences, the reward on a win,
// and the giver's "done" lines once the overlay has closed.

import type { QuestEntry } from '../../content/types';
import { contracted, type Reward } from '../../core/game';
import { RISK_CAP } from '../../core/karma';
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
  // progress flags the machine carries in from the save (a borrowed card), as they stand at opening
  const flags = Object.fromEntries((quest.scenario?.carry ?? []).filter((c) => api.store.game.flags[c.flag] === true).map((c) => [c.flag, true]));
  const carried = (quest.scenario?.carry ?? []).filter((c) => flags[c.flag] === true);
  try {
    current = openTerminal(quest, {
      t: api.t,
      hintBoost: api.hintBoost(),
      // the mode at opening holds for the whole session (the menu is shut while it is open)
      skipProcedures: contracted(api.store.game, quest),
      flags,
      // a done quest's machine is a practice run: it says so, and pays nothing
      practice: state === 'done',
      hints: { offer: (key) => api.hintOffer(quest.id, key), ask: (key) => api.askHint(quest.id, key) },
      ...(giver ? { speaker: giver.key(giver.spec.name) } : {}),
      applyEvents: (events) => api.applyTerminalEvents(quest.id, events),
      complete: (risk) => {
        let lesson = false;
        if (quest.quest.kind === 'hustle') {
          // no risk reported (never, for a valid hustle) fails closed: the cap
          const r = api.finishHustle(quest.id, risk ?? RISK_CAP, {
            caughtFine: carried.reduce((sum, c) => sum + (c.caught_fine ?? 0), 0),
            confiscate: carried.filter((c) => c.caught_fine !== undefined || c.taken_flag !== undefined).map((c) => c.flag),
            taken: carried.flatMap((c) => (c.taken_flag ? [c.taken_flag] : [])),
          });
          if (!r.ok) return null;
          if (r.outcome === 'caught') return { kind: 'caught', fine: r.fine, karma: r.karma, strikes: r.strikes, arrested: r.arrested, agency: r.agency, lesson: r.lesson };
          reward = r.reward;
          lesson = r.lesson;
        } else {
          // a practice run's win pays nothing: keep the first win's reward for the done lines
          const r = api.completeQuest(quest.id);
          if (!r) return null;
          reward = r;
        }
        if (!reward) return null;
        const { money, income, xp, percent, hints, karma, contract, agency } = reward;
        return { kind: 'paid', money, income, xp, percent, hints, karma, contract, agency, lesson };
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
