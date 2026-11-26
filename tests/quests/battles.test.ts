// The battles in /content, played through the engine. Every battle can be won by a perfect
// play, is lost by an all-wrong play, always finishes, can be retried, and explains every
// answer in both languages.

import { describe, expect, it } from 'vitest';
import type { BattleRound, BattleSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { answerRound, type BattleState, compileBattle, presentRound, retryBattle, startBattle } from '../../src/battle/engine';
import { explanations, perfectAnswer, quality, worstAnswer } from '../../src/battle/score';
import { shuffle } from '../../src/battle/seed';
import { content } from '../helpers';

const battles = () => content().quests.flatMap((q) => (q.battle ? [{ id: q.id, spec: q.battle, quest: q.quest }] : []));

const ids = (r: BattleRound) => (r.type === 'order' ? r.items.map((i) => i.id) : r.options.map((o) => o.id));
const pickOf = (r: BattleRound) => (r.type === 'order' ? r.items.length : r.type === 'clarify' ? (r.pick ?? 1) : 1);

/** All answers a player can give to a pick round (k-subsets; order does not matter). */
function allPicks(r: BattleRound): string[][] {
  const all = ids(r);
  const k = pickOf(r);
  const out: string[][] = [];
  const go = (from: number, acc: string[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = from; i < all.length; i++) go(i + 1, [...acc, all[i]!]);
  };
  go(0, []);
  return out;
}

/** Every locale key a battle uses for text the player reads. */
function keysOf(spec: BattleSpec): string[] {
  const keys = [spec.attacker, ...spec.intro, ...spec.outro.won, ...spec.outro.lost, ...(spec.hints ?? []).map((h) => h.text)];
  for (const r of spec.rounds) {
    keys.push(...r.prompt);
    if (r.type === 'order') keys.push(...r.items.flatMap((i) => [i.text, i.why]));
    else keys.push(...r.options.flatMap((o) => [o.text, o.why]));
    if (r.type === 'flaw') keys.push(...r.proposal);
    if (r.type === 'estimate') keys.push(r.working);
  }
  return keys;
}

function play(id: string, spec: BattleSpec, pick: (r: BattleRound) => string[], s?: BattleState) {
  const b = compileBattle(id, spec);
  let st = s ?? startBattle(b);
  while (st.status === 'active') st = answerRound(b, st, pick(spec.rounds[st.round]!)).state;
  return st;
}

describe('the battles in content', () => {
  it('cover the three encounter kinds and the three ways to start', () => {
    const bs = battles();
    expect(bs.map((b) => [b.id, b.spec.kind, b.spec.trigger.kind])).toEqual([
      ['friday-scope', 'stakeholder', 'npc'],
      ['night-pager', 'incident', 'pager'],
      ['rate-limiter-interview', 'design', 'gate'],
    ]);
    expect(bs.every((b) => b.quest.stage === 'junior')).toBe(true);
  });
  it('use every question type', () => {
    const types = new Set(battles().flatMap((b) => b.spec.rounds.map((r) => r.type)));
    expect([...types].sort()).toEqual(['clarify', 'estimate', 'flaw', 'order', 'tradeoff']);
  });
  it('have every string, and every explanation, in English and Dutch', () => {
    const { locales } = content();
    for (const b of battles()) {
      for (const k of keysOf(b.spec)) {
        const key = questKey(b.id, k);
        expect(locales.en[key]?.trim(), `${b.id}: en ${k}`).toBeTruthy();
        expect(locales.nl[key]?.trim(), `${b.id}: nl ${k}`).toBeTruthy();
      }
    }
  });
  it('explain every possible answer to every round', () => {
    for (const b of battles()) {
      for (const r of b.spec.rounds) {
        const answers = r.type === 'order' ? Array.from({ length: 30 }, (_, i) => shuffle(ids(r), `${r.id}/${i}`)) : allPicks(r);
        for (const a of answers) {
          const ex = explanations(r, a);
          expect(ex.length, `${b.id}/${r.id}: ${a.join(',')}`).toBeGreaterThan(0);
          expect(ex.every((k) => content().locales.nl[questKey(b.id, k)])).toBe(true);
        }
      }
    }
  });
  it('are won by a perfect play and lost by an all-wrong play', () => {
    for (const b of battles()) {
      const won = play(b.id, b.spec, perfectAnswer);
      expect(won.status, b.id).toBe('won');
      expect(won.log).toHaveLength(b.spec.rounds.length);
      expect(play(b.id, b.spec, worstAnswer).status, b.id).toBe('lost');
    }
  });
  it('always finish, and a lost battle can be retried and won', () => {
    for (const b of battles()) {
      const c = compileBattle(b.id, b.spec);
      for (let seed = 0; seed < 200; seed++) {
        // a player who picks the first cards shown, in the order shown
        let s = startBattle(c, { seed });
        let steps = 0;
        while (s.status === 'active') {
          const v = presentRound(c, s)!;
          s = answerRound(c, s, v.cards.slice(0, v.pick)).state;
          steps++;
        }
        expect(steps).toBeLessThanOrEqual(b.spec.rounds.length);
        if (s.status === 'lost') expect(play(b.id, b.spec, perfectAnswer, retryBattle(c, s)).status).toBe('won');
      }
    }
  });
  it('do not hand out the win to a lucky first-card player', () => {
    // The first cards shown, in the order shown, should rarely be a perfect answer.
    for (const b of battles()) {
      const c = compileBattle(b.id, b.spec);
      let wins = 0;
      for (let seed = 0; seed < 200; seed++) {
        let s = startBattle(c, { seed });
        while (s.status === 'active') {
          const v = presentRound(c, s)!;
          s = answerRound(c, s, v.cards.slice(0, v.pick)).state;
        }
        if (s.status === 'won') wins++;
      }
      expect(wins, b.id).toBeLessThan(10);
    }
  });
  it('give hints on a retry', () => {
    for (const b of battles()) {
      const c = compileBattle(b.id, b.spec);
      const lost = play(b.id, b.spec, worstAnswer);
      let s = retryBattle(c, lost);
      const seen = new Set<string>();
      while (s.status === 'active') {
        presentRound(c, s)!.hints.forEach((h) => seen.add(h));
        s = answerRound(c, s, perfectAnswer(b.spec.rounds[s.round]!)).state;
      }
      expect(seen.size, b.id).toBeGreaterThanOrEqual(3);
    }
  });
  it('estimate rounds: the reference value lies in the range graded best', () => {
    for (const b of battles()) {
      for (const r of b.spec.rounds) {
        if (r.type !== 'estimate') continue;
        const best = r.options.find((o) => o.grade === 'best')!;
        expect(r.value >= best.min && (best.max === undefined || r.value < best.max), `${b.id}/${r.id}`).toBe(true);
        expect(quality(r, [best.id])).toBe(1);
      }
    }
  });
});
