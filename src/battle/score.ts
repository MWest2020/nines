// Scoring one answer to one round. Pure; the engine (engine.ts) applies the result to the
// meters. Every round type turns an answer into a quality from 0 (fully wrong) to 1 (perfect).
//
//   tradeoff, flaw, estimate  pick one option; its grade decides: best 1, fair 0.5, weak 0
//   clarify                   pick `pick` options; the sum of their grades over the best sum
//                             that many picks could reach
//   order                     the share of pairs (with different ranks) in the right order,
//                             rescaled so that a random order scores about 0 and the reverse 0

import type { BattleRound, Grade, OrderRound } from '../content/types';

export const GRADE_SCORE: Readonly<Record<Grade, number>> = { best: 1, fair: 0.5, weak: 0 };

/** How many options the player picks in this round (order rounds: all items, in order). */
export function pickCount(round: BattleRound): number {
  if (round.type === 'order') return round.items.length;
  return round.type === 'clarify' ? (round.pick ?? 1) : 1;
}

const rankOf = (round: OrderRound, i: number): number => round.items[i]!.rank ?? i + 1;

/** The answer ids in a correct order (order rounds) or the best picks (other rounds). */
export function perfectAnswer(round: BattleRound): string[] {
  if (round.type === 'order') {
    return round.items
      .map((it, i) => ({ id: it.id, r: rankOf(round, i), i }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.id);
  }
  return [...round.options]
    .map((o, i) => ({ o, i }))
    .sort((a, b) => GRADE_SCORE[b.o.grade] - GRADE_SCORE[a.o.grade] || a.i - b.i)
    .slice(0, pickCount(round))
    .map((x) => x.o.id);
}

/** The worst possible answer: the reverse order, or the lowest-graded picks. */
export function worstAnswer(round: BattleRound): string[] {
  if (round.type === 'order') {
    return round.items
      .map((it, i) => ({ id: it.id, r: rankOf(round, i), i }))
      .sort((a, b) => b.r - a.r || a.i - b.i)
      .map((x) => x.id);
  }
  return [...round.options]
    .map((o, i) => ({ o, i }))
    .sort((a, b) => GRADE_SCORE[a.o.grade] - GRADE_SCORE[b.o.grade] || a.i - b.i)
    .slice(0, pickCount(round))
    .map((x) => x.o.id);
}

/** Why an answer is not acceptable for this round, or null when it is. */
export function answerProblem(round: BattleRound, ids: readonly string[]): string | null {
  const known = round.type === 'order' ? round.items.map((i) => i.id) : round.options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) return 'an id is given twice';
  const unknown = ids.find((id) => !known.includes(id));
  if (unknown !== undefined) return `unknown id "${unknown}"`;
  const n = pickCount(round);
  if (ids.length !== n) return round.type === 'order' ? `order all ${n} items` : `pick exactly ${n}`;
  return null;
}

/** Quality of an answer from 0 to 1. The answer must be acceptable (answerProblem is null). */
export function quality(round: BattleRound, ids: readonly string[]): number {
  if (round.type === 'order') {
    const pos = new Map(ids.map((id, i) => [id, i]));
    let right = 0;
    let wrong = 0;
    for (let a = 0; a < round.items.length; a++) {
      for (let b = a + 1; b < round.items.length; b++) {
        const ra = rankOf(round, a);
        const rb = rankOf(round, b);
        if (ra === rb) continue; // interchangeable steps: either order is fine
        const before = pos.get(round.items[a]!.id)! < pos.get(round.items[b]!.id)!;
        if (before === ra < rb) right++;
        else wrong++;
      }
    }
    const share = right + wrong === 0 ? 1 : right / (right + wrong);
    return Math.max(0, 2 * share - 1);
  }
  const score = (id: string) => GRADE_SCORE[round.options.find((o) => o.id === id)!.grade];
  const best = perfectAnswer(round).reduce((sum, id) => sum + score(id), 0);
  const got = ids.reduce((sum, id) => sum + score(id), 0);
  return best === 0 ? 0 : got / best;
}

/** The grade an answer of this quality earns, for the debrief and for counting misses. */
export const gradeOf = (q: number): Grade => (q >= 1 ? 'best' : q >= 0.5 ? 'fair' : 'weak');

/**
 * The explanations to show after an answer, as locale keys, never empty: what the player
 * chose and why it is good or not, then, unless the answer was already perfect, what the best
 * answer was and why.
 */
export function explanations(round: BattleRound, ids: readonly string[]): string[] {
  if (round.type === 'order') {
    // Every step in its right place, with the reason it goes there.
    return perfectAnswer(round).map((id) => round.items.find((i) => i.id === id)!.why);
  }
  const chosen = ids.map((id) => round.options.find((o) => o.id === id)!.why);
  const perfect = quality(round, ids) === 1;
  const best = (perfect ? [] : perfectAnswer(round))
    .filter((id) => !ids.includes(id))
    .map((id) => round.options.find((o) => o.id === id)!.why);
  return [...chosen, ...best, ...(round.type === 'estimate' ? [round.working] : [])];
}
