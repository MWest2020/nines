// The battle engine on a small fixture with one round of every type.

import { describe, expect, it } from 'vitest';
import type { BattleSpec, QuestEntry } from '../../src/content/types';
import { newGame } from '../../src/core/save';
import { progressEnv } from '../../src/core/progress';
import {
  answerRound,
  type BattleState,
  BattleError,
  cardsFor,
  compileBattle,
  hintsFor,
  presentRound,
  retryBattle,
  startBattle,
} from '../../src/battle/engine';
import { answerProblem, explanations, perfectAnswer, quality, worstAnswer } from '../../src/battle/score';
import { hash32, prng, roll, shuffle } from '../../src/battle/seed';
import { gateOpen, pagerFires } from '../../src/battle/triggers';

const opt = (id: string, grade: 'best' | 'fair' | 'weak') => ({ id, grade, text: `${id}.t`, why: `${id}.w` });

const SPEC: BattleSpec = {
  schema: 1,
  kind: 'design',
  attacker: 'attacker',
  intro: ['intro'],
  trigger: { kind: 'npc' },
  rounds: [
    { id: 'trade', type: 'tradeoff', prompt: ['p'], stakes: 20, options: [opt('a', 'best'), opt('b', 'fair'), opt('c', 'weak')] },
    { id: 'flaw', type: 'flaw', prompt: ['p'], stakes: 20, cost: 30, proposal: ['x'], options: [opt('a', 'weak'), opt('b', 'best'), opt('c', 'weak')] },
    {
      id: 'ask',
      type: 'clarify',
      prompt: ['p'],
      stakes: 20,
      pick: 2,
      options: [opt('a', 'best'), opt('b', 'best'), opt('c', 'fair'), opt('d', 'weak'), opt('e', 'weak')],
    },
    {
      id: 'steps',
      type: 'order',
      prompt: ['p'],
      stakes: 20,
      items: [
        { id: 's1', text: 's1.t', why: 's1.w' },
        { id: 's2', text: 's2.t', why: 's2.w', rank: 2 },
        { id: 's3', text: 's3.t', why: 's3.w', rank: 2 },
        { id: 's4', text: 's4.t', why: 's4.w', rank: 4 },
      ],
    },
    {
      id: 'calc',
      type: 'estimate',
      prompt: ['p'],
      stakes: 20,
      value: 1500,
      working: 'calc.working',
      options: [
        { ...opt('low', 'weak'), min: 0, max: 100 },
        { ...opt('mid', 'fair'), min: 100, max: 1000 },
        { ...opt('right', 'best'), min: 1000, max: 10000 },
        { ...opt('high', 'weak'), min: 10000 },
      ],
    },
    { id: 'last', type: 'tradeoff', prompt: ['p'], stakes: 20, options: [opt('a', 'weak'), opt('b', 'weak'), opt('c', 'best')] },
  ],
  hints: [
    { id: 'retry', round: 'flaw', when: 'attempts >= 1', text: 'hint.retry' },
    { id: 'shaky', when: 'confidence <= 50', text: 'hint.shaky' },
    { id: 'misses', when: 'misses >= 2 && round >= 3', text: 'hint.misses' },
  ],
  outro: { won: ['won'], lost: ['lost'] },
};

const B = compileBattle('fixture', SPEC);
const round = (id: string) => SPEC.rounds.find((r) => r.id === id)!;

/** Play to the round with this id using perfect answers, then return the state there. */
function at(id: string, s: BattleState = startBattle(B)): BattleState {
  while (SPEC.rounds[s.round]!.id !== id) s = answerRound(B, s, perfectAnswer(SPEC.rounds[s.round]!)).state;
  return s;
}

