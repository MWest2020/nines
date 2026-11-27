// Karma, side hustles and the independent contractor (core/karma.ts, core/game.ts): the bounds
// and the meter, the gates content builds from karma, the seeded risk roll, caught, arrested
// and the agency, community service, the contractor's multipliers, and the save migration
// from version 3 to version 4.
import { describe, expect, it } from 'vitest';
import { applyEvent, completeQuest, contracted, finishHustle, type Rules, startQuest, stateOf } from '../../src/core/game';
import {
  AGENCY_FINE,
  AGENCY_KARMA,
  ARREST_AFTER,
  ARREST_FINE,
  ARREST_KARMA,
  CAUGHT_FINE,
  CAUGHT_KARMA,
  CLEARANCE_KARMA,
  CONTRACT_PERCENT,
  changeKarma,
  clampKarma,
  clampRisk,
  DAMAGE_MULTIPLIER,
  KARMA_MAX,
  KARMA_MIN,
  karmaTier,
  RISK_CAP,
  riskRoll,
  setContractor,
  SHADY_KARMA,
} from '../../src/core/karma';
import { memoryStorage, openSave } from '../../src/core/persist';
import { gateOpen, progressEnv } from '../../src/core/progress';
import { deserialize, type GameState, MIGRATIONS, newGame, SAVE_KEY, SAVE_VERSION, serialize } from '../../src/core/save';
import { conversation } from '../../src/core/talk';
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

/** A seed whose roll for the vending job, never caught before, is below (caught) or at least (clean) a risk. */
function seedWhere(pred: (roll: number) => boolean, caught = 0): number {
  for (let s = 1; s < 10_000; s++) if (pred(riskRoll({ seed: s, caught }, 'vending-prices'))) return s;
  throw new Error('no such seed');
}

describe('karma: bounds and the meter', () => {
  it('starts at 0 and stays between -100 and +100, rounded', () => {
    expect(newGame('en').karma).toBe(0);
    expect([KARMA_MIN, KARMA_MAX]).toEqual([-100, 100]);
    expect([-250, -100, -3.6, 0, 42.4, 100, 999].map(clampKarma)).toEqual([-100, -100, -4, 0, 42, 100, 100]);
    expect([NaN, Infinity, -Infinity].map(clampKarma)).toEqual([0, 0, 0]);
  });
  it('changeKarma keeps to the bounds and reports what really changed', () => {
    const top = changeKarma(fresh({ karma: 95 }), rules(), 30);
    expect(top.game.karma).toBe(100);
    expect(top.karma).toBe(5);
    const bottom = changeKarma(fresh({ karma: -95, probation: true }), rules(), -30);
    expect(bottom.game.karma).toBe(-100);
    expect(bottom.karma).toBe(-5);
    const same = fresh();
    expect(changeKarma(same, rules(), 0).game).toBe(same);
  });
  it('names the meter: saint, trusted, neutral, shady, wanted', () => {
    expect([100, 60, 59, 20, 19, 0, -19, -20, -59, -60, -100].map(karmaTier)).toEqual([
      'saint', 'saint', 'trusted', 'trusted', 'neutral', 'neutral', 'neutral', 'shady', 'shady', 'wanted', 'wanted',
    ]);
    expect(karmaTier(AGENCY_KARMA)).toBe('wanted');
  });
  it('content asks about karma, probation, strikes and the contractor as progress facts', () => {
    const env = progressEnv(fresh({ karma: -30, probation: true, strikes: 2, contractor: true }), []);
    const ask = (src: string) => test(compile(src, PROGRESS_FACTS), env);
    expect(ask('karma == -30')).toBe(true);
    expect(ask('karma < 0 && probation')).toBe(true);
    expect(ask('strikes >= 2 && contractor')).toBe(true);
    expect(ask('karma <= -20 && karma > -60')).toBe(true);
    expect(() => compile('karma()', PROGRESS_FACTS)).toThrow(/not a function/);
  });
});

