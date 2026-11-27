// Implementations of PROGRESS_FACTS (src/rules/registries.ts) over the saved game, and the
// quest states they lead to.

import type { QuestSpec } from '../content/types';
import { type Compiled, compile, type Env, test } from '../rules/expr';
import { PROGRESS_FACTS } from '../rules/registries';
import type { GameState } from './save';

/** Compiled `available_when` gates, by source text: content is fixed, so they are compiled once. */
const gates = new Map<string, Compiled>();

/**
 * Does a quest's `available_when` hold? The validator refuses `quest()` in a gate (requires
 * does that job), and the gate is evaluated without the quest list, so it can never recurse.
 */
export function gateOpen(game: GameState, gate: string | undefined): boolean {
  if (gate === undefined) return true;
  let c = gates.get(gate);
  if (!c) {
    c = compile(gate, PROGRESS_FACTS);
    gates.set(gate, c);
  }
  return test(c, progressEnv(game, []));
}

/**
 * A saved state wins (a quest once started stays started, whatever the karma does later).
 * Otherwise a quest is available when every quest it requires is done and its gate holds.
 */
export function questState(game: GameState, quests: readonly QuestSpec[], id: string): 'locked' | 'available' | 'active' | 'done' {
  const saved = game.quests[id];
  if (saved) return saved;
  const q = quests.find((x) => x.id === id);
  if (!q) return 'locked';
  return q.requires.every((r) => game.quests[r] === 'done') && gateOpen(game, q.available_when) ? 'available' : 'locked';
}

export function progressEnv(game: GameState, quests: readonly QuestSpec[]): Env {
  return {
    vars: {
      money: () => game.money,
      tech_debt: () => game.tech_debt,
      karma: () => game.karma,
      probation: () => game.probation,
      strikes: () => game.strikes,
      contractor: () => game.contractor,
    },
    funcs: {
      quest: (id) => questState(game, quests, String(id)),
      xp: (branch) => game.xp[String(branch)] ?? 0,
      has_item: (id) => game.items.includes(String(id)),
      flag: (name) => game.flags[String(name)] === true,
    },
  };
}
