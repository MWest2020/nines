// AI tokens (core/tokens.ts): hints cost tokens and scale a quest's reward down, with a floor;
// AI credits from the shop; the career path; the version-2 to version-3 save migration.
import { describe, expect, it } from 'vitest';
import { buy, CAREER_CHANGE_FEE, canBuy, changePath, choosePath, completeQuest, recordBattle, type Rules } from '../../src/core/game';
import { memoryStorage, openSave } from '../../src/core/persist';
import { deserialize, type GameState, MIGRATIONS, newGame, SAVE_KEY, SAVE_VERSION, serialize, START_TOKENS } from '../../src/core/save';
import { FLOOR_PERCENT, HINT_COST, hintOffer, hintsTaken, PENALTY_PERCENT, rewardPercent, scaled, takeHint } from '../../src/core/tokens';
import { progressEnv } from '../../src/core/progress';
import { compile, test } from '../../src/rules/expr';
import { PROGRESS_FACTS } from '../../src/rules/registries';
import { content } from '../helpers';

const rules = (): Rules => content();

function frozen<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) frozen(v);
    Object.freeze(x);
  }
  return x;
}

const fresh = (patch: Partial<GameState> = {}): GameState => frozen({ ...newGame('en', 7), ...patch });

/** The three MVP quests done: the Junior gate interview is available. */
const mvp = (patch: Partial<GameState> = {}): GameState =>
  fresh({ ...patch, quests: { 'disk-full': 'done', 'service-down': 'done', 'broken-pipeline': 'done' } });

/** Take hints in order, failing loudly if one is refused. */
function hinted(game: GameState, quest: string, ...keys: string[]): GameState {
  for (const k of keys) {
    const r = takeHint(game, rules(), quest, k);
    if (!r.ok) throw new Error(`${quest}/${k}: ${r.reason}`);
    game = frozen(r.game);
  }
  return game;
}

describe('the reward scale', () => {
  it('pays 100%, then 20 points less per hint, never below the floor of 40%', () => {
    expect([0, 1, 2, 3, 4, 10].map(rewardPercent)).toEqual([100, 80, 60, 40, 40, 40]);
    expect(PENALTY_PERCENT).toBe(20);
    expect(FLOOR_PERCENT).toBe(40);
    expect(rewardPercent(-1)).toBe(100);
  });
  it('rounds down and never goes negative', () => {
    expect(scaled(175, 80)).toBe(140);
    expect(scaled(25, 60)).toBe(15);
    expect(scaled(25, 40)).toBe(10);
    expect(scaled(1, 40)).toBe(0);
    expect(scaled(0, 40)).toBe(0);
    expect(scaled(-50, 80)).toBe(0);
  });
});