describe('scoring, per question type', () => {
  it('tradeoff and flaw: best 1, fair 0.5, weak 0', () => {
    expect(quality(round('trade'), ['a'])).toBe(1);
    expect(quality(round('trade'), ['b'])).toBe(0.5);
    expect(quality(round('trade'), ['c'])).toBe(0);
    expect(quality(round('flaw'), ['b'])).toBe(1);
    expect(quality(round('flaw'), ['a'])).toBe(0);
  });
  it('clarify: the picks over the best the same number of picks can reach', () => {
    const r = round('ask');
    expect(quality(r, ['a', 'b'])).toBe(1);
    expect(quality(r, ['b', 'a'])).toBe(1);
    expect(quality(r, ['a', 'c'])).toBe(0.75);
    expect(quality(r, ['a', 'd'])).toBe(0.5);
    expect(quality(r, ['d', 'e'])).toBe(0);
  });
  it('order: right pairs, rescaled; equal ranks may come in either order', () => {
    const r = round('steps');
    expect(quality(r, ['s1', 's2', 's3', 's4'])).toBe(1);
    expect(quality(r, ['s1', 's3', 's2', 's4'])).toBe(1); // s2 and s3 share rank 2
    expect(quality(r, ['s4', 's3', 's2', 's1'])).toBe(0); // the reverse
    // 5 pairs count (s2/s3 do not); one swap of s1 and s2 gets 4 of 5 right: 2 * 0.8 - 1
    expect(quality(r, ['s2', 's1', 's3', 's4'])).toBeCloseTo(0.6);
    // s4 first: 3 pairs wrong, 2 right -> below one half -> 0
    expect(quality(r, ['s4', 's1', 's2', 's3'])).toBe(0);
  });
  it('estimate: the range graded best holds the value; the others score by their grade', () => {
    const r = round('calc');
    expect(quality(r, ['right'])).toBe(1);
    expect(quality(r, ['mid'])).toBe(0.5);
    expect(quality(r, ['high'])).toBe(0);
  });
  it('perfect and worst answers are the extremes of every type', () => {
    for (const r of SPEC.rounds) {
      expect(quality(r, perfectAnswer(r)), r.id).toBe(1);
      expect(quality(r, worstAnswer(r)), r.id).toBe(0);
    }
  });
  it('refuses answers of the wrong shape', () => {
    expect(answerProblem(round('trade'), ['a', 'b'])).toMatch(/pick exactly 1/);
    expect(answerProblem(round('ask'), ['a'])).toMatch(/pick exactly 2/);
    expect(answerProblem(round('ask'), ['a', 'a'])).toMatch(/twice/);
    expect(answerProblem(round('steps'), ['s1', 's2', 's3'])).toMatch(/order all 4/);
    expect(answerProblem(round('trade'), ['constructor'])).toMatch(/unknown id/);
    const s = startBattle(B);
    expect(() => answerRound(B, s, ['zz'])).toThrow(BattleError);
  });
  it('every answer comes with at least one explanation, and the best answer is explained too', () => {
    expect(explanations(round('trade'), ['c'])).toEqual(['c.w', 'a.w']);
    expect(explanations(round('trade'), ['a'])).toEqual(['a.w']);
    expect(explanations(round('ask'), ['a', 'd'])).toEqual(['a.w', 'd.w', 'b.w']);
    expect(explanations(round('steps'), ['s4', 's3', 's2', 's1'])).toEqual(['s1.w', 's2.w', 's3.w', 's4.w']);
    expect(explanations(round('calc'), ['low'])).toEqual(['low.w', 'right.w', 'calc.working']);
  });
});

describe('the meters', () => {
  it('a good answer lowers the pressure, a weak one costs confidence', () => {
    const s = startBattle(B);
    const good = answerRound(B, s, ['a']).result;
    expect([good.pressure, good.confidence, good.grade]).toEqual([-20, 0, 'best']);
    const half = answerRound(B, s, ['b']).result;
    expect([half.pressure, half.confidence, half.grade]).toEqual([-10, -10, 'fair']);
    const bad = answerRound(B, s, ['c']).result;
    expect([bad.pressure, bad.confidence, bad.grade]).toEqual([0, -20, 'weak']);
    expect(bad.best).toEqual(['a']);
  });
  it('the cost of a round can differ from its stakes', () => {
    const s = at('flaw');
    expect(answerRound(B, s, ['a']).result.confidence).toBe(-30);
  });
  it('stay between 0 and their maximum, whatever the player does', () => {
    const next = prng(hash32('meters'));
    for (let play = 0; play < 500; play++) {
      let s = startBattle(B, { seed: play });
      let answers = 0;
      while (s.status === 'active') {
        const r = SPEC.rounds[s.round]!;
        const ids = r.type === 'order' ? r.items.map((i) => i.id) : r.options.map((o) => o.id);
        const pick = r.type === 'order' ? shuffle(ids, `p${play}/${answers}`) : shuffle(ids, `p${play}/${answers}`).slice(0, r.type === 'clarify' ? (r.pick ?? 1) : 1);
        s = answerRound(B, s, next() < 0.3 ? perfectAnswer(r) : pick).state;
        answers++;
        expect(s.confidence).toBeGreaterThanOrEqual(0);
        expect(s.confidence).toBeLessThanOrEqual(B.max.confidence);
        expect(s.pressure).toBeGreaterThanOrEqual(0);
        expect(s.pressure).toBeLessThanOrEqual(B.max.pressure);
      }
      expect(answers).toBeLessThanOrEqual(SPEC.rounds.length);
      expect(['won', 'lost']).toContain(s.status);
    }
  });
});

