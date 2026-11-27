// The save game: one JSON document in localStorage, versioned, migrated forward step by step.
// Nothing leaves the device. Terminal sessions are not saved; a quest's machine starts fresh
// whenever its terminal is opened again.

import type { LocaleId } from '../content/types';
import { clampKarma } from './karma';

export const SAVE_KEY = 'nines.save';
/** Unreadable saves are kept as nines.save.unreadable.1, .2, ...: never overwritten. */
export const BACKUP_PREFIX = 'nines.save.unreadable.';
export const SAVE_VERSION = 4;
/** AI tokens in a new game, and what a version-2 save is given when it moves to version 3. */
export const START_TOKENS = 3;

export type QuestState = 'active' | 'done';

export interface GameState {
  locale: LocaleId;
  money: number;
  /** XP per roadmap branch */
  xp: Record<string, number>;
  /** quests the player has started or finished; absent = not started */
  quests: Record<string, QuestState>;
  items: string[];
  flags: Record<string, boolean>;
  tech_debt: number;
  /** fixes this save's card orders and pager rolls (battle/seed.ts); chosen once, at a new game */
  seed: number;
  /** pager ticks counted so far (map changes); with the seed it makes pager rolls repeatable */
  ticks: number;
  /** one-off rewards already paid, as "<quest>/<event>", so replaying a terminal never pays twice */
  claimed: string[];
  /** AI tokens: each hint taken costs one (core/tokens.ts) */
  tokens: number;
  /** hints already paid for, per quest, as the hint's locale key: shown free from then on, and
   *  their number scales that quest's reward down */
  hints: Record<string, string[]>;
  /** the career path chosen at Medior City; null until then */
  path: string | null;
  /** -100..100, starts at 0 (core/karma.ts): hustles lower it, pentests and community service raise it */
  karma: number;
  /** times caught on a hustle since the last community service; two strikes is an arrest */
  strikes: number;
  /** times caught on a hustle, ever: with the seed it makes the next risk roll repeatable */
  caught: number;
  /** arrested or questioned by the agency: clearance jobs (bank, enterprise) stay shut until
   *  community service is done */
  probation: boolean;
  /** works as an independent contractor: skips procedures, earns more, pays for damage */
  contractor: boolean;
  player: { map: string; x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' };
}

export interface SaveFile {
  format: 'nines-save';
  version: number;
  game: GameState;
}

/** `seed` comes from the game layer (the pure core has no randomness); tests pass a fixed one. */
export function newGame(locale: LocaleId, seed = 0): GameState {
  return {
    locale,
    money: 0,
    xp: {},
    quests: {},
    items: [],
    flags: {},
    tech_debt: 0,
    seed,
    ticks: 0,
    claimed: [],
    tokens: START_TOKENS,
    hints: {},
    path: null,
    karma: 0,
    strikes: 0,
    caught: 0,
    probation: false,
    contractor: false,
    player: { map: 'junior-village', x: 7, y: 6, facing: 'down' },
  };
}

/** Migrations: MIGRATIONS[n] turns a version-n game into version n+1. */
export const MIGRATIONS: Record<number, (game: Record<string, unknown>) => Record<string, unknown>> = {
  // 2 (MVP build): a seed for battles and pager rolls (derived from the old save, so each save
  // keeps its own), a pager tick count and the one-off rewards already paid. A version-1 save
  // never paid an event reward, so the list starts empty.
  1: (game) => ({ ...game, seed: seedFrom(JSON.stringify(game)), ticks: 0, claimed: [] }),
  // 3 (paths and tokens, 27 Nov 2026): hints now cost AI tokens. A version-2 player took every
  // hint for free so far; they start with the same tokens as a new game and no hint is counted
  // against a quest, done or not. No path is chosen yet (Medior City has no map).
  2: (game) => ({ ...game, tokens: START_TOKENS, hints: {}, path: null }),
  // 4 (karma, 27 Nov 2026): a version-3 player never did a shady job, so they start where a new
  // game starts: karma 0, a clean record, and employed (not a contractor).
  3: (game) => ({ ...game, karma: 0, strikes: 0, caught: 0, probation: false, contractor: false }),
};

/** A seed derived from text (FNV-1a), for saves that predate the seed: pure and repeatable. */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export function serialize(game: GameState): string {
  const file: SaveFile = { format: 'nines-save', version: SAVE_VERSION, game };
  return JSON.stringify(file);
}

/**
 * - empty: start a new game.
 * - ok: play on.
 * - unreadable: the raw data has been backed up; start a new game and tell the player.
 * - newer: made by a newer version of the game. Do not autosave over it; tell the player to
 *   update. The caller may offer a new game that is kept in memory only.
 */
export type LoadOutcome =
  | { kind: 'empty' }
  | { kind: 'ok'; game: GameState }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'newer'; version: number };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deserialize(raw: string | null, fallbackLocale: LocaleId): LoadOutcome {
  if (raw === null || raw === '') return { kind: 'empty' };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { kind: 'unreadable', reason: 'not JSON' };
  }
  if (!isObj(data) || data['format'] !== 'nines-save' || typeof data['version'] !== 'number') {
    return { kind: 'unreadable', reason: 'not a Nines save' };
  }
  let version = data['version'];
  if (!Number.isInteger(version) || version < 1) return { kind: 'unreadable', reason: 'bad version' };
  // Before the shape check: a newer format may shape its game differently, and must be kept.
  if (version > SAVE_VERSION) return { kind: 'newer', version };
  if (!isObj(data['game'])) return { kind: 'unreadable', reason: 'not a Nines save' };
  let game = data['game'];
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { kind: 'unreadable', reason: `no migration from version ${version}` };
    game = step(game);
    version++;
  }
  // Fill anything missing from a fresh game, and drop values of the wrong type.
  const base = newGame(fallbackLocale);
  const count = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : 0);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const rec = <T>(v: unknown, ok: (x: unknown) => x is T): Record<string, T> =>
    isObj(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => ok(x))) as Record<string, T> : {};
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : [];
  const player = isObj(game['player']) ? game['player'] : {};
  const facing = ['up', 'down', 'left', 'right'].includes(player['facing'] as string)
    ? (player['facing'] as GameState['player']['facing'])
    : base.player.facing;
  return {
    kind: 'ok',
    game: {
      locale: game['locale'] === 'nl' || game['locale'] === 'en' ? game['locale'] : base.locale,
      money: Math.max(0, num(game['money'], 0)),
      xp: rec(game['xp'], (x): x is number => typeof x === 'number'),
      quests: rec(game['quests'], (x): x is QuestState => x === 'active' || x === 'done'),
      items: strings(game['items']),
      flags: rec(game['flags'], (x): x is boolean => typeof x === 'boolean'),
      tech_debt: num(game['tech_debt'], 0),
      seed: Number.isInteger(game['seed']) ? (game['seed'] as number) >>> 0 : seedFrom(raw),
      ticks: Number.isInteger(game['ticks']) && (game['ticks'] as number) >= 0 ? (game['ticks'] as number) : 0,
      claimed: strings(game['claimed']),
      // a broken count repairs to 0, never to a gift (MIGRATIONS[2] gives a version-2 save its 3)
      tokens: Number.isInteger(game['tokens']) && (game['tokens'] as number) >= 0 ? (game['tokens'] as number) : 0,
      hints: Object.fromEntries(
        Object.entries(isObj(game['hints']) ? game['hints'] : {})
          .map(([q, v]) => [q, strings(v)] as const)
          .filter(([, v]) => v.length > 0),
      ),
      path: typeof game['path'] === 'string' && game['path'] !== '' ? game['path'] : null,
      // karma is clamped and rounded; a broken value is a clean 0, not a gift or a curse
      karma: typeof game['karma'] === 'number' && Number.isFinite(game['karma']) ? clampKarma(game['karma']) : 0,
      strikes: count(game['strikes']),
      caught: count(game['caught']),
      probation: game['probation'] === true,
      contractor: game['contractor'] === true,
      player: {
        map: typeof player['map'] === 'string' ? player['map'] : base.player.map,
        x: num(player['x'], base.player.x),
        y: num(player['y'], base.player.y),
        facing,
      },
    },
  };
}

/** The small part that touches the browser. Storage is passed in so tests need no DOM. */
export function loadFrom(storage: Pick<Storage, 'getItem' | 'setItem'>, fallbackLocale: LocaleId): LoadOutcome {
  const raw = storage.getItem(SAVE_KEY);
  const out = deserialize(raw, fallbackLocale);
  if (out.kind === 'unreadable' && raw !== null) {
    let n = 1;
    while (storage.getItem(BACKUP_PREFIX + n) !== null) n++;
    storage.setItem(BACKUP_PREFIX + n, raw);
  }
  return out;
}

export function saveTo(storage: Pick<Storage, 'setItem'>, game: GameState): void {
  storage.setItem(SAVE_KEY, serialize(game));
}
