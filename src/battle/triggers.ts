// Where battles come from. The game layer calls these; they decide nothing on their own.
//
//   npc    talking to the quest's giver starts the battle (the giver is the one asking)
//   pager  a random event: once its progress condition holds, each "tick" the game counts
//          (for example a map change) pages the player with the given chance, seeded by the
//          battle id, the game's seed and the tick, so it is deterministic per save
//   gate   the road to a town stays closed until the battle is won: the boss between stages

import type { BattleTrigger, QuestEntry } from '../content/types';
import type { GameState } from '../core/save';
import { gateWon } from '../core/game';
import { compile, type Env, test } from '../rules/expr';
import { PROGRESS_FACTS } from '../rules/registries';
import { roll } from './seed';

/** Does a pager battle go off on this tick? Only while its quest is not done yet. */
export function pagerFires(id: string, trigger: BattleTrigger, tick: number, env: Env, state: string, seed = 0): boolean {
  if (trigger.kind !== 'pager' || state === 'done' || state === 'locked') return false;
  return test(compile(trigger.when, PROGRESS_FACTS), env) && roll(`${id}/${seed}/pager/${tick}`) < trigger.chance;
}

/** Is the road to this town open? Closed while a gate battle for it is not won. */
export function gateOpen(town: string, quests: readonly QuestEntry[], game: GameState): boolean {
  return gateWon(game, { quests: [...quests] }, town);
}

/**
 * The town a gate battle leads to, when the game has no map for that town yet: the world then
 * says "<town> opens later" instead of opening a road to nowhere. A map belongs to a town when
 * its id is the town's id or starts with it (`medior-city` for `medior`). Null for other battles.
 */
export function townNotBuilt(trigger: BattleTrigger | undefined, maps: readonly { id: string }[]): string | null {
  if (trigger?.kind !== 'gate') return null;
  const town = trigger.town;
  return maps.some((m) => m.id === town || m.id.startsWith(`${town}-`)) ? null : town;
}