describe('winning, losing and trying again', () => {
  const play = (pick: typeof perfectAnswer, s = startBattle(B)) => {
    while (s.status === 'active') s = answerRound(B, s, pick(SPEC.rounds[s.round]!)).state;
    return s;
  };
  it('a perfect play wins, with every round played', () => {
    const s = play(perfectAnswer);
    expect(s.status).toBe('won');
    expect(s.log).toHaveLength(SPEC.rounds.length);
    expect([s.pressure, s.confidence, s.wins, s.misses]).toEqual([0, 100, 1, 0]);
  });
  it('an all-wrong play loses, as soon as confidence is gone', () => {
    const s = play(worstAnswer);
    expect(s.status).toBe('lost');
    expect(s.confidence).toBe(0);
    expect(s.log.length).toBeLessThan(SPEC.rounds.length);
  });
  it('playing every round without bringing the pressure to 0 loses too', () => {
    // fair answers everywhere: half the stakes off the pressure, half the cost off confidence
    let s = startBattle(B);
    for (const id of ['b', 'a', 'a', 'x', 'mid', 'c']) {
      const r = SPEC.rounds[s.round]!;
      s = answerRound(B, s, r.type === 'order' ? ['s2', 's1', 's3', 's4'] : r.type === 'clarify' ? ['a', 'c'] : r.id === 'flaw' ? ['b'] : [id]).state;
    }
    expect(s.status).toBe('lost');
    expect(s.confidence).toBeGreaterThan(0);
    expect(s.pressure).toBeGreaterThan(0);
  });
  it('a finished battle takes no more answers until it is retried', () => {
    const s = play(worstAnswer);
    expect(() => answerRound(B, s, ['a'])).toThrow(/retry/);
    expect(presentRound(B, s)).toBeNull();
  });
  it('retry refills the meters, counts the attempt and keeps the wins; then it can be won', () => {
    const lost = play(worstAnswer);
    const again = retryBattle(B, lost);
    expect(again).toMatchObject({ attempt: 1, round: 0, status: 'active', confidence: 100, pressure: 100, misses: 0, log: [], wins: 0 });
    const won = play(perfectAnswer, again);
    expect(won.status).toBe('won');
    expect(retryBattle(B, won)).toMatchObject({ attempt: 2, wins: 1, status: 'active' });
  });
  it('is deterministic: the same answers give the same states', () => {
    expect(play(worstAnswer)).toEqual(play(worstAnswer));
  });
});

describe('hints', () => {
  it('a round hint appears on a retry, on that round only', () => {
    const first = startBattle(B);
    expect(hintsFor(B, at('flaw', first))).toEqual([]);
    const second = retryBattle(B, first);
    expect(hintsFor(B, second)).toEqual([]);
    expect(hintsFor(B, at('flaw', second))).toEqual(['hint.retry']);
    expect(presentRound(B, at('flaw', second))!.hints).toEqual(['hint.retry']);
  });
  it('the homelab hint boost brings hints one try sooner', () => {
    expect(hintsFor(B, at('flaw', startBattle(B, { hintBoost: 1 })))).toEqual(['hint.retry']);
  });
  it('hints can read the meters, the round and the misses', () => {
    let s = startBattle(B);
    s = answerRound(B, s, ['c']).state; // -20 confidence
    s = answerRound(B, s, ['a']).state; // -30 confidence: 50 left
    expect(s.confidence).toBe(50);
    expect(hintsFor(B, s)).toEqual(['hint.shaky', 'hint.misses']);
  });
  it('a hint condition must use battle facts', () => {
    expect(() => compileBattle('bad', { ...SPEC, hints: [{ id: 'x', when: 'fails >= 1', text: 'x' }] })).toThrow(/unknown name "fails"/);
  });
});

