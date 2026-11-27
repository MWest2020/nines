// AI tokens (Mark, 27 Nov 2026: "a hint is AI usage"). Pure, like core/game.ts: every function
// takes a GameState and returns a new one.
//
// The rules (DESIGN.md, AI tokens):
// - A hint that has unlocked is not shown until the player asks the AI for it. Asking costs
//   HINT_COST tokens; without tokens there is no asking (the shop sells AI credits).
// - Every hint paid for on a quest that is not done yet lowers that quest's reward, XP and money
//   alike, by PENALTY_PERCENT, down to FLOOR_PERCENT: you always earn something.
// - A hint paid for once stays paid: a terminal opened again shows it free.
// - A quest that is done pays nothing more, so its hints are free (replays cost nothing).
// - Never stuck for good: a player with no tokens and too little money for the cheapest AI
//   credits gets the hint on the house (no token), but it still lowers the reward.
// - From the third hint on a quest the reward stays at the floor, so later hints cost only the
//   token. That is on purpose: a quest that has beaten you three times should still end.
// - Homelab income (the Raspberry Pi's €10) and tech debt are not scaled: the Pi does not care
//   who wrote the fix.

import { own } from '../rules/own';
import { questState } from './progress';
import type { GameState } from './save';
import type { Rules } from './game';

export const HINT_COST = 1;
export const PENALTY_PERCENT = 20;
export const FLOOR_PERCENT = 40;

/** The share of a quest's reward that is paid after `hints` hints: 100, 80, 60, then 40. */
export const rewardPercent = (hints: number): number => Math.max(FLOOR_PERCENT, 100 - PENALTY_PERCENT * Math.max(0, Math.floor(hints)));

/** An amount scaled to a percentage, rounded down; never negative. */
export const scaled = (amount: number, percent: number): number => Math.max(0, Math.floor((Math.max(0, amount) * percent) / 100));

/** Hints paid for on a quest, as stored. */
export const hintsTaken = (game: GameState, questId: string): string[] => own(game.hints, questId) ?? [];

/** The locale keys of a quest's hints, terminal or battle. */
function hintKeys(rules: Pick<Rules, 'quests'>, questId: string): string[] | undefined {
  const q = rules.quests.find((x) => x.id === questId);
  if (!q) return undefined;
  return [...(q.scenario?.hints ?? []), ...(q.battle?.hints ?? [])].map((h) => h.text);
}

/** Paid hints that the quest still has: a renamed or hand-edited key never lowers a reward. */
export function paidHints(game: GameState, rules: Pick<Rules, 'quests'>, questId: string): number {
  const keys = hintKeys(rules, questId) ?? [];
  return hintsTaken(game, questId).filter((k) => keys.includes(k)).length;
}

/** The price of the cheapest consumable that adds tokens; Infinity when the shop sells none. */
const cheapestCredits = (rules: Pick<Rules, 'shop'>): number =>
  Math.min(Infinity, ...rules.shop.items.filter((i) => i.consumable && (i.effects.tokens ?? 0) > 0).map((i) => i.price));

const isDone = (game: GameState, rules: Pick<Rules, 'quests'>, questId: string) =>
  questState(game, rules.quests.map((q) => q.quest), questId) === 'done';

/**
 * What asking the AI for this hint would do, for the button that offers it:
 * - shown: paid for before, show it.
 * - free: the quest is done, so nothing is at stake.
 * - ask: costs `cost` tokens (0 on the house, when the player cannot afford credits) and moves
 *   the reward from `percent` to `after`.
 * - broke: not enough tokens, but enough money for AI credits.
 */
export type HintOffer =
  | { kind: 'shown' }
  | { kind: 'free' }
  | { kind: 'ask'; cost: number; tokens: number; percent: number; after: number }
  | { kind: 'broke'; cost: number; tokens: number };

export function hintOffer(game: GameState, rules: Pick<Rules, 'quests' | 'shop'>, questId: string, key: string): HintOffer {
  if (hintsTaken(game, questId).includes(key)) return { kind: 'shown' };
  if (isDone(game, rules, questId)) return { kind: 'free' };
  const paid = paidHints(game, rules, questId);
  const scale = { percent: rewardPercent(paid), after: rewardPercent(paid + 1) };
  if (game.tokens >= HINT_COST) return { kind: 'ask', cost: HINT_COST, tokens: game.tokens, ...scale };
  if (game.money < cheapestCredits(rules)) return { kind: 'ask', cost: 0, tokens: game.tokens, ...scale };
  return { kind: 'broke', cost: HINT_COST, tokens: game.tokens };
}

export type HintRefusal = 'unknown' | 'tokens';

/**
 * Ask the AI: pay for a hint and remember it. A hint paid before, or one on a done quest, costs
 * nothing (`charged: 0`). `unknown` when the quest has no such hint (a UI bug, never content).
 */
export function takeHint(
  game: GameState,
  rules: Pick<Rules, 'quests' | 'shop'>,
  questId: string,
  key: string,
): { ok: true; game: GameState; charged: number } | { ok: false; game: GameState; reason: HintRefusal } {
  const keys = hintKeys(rules, questId);
  if (!keys || !keys.includes(key)) return { ok: false, game, reason: 'unknown' };
  const offer = hintOffer(game, rules, questId, key);
  if (offer.kind === 'shown' || offer.kind === 'free') return { ok: true, game, charged: 0 };
  if (offer.kind === 'broke') return { ok: false, game, reason: 'tokens' };
  // `charged` 0 for a hint on the house: it is still recorded, so it still scales the reward
  return {
    ok: true,
    charged: offer.cost,
    game: { ...game, tokens: game.tokens - offer.cost, hints: { ...game.hints, [questId]: [...hintsTaken(game, questId), key] } },
  };
}

/** Tokens added (AI credits from the shop). */
export const addTokens = (game: GameState, n: number): GameState => (n > 0 ? { ...game, tokens: game.tokens + Math.floor(n) } : game);