describe('karma: thresholds through available_when', () => {
  it('a bank pentest needs a clean record: karma >= 0 and no probation', () => {
    expect(CLEARANCE_KARMA).toBe(0);
    expect(stateOf(fresh(), rules(), 'bank-pentest')).toBe('available');
    expect(stateOf(fresh({ karma: -1 }), rules(), 'bank-pentest')).toBe('locked');
    expect(stateOf(fresh({ karma: 50, probation: true }), rules(), 'bank-pentest')).toBe('locked');
    expect(startQuest(fresh({ karma: -1 }), rules(), 'bank-pentest')).toMatchObject({ ok: false, reason: 'locked' });
    // Sanne says why
    expect(conversation(fresh({ karma: -1 }), content(), 'sanne')?.lines).toEqual(['quest.bank-pentest.npc.no_clearance']);
    expect(conversation(fresh({ probation: true }), content(), 'sanne')?.lines).toEqual(['quest.bank-pentest.npc.probation']);
  });
  it('the fixer works only with karma up to +20: low karma is what unlocks shady jobs', () => {
    expect(SHADY_KARMA).toBe(20);
    expect(stateOf(fresh({ karma: 20 }), rules(), 'vending-prices')).toBe('available');
    expect(stateOf(fresh({ karma: 21 }), rules(), 'vending-prices')).toBe('locked');
    expect(conversation(fresh({ karma: 21 }), content(), 'vince')?.lines).toEqual(['quest.vending-prices.npc.too_clean']);
    expect(conversation(fresh(), content(), 'vince')?.offer).toBe('vending-prices');
  });
  it('community service opens on probation or below zero', () => {
    expect(stateOf(fresh(), rules(), 'repair-cafe')).toBe('locked');
    expect(stateOf(fresh({ karma: -1 }), rules(), 'repair-cafe')).toBe('available');
    expect(stateOf(fresh({ karma: 30, probation: true }), rules(), 'repair-cafe')).toBe('available');
  });
  it('a quest once started stays started, whatever karma does next', () => {
    const started = frozen(startQuest(fresh(), rules(), 'bank-pentest').game);
    expect(stateOf({ ...started, karma: -50 }, rules(), 'bank-pentest')).toBe('active');
    expect(completeQuest({ ...started, karma: -50 }, rules(), 'bank-pentest').ok).toBe(true);
  });
  it('gates never recurse: a gate is evaluated without the quest list', () => {
    expect(gateOpen(fresh(), undefined)).toBe(true);
    expect(gateOpen(fresh({ karma: 5 }), 'karma > 4')).toBe(true);
    // quest() is refused by the validator; at run time it only sees saved states
    expect(gateOpen(fresh(), 'quest("disk-full") == "locked"')).toBe(true);
  });
  it('finishing the pentest raises karma by 10', () => {
    const r = completeQuest(fresh(), rules(), 'bank-pentest');
    expect(r.ok && r.reward).toMatchObject({ money: 300, xp: 30, karma: 10, kind: 'job', contract: false });
    expect(r.game.karma).toBe(10);
  });
});

