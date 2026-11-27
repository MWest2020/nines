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

/**
 * A choice's karma and flag. A karma gain is paid once per choice (`claimed` key
 * `choice/<text key>`), like an event's bonus, so talking again cannot farm it; a loss costs
 * every time.
 */
export function applyChoice(game: GameState, rules: Pick<Rules, 'quests'>, choice: Pick<TalkChoice, 'text' | 'karma' | 'setFlag'>): ChoiceResult {
  const key = `choice/${choice.text}`;
  const gain = choice.karma > 0;
  const paid = gain && game.claimed.includes(key);
  const k = changeKarma(game, rules, paid ? 0 : choice.karma);
  let next = gain && !paid ? { ...k.game, claimed: [...k.game.claimed, key] } : k.game;
  if (choice.setFlag) next = setFlag(next, choice.setFlag, true);
  return { game: next, karma: k.karma, agency: k.agency };
}
