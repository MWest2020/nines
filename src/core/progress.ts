// Implementations of PROGRESS_FACTS (src/rules/registries.ts) over the saved game.

import type { QuestSpec } from '../content/types';
import type { Env } from '../rules/expr';
import type { GameState } from './save';

export function questState(game: GameState, quests: readonly QuestSpec[], id: string): 'locked' | 'available' | 'active' | 'done' {
  const saved = game.quests[id];
  if (saved) return saved;
  const q = quests.find((x) => x.id === id);
  if (!q) return 'locked';
  return q.requires.every((r) => game.quests[r] === 'done') ? 'available' : 'locked';
}

export function progressEnv(game: GameState, quests: readonly QuestSpec[]): Env {
  return {
    vars: {
      money: () => game.money,
      tech_debt: () => game.tech_debt,
    },
    funcs: {
      quest: (id) => questState(game, quests, String(id)),
      xp: (branch) => game.xp[String(branch)] ?? 0,
      has_item: (id) => game.items.includes(String(id)),
      flag: (name) => game.flags[String(name)] === true,
    },
  };
}
