// One battle: someone questions the player over a few rounds. Pure: no DOM, no Phaser, no
// clock, no unseeded random numbers. Card order comes from a seeded shuffle (seed.ts), so the
// same save sees the same battle and tests can play it end to end.
//
// Two meters. The player's Confidence starts full and drops by a round's `cost` times how
// wrong the answer was. The attacker's Pressure starts full and drops by the round's `stakes`
// times how right it was. Both stay between 0 and their maximum.
//
// Every round is played (so the player meets every question and its explanation), unless
// Confidence hits 0, which loses at once. After the last round the battle is won when
// Pressure is down to 0 and lost otherwise. Either way the player may retry at once, as often
// as they like; nothing is taken away for losing.

import type { BattleRound, BattleSpec, Grade } from '../content/types';
import { compile, type Compiled, type Env, test } from '../rules/expr';
import { BATTLE_FACTS } from '../rules/registries';
import { answerProblem, explanations, gradeOf, perfectAnswer, pickCount, quality } from './score';
import { shuffle } from './seed';

export const DEFAULT_METERS = { confidence: 100, pressure: 100 } as const;

export type BattleStatus = 'active' | 'won' | 'lost';

export interface BattleState {
  id: string;
  /** the game's seed; with the id, attempt and round it fixes the order of the cards */
  seed: number;
  /** the homelab's hint_boost: hints treat attempts and misses as this much higher */
  hintBoost: number;
  /** tries finished (or conceded) before this one */
  attempt: number;
  /** index of the current round */
  round: number;
  confidence: number;
  pressure: number;
  status: BattleStatus;
  /** answers in this try that were not the best */
  misses: number;
  /** this try's answers */
  log: { round: string; ids: string[]; quality: number }[];
  /** how many tries were won, over all tries */
  wins: number;
}

export interface CompiledBattle {
  id: string;
  spec: BattleSpec;
  max: { confidence: number; pressure: number };
  hints: { id: string; round?: string; text: string; when: Compiled }[];
}

export interface RoundView {
  round: BattleRound;
  /** 1-based, for "Round 2/6" */
  number: number;
  of: number;
  /** option or item ids in the order to show them */
  cards: string[];
  /** how many cards to pick; for an order round, all of them */
  pick: number;
  /** hint locale keys that apply now */
  hints: string[];
}

export interface RoundResult {
  round: string;
  quality: number;
  grade: Grade;
  /** change to the meters, after clamping (zero or negative) */
  confidence: number;
  pressure: number;
  /** locale keys, never empty: why the answer is good or not, and what was best */
  explanations: string[];
  /** a perfect answer to this round, for the debrief */
  best: string[];
  status: BattleStatus;
}

export class BattleError extends Error {
  override name = 'BattleError';
}

/** Compile a battle's hint conditions. Throws on bad content (the validator runs this too). */
export function compileBattle(id: string, spec: BattleSpec): CompiledBattle {
  return {
    id,
    spec,
    max: {
      confidence: spec.meters?.confidence ?? DEFAULT_METERS.confidence,
      pressure: spec.meters?.pressure ?? DEFAULT_METERS.pressure,
    },
    hints: (spec.hints ?? []).map((h) => ({
      id: h.id,
      ...(h.round !== undefined ? { round: h.round } : {}),
      text: h.text,
      when: compile(h.when, BATTLE_FACTS),
    })),
  };
}

export function startBattle(b: CompiledBattle, opts: { seed?: number; hintBoost?: number } = {}): BattleState {
  return {
    id: b.id,
    seed: opts.seed ?? 0,
    hintBoost: opts.hintBoost ?? 0,
    attempt: 0,
    round: 0,
    confidence: b.max.confidence,
    pressure: b.max.pressure,
    status: 'active',
    misses: 0,
    log: [],
    wins: 0,
  };
}

/** A fresh try, from any state: the meters refill, attempts go up, wins are kept. */
export function retryBattle(b: CompiledBattle, s: BattleState): BattleState {
  return { ...startBattle(b, { seed: s.seed, hintBoost: s.hintBoost }), attempt: s.attempt + 1, wins: s.wins };
}

export const currentRound = (b: CompiledBattle, s: BattleState): BattleRound | null =>
  s.status === 'active' ? (b.spec.rounds[s.round] ?? null) : null;

function battleEnv(b: CompiledBattle, s: BattleState, boost: number): Env {
  return {
    vars: {
      attempts: () => s.attempt + boost,
      misses: () => s.misses + boost,
      round: () => Math.min(s.round, b.spec.rounds.length - 1) + 1,
      confidence: () => s.confidence,
      pressure: () => s.pressure,
    },
    funcs: {},
  };
}

/** Hints that apply now: battle-wide ones and those for the current round. */
export function hintsFor(b: CompiledBattle, s: BattleState): string[] {
  const here = b.spec.rounds[Math.min(s.round, b.spec.rounds.length - 1)]!.id;
  const env = battleEnv(b, s, s.hintBoost);
  return b.hints.filter((h) => (h.round === undefined || h.round === here) && test(h.when, env)).map((h) => h.text);
}

/** The cards in the order to show them. An order round never starts out solved. */
export function cardsFor(b: CompiledBattle, s: BattleState, round: BattleRound): string[] {
  if (round.type === 'estimate') return round.options.map((o) => o.id); // ranges stay ascending
  const ids = round.type === 'order' ? round.items.map((i) => i.id) : round.options.map((o) => o.id);
  const cards = shuffle(ids, `${b.id}/${s.seed}/${s.attempt}/${round.id}`);
  if (round.type === 'order' && quality(round, cards) === 1) cards.push(cards.shift()!);
  return cards;
}

export function presentRound(b: CompiledBattle, s: BattleState): RoundView | null {
  const round = currentRound(b, s);
  if (!round) return null;
  return {
    round,
    number: s.round + 1,
    of: b.spec.rounds.length,
    cards: cardsFor(b, s, round),
    pick: pickCount(round),
    hints: hintsFor(b, s),
  };
}

const clamp = (x: number, max: number) => Math.min(max, Math.max(0, x));

/** Answer the current round with option ids (or, for an order round, all item ids in order). */
export function answerRound(b: CompiledBattle, s: BattleState, ids: readonly string[]): { state: BattleState; result: RoundResult } {
  const round = currentRound(b, s);
  if (!round) throw new BattleError(`battle ${b.id} is ${s.status}; retry it to play again`);
  const problem = answerProblem(round, ids);
  if (problem) throw new BattleError(`round ${round.id}: ${problem}`);

  const q = quality(round, ids);
  const stakes = round.stakes;
  const cost = round.cost ?? round.stakes;
  const pressure = clamp(s.pressure - Math.round(stakes * q), b.max.pressure);
  const confidence = clamp(s.confidence - Math.round(cost * (1 - q)), b.max.confidence);
  const next = s.round + 1;
  const last = next >= b.spec.rounds.length;
  const status: BattleStatus = confidence === 0 ? 'lost' : last ? (pressure === 0 ? 'won' : 'lost') : 'active';

  const state: BattleState = {
    ...s,
    round: status === 'active' ? next : s.round,
    confidence,
    pressure,
    status,
    misses: s.misses + (q < 1 ? 1 : 0),
    log: [...s.log, { round: round.id, ids: [...ids], quality: q }],
    wins: s.wins + (status === 'won' ? 1 : 0),
  };
  return {
    state,
    result: {
      round: round.id,
      quality: q,
      grade: gradeOf(q),
      confidence: confidence - s.confidence,
      pressure: pressure - s.pressure,
      explanations: explanations(round, ids),
      best: perfectAnswer(round),
      status,
    },
  };
}