describe('asking the AI for a hint', () => {
  it('a new game starts with three tokens; a hint costs one', () => {
    expect(fresh().tokens).toBe(START_TOKENS);
    expect(START_TOKENS).toBe(3);
    expect(HINT_COST).toBe(1);
  });
  it('shows the cost first: one token, and the reward drops by 20 points', () => {
    expect(hintOffer(fresh(), rules(), 'disk-full', 'hint.df')).toEqual({ kind: 'ask', cost: 1, tokens: 3, percent: 100, after: 80 });
    const once = hinted(fresh(), 'disk-full', 'hint.df');
    expect(once.tokens).toBe(2);
    expect(hintsTaken(once, 'disk-full')).toEqual(['hint.df']);
    expect(hintOffer(once, rules(), 'disk-full', 'hint.df')).toEqual({ kind: 'shown' });
    expect(hintOffer(once, rules(), 'disk-full', 'hint.du')).toEqual({ kind: 'ask', cost: 1, tokens: 2, percent: 80, after: 60 });
  });
  it('a hint paid for once stays paid: asking again is free', () => {
    const once = hinted(fresh(), 'disk-full', 'hint.df');
    const again = takeHint(once, rules(), 'disk-full', 'hint.df');
    expect(again).toEqual({ ok: true, game: once, charged: 0 });
  });
  it('no tokens, no hint, while AI credits are affordable', () => {
    const broke = fresh({ tokens: 0, money: 40 });
    expect(hintOffer(broke, rules(), 'disk-full', 'hint.df')).toEqual({ kind: 'broke', cost: 1, tokens: 0 });
    expect(takeHint(broke, rules(), 'disk-full', 'hint.df')).toEqual({ ok: false, game: broke, reason: 'tokens' });
    const spent = hinted(fresh({ money: 100 }), 'disk-full', 'hint.df', 'hint.du', 'hint.gz');
    expect(spent.tokens).toBe(0);
    expect(takeHint(spent, rules(), 'service-down', 'hint.status')).toMatchObject({ ok: false, reason: 'tokens' });
  });
  it('never stuck for good: no tokens and no money for credits, the hint is on the house but still counts', () => {
    const poor = fresh({ tokens: 0, money: 39 });
    expect(hintOffer(poor, rules(), 'service-down', 'hint.status')).toEqual({ kind: 'ask', cost: 0, tokens: 0, percent: 100, after: 80 });
    const r = takeHint(poor, rules(), 'service-down', 'hint.status');
    expect(r).toMatchObject({ ok: true, charged: 0 });
    if (!r.ok) return;
    expect(r.game.tokens).toBe(0);
    const done = completeQuest(r.game, rules(), 'service-down');
    expect(done.ok && done.reward.percent).toBe(80);
  });
  it('a paid key the quest no longer has never lowers the reward', () => {
    const g = fresh({ hints: { 'service-down': ['hint.renamed', 'hint.status'] } });
    expect(hintOffer(g, rules(), 'service-down', 'hint.journal')).toMatchObject({ percent: 80, after: 60 });
    const r = completeQuest(g, rules(), 'service-down');
    expect(r.ok && r.reward).toMatchObject({ percent: 80, hints: 1 });
  });
  it('refuses a hint the quest does not have', () => {
    expect(takeHint(fresh(), rules(), 'disk-full', 'hint.algorithm')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(takeHint(fresh(), rules(), 'no-such-quest', 'hint.df')).toMatchObject({ ok: false, reason: 'unknown' });
  });
  it('hints on a done quest are free and change nothing', () => {
    const r = completeQuest(fresh(), rules(), 'disk-full');
    if (!r.ok) throw new Error(r.reason);
    expect(hintOffer(r.game, rules(), 'disk-full', 'hint.gz')).toEqual({ kind: 'free' });
    expect(takeHint(r.game, rules(), 'disk-full', 'hint.gz')).toEqual({ ok: true, game: r.game, charged: 0 });
  });
  it('at the floor, a hint still costs a token but the reward stays put', () => {
    const three = hinted(fresh({ tokens: 5 }), 'disk-full', 'hint.df', 'hint.du', 'hint.gz');
    // disk-full has three hints; a battle with five shows the floor holding
    const five = hinted(mvp({ tokens: 5 }), 'rate-limiter-interview', 'hint.algorithm', 'hint.local', 'hint.estimate');
    expect(hintOffer(five, rules(), 'rate-limiter-interview', 'hint.outage')).toEqual({ kind: 'ask', cost: 1, tokens: 2, percent: 40, after: 40 });
    expect(three.tokens).toBe(2);
  });
});

describe('rewards after hints', () => {
  it('a quest without hints pays in full', () => {
    const r = completeQuest(fresh(), rules(), 'service-down');
    expect(r.ok && r.reward).toMatchObject({ money: 175, xp: 25, percent: 100, hints: 0, full: { money: 175, xp: 25 } });
  });
  it('one hint pays 80% of the money and the XP', () => {
    const r = completeQuest(hinted(fresh(), 'service-down', 'hint.status'), rules(), 'service-down');
    if (!r.ok) throw new Error(r.reason);
    expect(r.reward).toMatchObject({ money: 140, xp: 20, percent: 80, hints: 1 });
    expect(r.game.money).toBe(140);
    expect(r.game.xp).toEqual({ incident: 20 });
  });
  it('many hints pay the floor, never nothing and never less', () => {
    const r = completeQuest(hinted(fresh(), 'disk-full', 'hint.df', 'hint.du', 'hint.gz'), rules(), 'disk-full');
    if (!r.ok) throw new Error(r.reason);
    expect(r.reward).toMatchObject({ money: 60, xp: 8, percent: 40, hints: 3 });
    expect(r.game.money).toBeGreaterThan(0);
  });
  it('homelab income is not scaled', () => {
    const pi = fresh({ items: ['raspberry-pi'] });
    const r = completeQuest(hinted(pi, 'service-down', 'hint.status'), rules(), 'service-down');
    expect(r.ok && r.reward).toMatchObject({ money: 140, income: 10 });
    expect(r.ok && r.game.money).toBe(150);
  });
  it('hints on one quest leave another quest alone', () => {
    const g = hinted(fresh(), 'service-down', 'hint.status');
    const r = completeQuest(g, rules(), 'disk-full');
    expect(r.ok && r.reward.percent).toBe(100);
  });
  it('battles: hints taken during the tries scale the win', () => {
    const g = hinted(mvp(), 'rate-limiter-interview', 'hint.algorithm', 'hint.local');
    const r = recordBattle(g, rules(), 'rate-limiter-interview', 'won');
    expect(r.ok && r.reward).toMatchObject({ money: 180, xp: 24, percent: 60, hints: 2 });
  });
});

describe('AI credits in the shop', () => {
  it('buying adds three tokens, takes the price, and can be done again', () => {
    const item = rules().shop.items.find((i) => i.id === 'ai-credits')!;
    expect(item.consumable).toBe(true);
    let g = fresh({ money: item.price * 2 + 5 });
    for (let n = 1; n <= 2; n++) {
      const r = buy(g, rules(), 'ai-credits');
      if (!r.ok) throw new Error(r.reason);
      g = frozen(r.game);
      expect(g.tokens).toBe(START_TOKENS + 3 * n);
      expect(g.items).toEqual([]); // never owned
    }
    expect(g.money).toBe(5);
    expect(canBuy(g, rules(), 'ai-credits')).toEqual({ ok: false, reason: 'money' });
  });
  it('gear is still bought once', () => {
    const r = buy(fresh({ money: 500 }), rules(), 'raspberry-pi');
    expect(r.ok && canBuy(r.game, rules(), 'raspberry-pi')).toEqual({ ok: false, reason: 'owned' });
  });
});

describe('career paths', () => {
  const medior = (): GameState => {
    const r = recordBattle(mvp(), rules(), 'rate-limiter-interview', 'won');
    if (!r.ok) throw new Error(r.reason);
    return frozen(r.game);
  };
  it('six paths in the roadmap: ethical hacker is the sixth (DESIGN.md, Karma)', () => {
    expect(rules().roadmap.paths.map((p) => p.id)).toEqual(['swe', 'sre', 'devops', 'platform', 'systems', 'ethical']);
  });
  it('is chosen at Medior City, once', () => {
    expect(choosePath(mvp(), rules(), 'sre')).toMatchObject({ ok: false, reason: 'closed' });
    const r = choosePath(medior(), rules(), 'sre');
    expect(r.ok && r.game.path).toBe('sre');
    if (!r.ok) return;
    expect(choosePath(r.game, rules(), 'sre')).toEqual({ ok: true, game: r.game });
    expect(choosePath(r.game, rules(), 'swe')).toMatchObject({ ok: false, reason: 'chosen' });
    expect(choosePath(medior(), rules(), 'wizard')).toMatchObject({ ok: false, reason: 'unknown' });
  });
  it('can be changed later at the coach, for a fee (issue #24, default 2)', () => {
    expect(CAREER_CHANGE_FEE).toBe(300);
    expect(changePath(mvp(), rules(), 'swe')).toMatchObject({ ok: false, reason: 'closed' });
    expect(changePath(medior(), rules(), 'swe')).toMatchObject({ ok: false, reason: 'none' });
    const chosen = choosePath(medior(), rules(), 'sre');
    if (!chosen.ok) throw new Error(chosen.reason);
    const rich = frozen({ ...chosen.game, money: 450, xp: { incident: 30 }, karma: 10 });
    expect(changePath(rich, rules(), 'sre')).toMatchObject({ ok: false, reason: 'same' });
    expect(changePath(rich, rules(), 'wizard')).toMatchObject({ ok: false, reason: 'unknown' });
    expect(changePath(frozen({ ...rich, money: CAREER_CHANGE_FEE - 1 }), rules(), 'swe')).toMatchObject({ ok: false, reason: 'money' });
    const r = changePath(rich, rules(), 'swe');
    expect(r).toMatchObject({ ok: true, fee: 300 });
    if (!r.ok) return;
    // the fee is paid, the path changes, and what was learned stays
    expect([r.game.path, r.game.money, r.game.xp, r.game.karma, r.game.quests]).toEqual(['swe', 150, { incident: 30 }, 10, rich.quests]);
    // and back again costs the fee again
    expect(changePath(r.game, rules(), 'sre')).toMatchObject({ ok: false, reason: 'money' });
  });
  it('the path_chosen and career_path() progress facts read the choice', () => {
    const chosen = choosePath(medior(), rules(), 'platform');
    if (!chosen.ok) throw new Error(chosen.reason);
    const ask = (g: GameState, src: string) => test(compile(src, PROGRESS_FACTS), progressEnv(g, rules().quests.map((q) => q.quest)));
    expect(ask(medior(), 'path_chosen')).toBe(false);
    expect(ask(medior(), 'career_path("platform")')).toBe(false);
    expect(ask(chosen.game, 'path_chosen && career_path("platform") && !career_path("swe")')).toBe(true);
  });
  it('every quest counts towards at least one path, and every path has a quest', () => {
    const quests = rules().quests;
    for (const q of quests) expect(q.quest.paths.length, q.id).toBeGreaterThan(0);
    for (const p of rules().roadmap.paths) expect(quests.some((q) => q.quest.paths.includes(p.id)), p.id).toBe(true);
  });
});

describe('save format 3', () => {
  const v2 = {
    format: 'nines-save',
    version: 2,
    game: {
      locale: 'nl', money: 350, xp: { linux: 20 }, quests: { 'disk-full': 'done', 'service-down': 'active' }, items: ['raspberry-pi'],
      flags: {}, tech_debt: 0, seed: 42, ticks: 3, claimed: ['disk-full/bonus'], player: { map: 'junior-village', x: 3, y: 4, facing: 'up' },
    },
  };
  it('migrates a version-2 save: three tokens, no hints counted, no path; everything else kept', () => {
    expect(MIGRATIONS[2]!({ a: 1 })).toEqual({ a: 1, tokens: START_TOKENS, hints: {}, path: null });
    const out = deserialize(JSON.stringify(v2), 'en');
    // and on through version 4 (karma, tests/core/karma.test.ts)
    expect(out).toEqual({ kind: 'ok', game: { ...v2.game, tokens: 3, hints: {}, path: null, karma: 0, strikes: 0, caught: 0, probation: false, contractor: false } });
  });
  it('round-trips tokens, paid hints and the path', () => {
    const g = { ...hinted(fresh(), 'disk-full', 'hint.df'), path: 'platform' };
    expect(deserialize(serialize(g), 'en')).toEqual({ kind: 'ok', game: g });
  });
  it('repairs bad token, hint and path values', () => {
    const bad = { format: 'nines-save', version: 3, game: { ...v2.game, tokens: -4, hints: { 'disk-full': ['hint.df', 7, 'hint.df'], x: 'nope', y: [] }, path: 12 } };
    const out = deserialize(JSON.stringify(bad), 'en');
    // a broken count repairs to 0, never to a gift
    expect(out.kind === 'ok' && out.game).toMatchObject({ tokens: 0, hints: { 'disk-full': ['hint.df'] }, path: null });
    const frac = deserialize(JSON.stringify({ ...bad, game: { ...bad.game, tokens: 2.5 } }), 'en');
    expect(frac.kind === 'ok' && frac.game.tokens).toBe(0);
  });
  it('keeps __proto__ and constructor keys in hints as plain data', () => {
    const raw = JSON.stringify({ format: 'nines-save', version: 3, game: { ...v2.game, tokens: 1, hints: JSON.parse('{"__proto__": ["x"], "constructor": ["y"]}') } });
    const out = deserialize(raw, 'en');
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(Object.keys(out.game.hints).sort()).toEqual(['__proto__', 'constructor']);
    expect(({} as Record<string, unknown>)['x']).toBeUndefined();
    expect(Object.getPrototypeOf(out.game.hints)).toBe(Object.prototype);
    expect(deserialize(serialize(out.game), 'en')).toEqual(out);
    expect(hintsTaken(out.game, 'constructor')).toEqual(['y']);
  });
  it('a save from a newer version is never read and never written over', () => {
    const st = memoryStorage({ [SAVE_KEY]: JSON.stringify({ format: 'nines-save', version: SAVE_VERSION + 1, game: { tokens: 99 } }) });
    const { slot, game } = openSave(st, 'en', 1);
    expect(slot.status).toBe('newer');
    expect(slot.save({ ...game, tokens: 1 })).toBe(false);
    expect(JSON.parse(st.data.get(SAVE_KEY)!).version).toBe(SAVE_VERSION + 1);
  });
  it('a version-1 save walks the whole chain', () => {
    const v1 = { format: 'nines-save', version: 1, game: { locale: 'en', money: 10 } };
    const out = deserialize(JSON.stringify(v1), 'en');
    expect(out.kind === 'ok' && out.game).toMatchObject({ money: 10, tokens: 3, hints: {}, path: null, claimed: [] });
  });
});
