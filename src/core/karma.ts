// Karma, side hustles and the independent contractor (Mark, 27 Nov 2026: "karma paths ... a guy
// behind a building who asks you to hack something"). Pure, like core/game.ts: every function
// takes a GameState and returns a new one. The rules (DESIGN.md, Karma):
//
// - Karma runs from KARMA_MIN to KARMA_MAX and starts at 0. Quests change it through
//   `reward.karma`, scenario events through `karma`; content gates on it with the progress facts
//   `karma`, `probation`, `strikes` and `contractor` (a quest's `available_when`).
// - A hustle (quest kind `hustle`) rolls when it is finished: its scenario's risk (base plus the
//   factors the player's play switched on) against a roll seeded by the save, the quest and how
//   often the player was caught before. Caught: a fine, a karma hit and a strike; the quest
//   stays active. ARREST_AFTER strikes: arrested, a big fine and probation.
// - Karma dropping to AGENCY_KARMA or below, off probation: a three-letter agency asks
//   questions. A fine and probation.
// - Probation shuts the content that asks `!probation` (bank and enterprise jobs) until a
//   community service quest (kind `service`) is done; that also clears the strikes and brings
//   karma back to at least 0. A karma drop below 0 or a new probation reopens community service,
//   so the way back is always there.
// - An independent contractor skips a scenario's procedure objectives and earns
//   CONTRACT_PERCENT of a terminal job's money, but damage (a penalty event, an outage) is billed
//   at DAMAGE_MULTIPLIER times.
//
// Money never goes below zero: a fine takes what there is.

import { roll } from '../battle/seed';
import type { QuestEntry, QuestKind } from '../content/types';
import type { Rules } from './game';
import type { GameState } from './save';

export const KARMA_MIN = -100;
export const KARMA_MAX = 100;
/** What bank and enterprise content asks for (`karma >= 0 && !probation`): a clean record. */
export const CLEARANCE_KARMA = 0;
/** The fixer stops offering work above this (`karma <= 20`): too squeaky clean. */
export const SHADY_KARMA = 20;
/** At or below this, off probation, the agency calls. */
export const AGENCY_KARMA = -60;

export const CAUGHT_FINE = 150;
export const CAUGHT_KARMA = -10;
export const ARREST_AFTER = 2;
export const ARREST_FINE = 500;
export const ARREST_KARMA = -15;
export const AGENCY_FINE = 400;
/** A hustle is never a sure thing either way: the risk is capped. */
export const RISK_CAP = 95;

/** An independent contractor's share of a terminal job's money, in percent. */
export const CONTRACT_PERCENT = 150;
/** What a contractor pays for damage, as a multiple of the scenario's penalty. */
export const DAMAGE_MULTIPLIER = 3;

/** Karma rounded and kept in bounds; anything that is not a finite number is 0. */
export const clampKarma = (k: number): number => (Number.isFinite(k) ? Math.max(KARMA_MIN, Math.min(KARMA_MAX, Math.round(k))) : 0);

export type KarmaTier = 'saint' | 'trusted' | 'neutral' | 'shady' | 'wanted';

/** The meter's name for a karma value: saint 60+, trusted 20+, neutral, shady -20 and below, wanted at the agency line. */
export function karmaTier(k: number): KarmaTier {
  if (k >= 60) return 'saint';
  if (k >= 20) return 'trusted';
  if (k > -20) return 'neutral';
  if (k > AGENCY_KARMA) return 'shady';
  return 'wanted';
}

export const questKind = (entry: Pick<QuestEntry, 'quest'>): QuestKind => entry.quest.kind ?? 'job';

/** Take a fine: as much as there is, never below zero. */
export function fine(game: GameState, amount: number): { game: GameState; paid: number } {
  const paid = Math.min(game.money, Math.max(0, Math.floor(amount)));
  return { game: paid === 0 ? game : { ...game, money: game.money - paid }, paid };
}

/** Community service quests that are done become available again (their gate permitting). */
export function reopenService(game: GameState, rules: Pick<Rules, 'quests'>): GameState {
  const done = rules.quests.filter((q) => questKind(q) === 'service' && game.quests[q.id] === 'done').map((q) => q.id);
  if (done.length === 0) return game;
  const quests = { ...game.quests };
  for (const id of done) delete quests[id];
  return { ...game, quests };
}

export interface KarmaChange {
  game: GameState;
  /** the change that happened, after the bounds */
  karma: number;
  /** the agency called: the fine it took */
  agency: { fine: number } | null;
}

/**
 * Change karma. A drop that crosses below zero reopens community service; a drop to
 * AGENCY_KARMA or below while not on probation brings the agency: a fine and probation.
 */
export function changeKarma(game: GameState, rules: Pick<Rules, 'quests'>, delta: number): KarmaChange {
  const before = game.karma;
  const after = clampKarma(before + (Number.isFinite(delta) ? delta : 0));
  let next = after === before ? game : { ...game, karma: after };
  let agency: KarmaChange['agency'] = null;
  if (after < before) {
    if (before >= 0 && after < 0) next = reopenService(next, rules);
    if (!next.probation && after <= AGENCY_KARMA) {
      const f = fine(next, AGENCY_FINE);
      next = reopenService({ ...f.game, probation: true }, rules);
      agency = { fine: f.paid };
    }
  }
  return { game: next, karma: after - before, agency };
}

/** A risk in percent, kept between 0 and RISK_CAP. */
export const clampRisk = (risk: number): number => (Number.isFinite(risk) ? Math.max(0, Math.min(RISK_CAP, Math.round(risk))) : RISK_CAP);

/**
 * The roll a hustle's risk is checked against, 0 to 99: seeded by the save, the quest and the
 * times the player was caught before. Caught when roll < risk. No unseeded dice: the same
 * save finishing the same job the same way gets the same answer, and closing the terminal to
 * try again does not reroll (only getting caught moves the dice on).
 */
export const riskRoll = (game: Pick<GameState, 'seed' | 'caught'>, questId: string): number => roll(`hustle:${game.seed >>> 0}:${questId}:${game.caught}`);

export const setContractor = (game: GameState, on: boolean): GameState => (game.contractor === on ? game : { ...game, contractor: on });