describe('cards', () => {
  it('are a seeded shuffle: the same save sees the same order', () => {
    const s = startBattle(B, { seed: 7 });
    expect(cardsFor(B, s, round('trade'))).toEqual(cardsFor(B, startBattle(B, { seed: 7 }), round('trade')));
    expect([...cardsFor(B, s, round('ask'))].sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('an order round never starts out solved', () => {
    for (let seed = 0; seed < 300; seed++) {
      const cards = cardsFor(B, startBattle(B, { seed }), round('steps'));
      expect(quality(round('steps'), cards)).toBeLessThan(1);
    }
  });
  it('estimate ranges stay in ascending order', () => {
    expect(cardsFor(B, startBattle(B, { seed: 3 }), round('calc'))).toEqual(['low', 'mid', 'right', 'high']);
  });
  it('presentRound tells the UI the round, the cards and how many to pick', () => {
    const v = presentRound(B, at('ask'))!;
    expect([v.number, v.of, v.pick, v.cards.length]).toEqual([3, 6, 2, 5]);
  });
});

describe('seeded randomness', () => {
  it('hash, shuffle and roll are stable and in range', () => {
    expect(hash32('nines')).toBe(hash32('nines'));
    expect(hash32('a')).not.toBe(hash32('b'));
    expect(shuffle([1, 2, 3, 4, 5], 'k')).toEqual(shuffle([1, 2, 3, 4, 5], 'k'));
    expect([...shuffle([1, 2, 3, 4, 5], 'k')].sort()).toEqual([1, 2, 3, 4, 5]);
    const rolls = Array.from({ length: 1000 }, (_, i) => roll(`r${i}`));
    expect(Math.min(...rolls)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...rolls)).toBeLessThanOrEqual(99);
    const under20 = rolls.filter((r) => r < 20).length;
    expect(under20).toBeGreaterThan(130); // about 200 expected
    expect(under20).toBeLessThan(270);
  });
});

describe('triggers', () => {
  const quest = (id: string, battle?: BattleSpec): QuestEntry => ({
    id,
    quest: {
      schema: 1, id, author: { name: 'x' }, title: 't', summary: 's', stage: 'junior', branch: 'design', track: 'any',
      roadmap_node: 'n', requires: [], giver: 'g', start: { map: 'm', object: 'o' }, reward: { money: 1, xp: 1 },
      dialogue: { offer: ['o'], active: ['a'], done: ['d'] },
    },
    ...(battle ? { battle } : {}),
  });
  it('a pager fires only when its condition holds, its quest is open, and the seeded roll says so', () => {
    const game = newGame('en');
    const quests = [quest('pager', SPEC), quest('pre')];
    const env = progressEnv(game, quests.map((q) => q.quest));
    const always = { kind: 'pager' as const, when: 'quest("pre") == "done"', chance: 100 };
    expect(pagerFires('pager', always, 1, env, 'available')).toBe(false);
    game.quests['pre'] = 'done';
    expect(pagerFires('pager', always, 1, env, 'available')).toBe(true);
    expect(pagerFires('pager', always, 1, env, 'done')).toBe(false);
    expect(pagerFires('pager', { kind: 'npc' }, 1, env, 'available')).toBe(false);
    const rare = { ...always, chance: 20 };
    const fired = Array.from({ length: 200 }, (_, tick) => pagerFires('pager', rare, tick, env, 'available'));
    expect(fired).toEqual(Array.from({ length: 200 }, (_, tick) => pagerFires('pager', rare, tick, env, 'available')));
    expect(fired.filter(Boolean).length).toBeGreaterThan(20);
    expect(fired.filter(Boolean).length).toBeLessThan(60);
  });
  it('a gate keeps the road to its town closed until its battle is won', () => {
    const game = newGame('en');
    const quests = [quest('interview', { ...SPEC, trigger: { kind: 'gate', town: 'medior' } }), quest('other')];
    expect(gateOpen('medior', quests, game)).toBe(false);
    expect(gateOpen('senior', quests, game)).toBe(true);
    game.quests['interview'] = 'done';
    expect(gateOpen('medior', quests, game)).toBe(true);
  });
});
