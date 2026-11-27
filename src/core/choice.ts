// A dialogue choice's consequences (src/core/talk.ts TalkChoice): karma through changeKarma, so
// its bounds, community service and the agency all apply, and a progress flag. Pure.
//
// The social-engineering choice at Ans's desk (content/npcs/ans) is one: pocketing a card that is
// not yours costs karma and sets borrowed-card, which the vending job carries in (its risk drops;
// caught with it, the fine rises). Choices are game mechanics, never instructions.

import type { Rules } from './game';
import { setFlag } from './game';
import { changeKarma } from './karma';
import type { GameState } from './save';
import type { TalkChoice } from './talk';

export interface ChoiceResult {
  game: GameState;
  /** karma actually changed */
  karma: number;
  agency: { fine: number } | null;
}

export function applyChoice(game: GameState, rules: Pick<Rules, 'quests'>, choice: Pick<TalkChoice, 'karma' | 'setFlag'>): ChoiceResult {
  const k = changeKarma(game, rules, choice.karma);
  const next = choice.setFlag ? setFlag(k.game, choice.setFlag, true) : k.game;
  return { game: next, karma: k.karma, agency: k.agency };
}