describe('side hustles: the seeded risk roll', () => {
  it('rolls 0 to 99 from the save, the quest and the times caught, never anything else', () => {
    const a = riskRoll({ seed: 42, caught: 0 }, 'vending-prices');
    expect(riskRoll({ seed: 42, caught: 0 }, 'vending-prices')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(100);
    const rolls = new Set<number>();
    for (let s = 0; s < 400; s++) rolls.add(riskRoll({ seed: s, caught: 0 }, 'vending-prices'));
    expect(rolls.size).toBeGreaterThan(80); // spread over the range, not stuck
    const caughtOnce = [...Array(50).keys()].filter((s) => riskRoll({ seed: s, caught: 0 }, 'x') !== riskRoll({ seed: s, caught: 1 }, 'x'));
    expect(caughtOnce.length).toBeGreaterThan(40); // getting caught moves the dice on
  });
  it('caps the risk at 95: never a sure thing', () => {
    expect(RISK_CAP).toBe(95);
    expect([-5, 0, 37.4, 95, 140, NaN].map(clampRisk)).toEqual([0, 0, 37, 95, 95, 95]);
  });
  it('completeQuest refuses a hustle: it must roll', () => {
    expect(completeQuest(fresh(), rules(), 'vending-prices')).toMatchObject({ ok: false, reason: 'hustle' });
    expect(finishHustle(fresh(), rules(), 'disk-full', 0)).toMatchObject({ ok: false, reason: 'unknown' });
  });
  it('clean: paid like a quest, karma down', () => {
    const g = fresh({ seed: seedWhere((r) => r >= 10) });
    const r = finishHustle(g, rules(), 'vending-prices', 10);
    expect(r).toMatchObject({ ok: true, outcome: 'clean', risk: 10 });
    if (!r.ok || r.outcome !== 'clean') return;
    expect(r.reward).toMatchObject({ money: 350, xp: 15, karma: -20, kind: 'hustle' });
    expect(r.game).toMatchObject({ money: 350, karma: -20, strikes: 0, caught: 0 });
    expect(r.lesson).toBe(true); // the first ending tells the lesson, once
    expect(r.game.claimed).toContain('lesson/vending-prices');
    expect(r.game.quests['vending-prices']).toBe('done');
    // the same save, the same play: the same answer
    expect(finishHustle(g, rules(), 'vending-prices', 10)).toEqual(r);
    // and done is done
    expect(finishHustle(r.game, rules(), 'vending-prices', 10)).toMatchObject({ ok: false, reason: 'done' });
  });
  it('risk 0 is always clean, risk 95 is caught unless the roll is 95 or more', () => {
    for (let s = 0; s < 40; s++) {
      expect(finishHustle(fresh({ seed: s }), rules(), 'vending-prices', 0)).toMatchObject({ outcome: 'clean' });
      const r = finishHustle(fresh({ seed: s }), rules(), 'vending-prices', 200);
      expect(r).toMatchObject({ outcome: riskRoll({ seed: s, caught: 0 }, 'vending-prices') < 95 ? 'caught' : 'clean' });
    }
  });
  it('caught: a fine, a karma hit and a strike; the job stays open and pays nothing', () => {
    const g = fresh({ seed: seedWhere((r) => r < 50), money: 1000 });
    const r = finishHustle(g, rules(), 'vending-prices', 50);
    expect(r).toMatchObject({ ok: true, outcome: 'caught', fine: CAUGHT_FINE, karma: CAUGHT_KARMA, strikes: 1, arrested: null, agency: null });
    expect(r.game).toMatchObject({ money: 1000 - CAUGHT_FINE, karma: CAUGHT_KARMA, strikes: 1, caught: 1, probation: false });
    expect(r.game.quests['vending-prices']).toBe('active');
    // the retry rolls again (getting caught moved the dice on) and does not repeat the lesson
    expect(r).toMatchObject({ lesson: true });
    const again = finishHustle(r.game, rules(), 'vending-prices', 0);
    expect(again).toMatchObject({ outcome: 'clean', lesson: false });
  });
  it('a fine never takes money below zero', () => {
    const g = fresh({ seed: seedWhere((r) => r < 50), money: 40 });
    const r = finishHustle(g, rules(), 'vending-prices', 50);
    expect(r).toMatchObject({ outcome: 'caught', fine: 40 });
    expect(r.game.money).toBe(0);
  });
  it('caught twice is arrested: a big fine, more karma lost, probation, and community service opens', () => {
    expect(ARREST_AFTER).toBe(2);
    const g = fresh({ seed: seedWhere((r) => r < 50, 1), money: 2000, strikes: 1, caught: 1, karma: -10, quests: { 'vending-prices': 'active' } });
    const r = finishHustle(g, rules(), 'vending-prices', 50);
    expect(r).toMatchObject({ outcome: 'caught', strikes: 2, arrested: { fine: ARREST_FINE }, fine: CAUGHT_FINE + ARREST_FINE, karma: CAUGHT_KARMA + ARREST_KARMA, agency: null });
    expect(r.game).toMatchObject({ money: 2000 - CAUGHT_FINE - ARREST_FINE, probation: true, karma: -10 + CAUGHT_KARMA + ARREST_KARMA });
    expect(stateOf(r.game, rules(), 'bank-pentest')).toBe('locked');
    expect(stateOf(r.game, rules(), 'repair-cafe')).toBe('available');
    // other work goes on: the arrest locks clearance jobs, not everything
    expect(stateOf(r.game, rules(), 'disk-full')).toBe('available');
  });
});

describe('the agency and community service', () => {
  it('a karma drop to -60 or below, off probation: a fine and probation, once', () => {
    const r = changeKarma(fresh({ karma: -50, money: 1000 }), rules(), -10);
    expect(r.agency).toEqual({ fine: AGENCY_FINE });
    expect(r.game).toMatchObject({ karma: -60, money: 1000 - AGENCY_FINE, probation: true });
    // on probation already: no second visit
    expect(changeKarma(r.game, rules(), -10).agency).toBeNull();
    // a rise never brings them
    expect(changeKarma(fresh({ karma: -80 }), rules(), 5).agency).toBeNull();
  });
  it('an arrest is probation already: the agency does not come on top of it', () => {
    const g = fresh({ seed: seedWhere((r) => r < 50, 1), money: 5000, strikes: 1, caught: 1, karma: -50, quests: { 'vending-prices': 'active' } });
    const r = finishHustle(g, rules(), 'vending-prices', 50);
    expect(r).toMatchObject({ outcome: 'caught', agency: null, arrested: { fine: ARREST_FINE } });
    expect(r.game).toMatchObject({ money: 5000 - CAUGHT_FINE - ARREST_FINE, karma: -75, probation: true });
  });
  it('community service ends probation, wipes strikes, lifts karma to at least 0, pays no money', () => {
    const g = fresh({ karma: -80, probation: true, strikes: 2, caught: 3, money: 10 });
    const r = completeQuest(g, rules(), 'repair-cafe');
    expect(r.ok && r.reward).toMatchObject({ money: 0, xp: 10, kind: 'service', karma: 80 });
    expect(r.game).toMatchObject({ karma: 0, probation: false, strikes: 0, caught: 3, money: 10 });
    expect(stateOf(r.game, rules(), 'bank-pentest')).toBe('available');
    // a small dip: +25 karma
    const small = completeQuest(fresh({ karma: -5 }), rules(), 'repair-cafe');
    expect(small.game.karma).toBe(20);
  });
  it('community service pays its XP and the homelab income once per save: no farming', () => {
    const g = fresh({ karma: -5, items: ['raspberry-pi'] });
    const first = completeQuest(g, rules(), 'repair-cafe');
    expect(first.ok && first.reward).toMatchObject({ xp: 10, income: 10, money: 0 });
    const dipped = changeKarma(first.game, rules(), -30).game; // reopens it
    const second = completeQuest(dipped, rules(), 'repair-cafe');
    expect(second.ok && second.reward).toMatchObject({ xp: 0, income: 0, money: 0 });
    expect(second.game).toMatchObject({ karma: 15, xp: first.game.xp, money: first.game.money });
  });
  it('a new dip below zero reopens community service; a dip that stays above zero does not', () => {
    const served = completeQuest(fresh({ karma: -5 }), rules(), 'repair-cafe').game;
    expect(stateOf(served, rules(), 'repair-cafe')).toBe('done');
    expect(stateOf(changeKarma(served, rules(), -10).game, rules(), 'repair-cafe')).toBe('done');
    const dipped = changeKarma(served, rules(), -30).game;
    expect(dipped.quests['repair-cafe']).toBeUndefined();
    expect(stateOf(dipped, rules(), 'repair-cafe')).toBe('available');
  });
});

describe('scenario events: karma', () => {
  it('a karma loss costs every time; a karma gain counts once', () => {
    let g = fresh();
    g = frozen(applyEvent(g, rules(), 'bank-pentest', { id: 'opened-backup', money: 0, karma: -5 }).game);
    g = frozen(applyEvent(g, rules(), 'bank-pentest', { id: 'opened-backup', money: 0, karma: -5 }).game);
    expect(g.karma).toBe(-10);
    const a = applyEvent(fresh(), rules(), 'bank-pentest', { id: 'nice', money: 0, karma: 5 });
    expect(a).toMatchObject({ karma: 5, money: 0 });
    expect(applyEvent(frozen(a.game), rules(), 'bank-pentest', { id: 'nice', money: 0, karma: 5 })).toMatchObject({ karma: 0 });
  });
  it('a karma event can bring the agency', () => {
    const r = applyEvent(fresh({ karma: -55, money: 500 }), rules(), 'bank-pentest', { id: 'out-of-scope', money: -100, karma: -10 });
    expect(r).toMatchObject({ money: -100, karma: -10, agency: { fine: AGENCY_FINE } });
    expect(r.game).toMatchObject({ money: 0, probation: true });
  });
});

describe('the independent contractor', () => {
  it('is a flag in the save, off in a new game', () => {
    expect(newGame('en').contractor).toBe(false);
    const on = setContractor(fresh(), true);
    expect(on.contractor).toBe(true);
    expect(setContractor(on, true)).toBe(on);
  });
  it('a terminal job pays 150% of its money (XP unchanged), after the AI hints', () => {
    expect(CONTRACT_PERCENT).toBe(150);
    const g = fresh({ contractor: true, quests: { 'disk-full': 'done' } });
    const r = completeQuest(g, rules(), 'bakery-hotfix');
    expect(r.ok && r.reward).toMatchObject({ money: 300, xp: 25, contract: true });
    const hinted = completeQuest({ ...g, hints: { 'bakery-hotfix': ['hint.status'] } }, rules(), 'bakery-hotfix');
    expect(hinted.ok && hinted.reward).toMatchObject({ money: 240, xp: 20, percent: 80 }); // 200 x 80% x 150%
    expect(completeQuest({ ...g, contractor: false }, rules(), 'bakery-hotfix').ok && completeQuest({ ...g, contractor: false }, rules(), 'bakery-hotfix')).toMatchObject({ reward: { money: 200, contract: false } });
  });
  it('only a job with procedures is a contract: battles, hustles, community service and plain jobs are not', () => {
    const g = fresh({ contractor: true });
    const find = (id: string) => content().quests.find((q) => q.id === id);
    expect(contracted(g, find('bakery-hotfix'))).toBe(true);
    expect(contracted(g, find('rate-limiter-interview'))).toBe(false);
    // a job without procedures has nothing to skip: no bonus, no bill
    expect(contracted(g, find('bank-pentest'))).toBe(false);
    expect(contracted(g, find('disk-full'))).toBe(false);
    expect(contracted(g, find('vending-prices'))).toBe(false);
    expect(contracted(g, find('repair-cafe'))).toBe(false);
    expect(contracted({ ...g, contractor: false }, find('bakery-hotfix'))).toBe(false);
  });
  it('damage on a job is billed three times, still never below zero', () => {
    expect(DAMAGE_MULTIPLIER).toBe(3);
    const ev = { id: 'orders-gone', money: -120 };
    expect(applyEvent(fresh({ money: 1000 }), rules(), 'bakery-hotfix', ev)).toMatchObject({ money: -120 });
    expect(applyEvent(fresh({ money: 1000, contractor: true }), rules(), 'bakery-hotfix', ev)).toMatchObject({ money: -360 });
    expect(applyEvent(fresh({ money: 200, contractor: true }), rules(), 'bakery-hotfix', ev).game.money).toBe(0);
    // the built-in outage too; a job without procedures is billed like anyone's
    expect(applyEvent(fresh({ money: 1000, contractor: true }), rules(), 'bakery-hotfix', { id: 'outage', money: -100 })).toMatchObject({ money: -300 });
    expect(applyEvent(fresh({ money: 1000, contractor: true }), rules(), 'disk-full', { id: 'outage', money: -100 })).toMatchObject({ money: -100 });
    expect(completeQuest(fresh({ contractor: true }), rules(), 'bank-pentest')).toMatchObject({ reward: { money: 300, contract: false } });
    // a bonus is not multiplied, and a hustle's damage is not a contractor's
    expect(applyEvent(fresh({ contractor: true }), rules(), 'bakery-hotfix', { id: 'tidy', money: 50 })).toMatchObject({ money: 50 });
    expect(applyEvent(fresh({ money: 1000, contractor: true }), rules(), 'vending-prices', { id: 'outage', money: -100 })).toMatchObject({ money: -100 });
  });
});

describe('save format 4: karma', () => {
  const v3 = {
    format: 'nines-save',
    version: 3,
    game: {
      locale: 'en', money: 120, xp: { linux: 20 }, quests: { 'disk-full': 'done' }, items: [], flags: {}, tech_debt: 0, seed: 9, ticks: 2,
      claimed: [], tokens: 2, hints: {}, path: null, player: { map: 'junior-village', x: 3, y: 4, facing: 'up' },
    },
  };
  it('migrates a version-3 save: karma 0, a clean record, employed; everything else kept', () => {
    expect(SAVE_VERSION).toBe(4);
    expect(MIGRATIONS[3]!({ a: 1 })).toEqual({ a: 1, karma: 0, strikes: 0, caught: 0, probation: false, contractor: false });
    expect(deserialize(JSON.stringify(v3), 'en')).toEqual({ kind: 'ok', game: { ...v3.game, karma: 0, strikes: 0, caught: 0, probation: false, contractor: false } });
  });
  it('writes version 4 and reads back the same game', () => {
    const st = memoryStorage({ [SAVE_KEY]: JSON.stringify(v3) });
    const { slot, game } = openSave(st, 'en', 1);
    expect(slot.status).toBe('loaded');
    const g = { ...game, karma: -35, strikes: 1, caught: 2, probation: true, contractor: true };
    expect(slot.save(g)).toBe(true);
    expect(JSON.parse(st.data.get(SAVE_KEY)!).version).toBe(4);
    expect(deserialize(serialize(g), 'en')).toEqual({ kind: 'ok', game: g });
  });
  it('repairs bad values: karma clamped and rounded, broken counts to 0, flags only when true', () => {
    const bad = { ...v3, version: 4, game: { ...v3.game, karma: -400, strikes: -2, caught: 1.5, probation: 'yes', contractor: 1 } };
    const out = deserialize(JSON.stringify(bad), 'en');
    expect(out.kind === 'ok' && out.game).toMatchObject({ karma: -100, strikes: 0, caught: 0, probation: false, contractor: false });
    const odd = deserialize(JSON.stringify({ ...bad, game: { ...bad.game, karma: '50' } }), 'en');
    expect(odd.kind === 'ok' && odd.game.karma).toBe(0);
    const frac = deserialize(JSON.stringify({ ...bad, game: { ...bad.game, karma: 12.6 } }), 'en');
    expect(frac.kind === 'ok' && frac.game.karma).toBe(13);
  });
  it('a version-1 save walks the whole chain to karma 0', () => {
    const out = deserialize(JSON.stringify({ format: 'nines-save', version: 1, game: { locale: 'en', money: 10 } }), 'en');
    expect(out.kind === 'ok' && out.game).toMatchObject({ money: 10, tokens: 3, karma: 0, probation: false, contractor: false });
  });
});
