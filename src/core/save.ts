// The save game: one JSON document in localStorage, versioned, migrated forward step by step.
// Nothing leaves the device. Terminal sessions are not saved; a quest's machine starts fresh
// whenever its terminal is opened again.

import type { LocaleId } from '../content/types';

export const SAVE_KEY = 'nines.save';
/** Unreadable saves are kept as nines.save.unreadable.1, .2, ...: never overwritten. */
export const BACKUP_PREFIX = 'nines.save.unreadable.';
export const SAVE_VERSION = 2;

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
    player: { map: 'junior-village', x: 7, y: 6, facing: 'down' },
  };
}

/** Migrations: MIGRATIONS[n] turns a version-n game into version n+1. */
export const MIGRATIONS: Record<number, (game: Record<string, unknown>) => Record<string, unknown>> = {
  // 2 (MVP build): a seed for battles and pager rolls, a pager tick count and the one-off
  // rewards already paid. A version-1 save never paid an event reward, so the list starts empty.
  1: (game) => ({ ...game, seed: 0, ticks: 0, claimed: [] }),
};

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
  if (!isObj(data) || data['format'] !== 'nines-save' || typeof data['version'] !== 'number' || !isObj(data['game'])) {
    return { kind: 'unreadable', reason: 'not a Nines save' };
  }
  let version = data['version'];
  if (!Number.isInteger(version) || version < 1) return { kind: 'unreadable', reason: 'bad version' };
  if (version > SAVE_VERSION) return { kind: 'newer', version };
  let game = data['game'];
  while (version < SAVE_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) return { kind: 'unreadable', reason: `no migration from version ${version}` };
    game = step(game);
    version++;
  }
  // Fill anything missing from a fresh game, and drop values of the wrong type.
  const base = newGame(fallbackLocale);
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
      seed: Number.isInteger(game['seed']) ? (game['seed'] as number) >>> 0 : base.seed,
      ticks: Number.isInteger(game['ticks']) && (game['ticks'] as number) >= 0 ? (game['ticks'] as number) : 0,
      claimed: strings(game['claimed']),
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
