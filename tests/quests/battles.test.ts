// The battles in /content, played through the engine. Every battle can be won by a perfect
// play, is lost by an all-wrong play, always finishes, can be retried, and explains every
// answer in both languages.

import { describe, expect, it } from 'vitest';
import type { BattleRound, BattleSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { answerRound, type BattleState, compileBattle, presentRound, retryBattle, startBattle } from '../../src/battle/engine';
import { explanations, perfectAnswer, quality, worstAnswer } from '../../src/battle/score';
import { shuffle } from '../../src/battle/seed';
import { questState } from '../../src/core/progress';
import { conversation } from '../../src/core/talk';
import { newGame } from '../../src/core/save';
import { content } from '../helpers';

/** A fresh save with these quest states. */
const save = (quests: Record<string, 'active' | 'done'>) => ({ ...newGame('en'), quests });

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
    expect(bs.map((b) => [b.id, b.spec.kind, b.spec.trigger.kind, b.quest.stage])).toEqual([
      ['code-review', 'stakeholder', 'npc', 'medior'],
      ['collab-editor-interview', 'design', 'npc', 'senior'],
      ['error-budget', 'incident', 'npc', 'medior'],
      ['friday-scope', 'stakeholder', 'npc', 'junior'],
      ['golden-path', 'design', 'npc', 'medior'],
      ['nearby-places', 'design', 'npc', 'junior'],
      ['night-pager', 'incident', 'pager', 'junior'],
      ['rate-limiter-interview', 'design', 'gate', 'junior'],
      ['ticket-booking-interview', 'design', 'npc', 'senior'],
      ['url-shortener', 'design', 'npc', 'medior'],
    ]);
  });
  it('can each be reached: a giver who stands somewhere, and a start where that giver stands or at an object', () => {
    const { quests } = content();
    const npcs = quests.flatMap((q) => (q.npc ? [q.npc] : []));
    for (const b of battles()) {
      const giver = npcs.find((n) => n.id === b.quest.giver);
      expect(giver, `${b.id}: giver ${b.quest.giver}`).toBeDefined();
      // A talk-started battle opens where its giver stands, or at a battle object of its own.
      if (b.spec.trigger.kind === 'npc' && b.quest.start.object.startsWith('npc-')) {
        expect(b.quest.start, b.id).toEqual({ map: giver!.spawn.map, object: giver!.spawn.slot });
      }
    }
  });
  it('nearby places: Ravi asks it once his pipeline is fixed, in Junior Village', () => {
    const q = content().quests.find((x) => x.id === 'nearby-places')!.quest;
    expect([q.giver, q.requires, q.start]).toEqual(['ravi', ['broken-pipeline'], { map: 'junior-village', object: 'npc-2' }]);
    expect(questState(save({}), content().quests.map((x) => x.quest), 'nearby-places')).toBe('locked');
    expect(questState(save({ 'broken-pipeline': 'done' }), content().quests.map((x) => x.quest), 'nearby-places')).toBe('available');
    expect(conversation(save({ 'broken-pipeline': 'done' }), content(), 'ravi')).toMatchObject({ offer: 'nearby-places', battle: 'nearby-places' });
    expect(conversation(save({ 'broken-pipeline': 'active' }), content(), 'ravi')?.battle).toBeUndefined();
  });
  it('URL shortener: Medior, asked by Hugo at his whiteboard in Medior City once the gate interview is won', () => {
    const q = content().quests.find((x) => x.id === 'url-shortener')!.quest;
    expect([q.stage, q.giver, q.requires, q.start]).toEqual(['medior', 'hugo', ['rate-limiter-interview'], { map: 'medior-city', object: 'npc-5' }]);
    const specs = content().quests.map((x) => x.quest);
    expect(questState(save({ 'disk-full': 'done', 'service-down': 'done', 'broken-pipeline': 'done' }), specs, 'url-shortener')).toBe('locked');
    expect(questState(save({ 'rate-limiter-interview': 'done' }), specs, 'url-shortener')).toBe('available');
    // Talking to Hugo offers it once the gate is won, and the talk opens the battle; Ingrid at the gate no longer does.
    expect(conversation(save({ 'rate-limiter-interview': 'done' }), content(), 'hugo')).toMatchObject({ offer: 'url-shortener', battle: 'url-shortener' });
    expect(conversation(save({ 'rate-limiter-interview': 'done' }), content(), 'ingrid')?.offer).toBeUndefined();
    const npc = content().quests.find((x) => x.id === 'url-shortener')!.npc!;
    expect(npc.spawn).toMatchObject({ map: 'medior-city', slot: 'npc-5' });
    const node = content().roadmap.nodes.find((n) => n.id === q.roadmap_node)!;
    expect([node.stage, node.branch]).toEqual(['medior', 'design']);
  });
  it('the mentors\' battles in Medior City open once a path is chosen, and greet their own path differently', () => {
    const won = { ...save({ 'rate-limiter-interview': 'done' }) };
    for (const [id, giver, path, other] of [
      ['code-review', 'lars', 'swe', 'sre'],
      ['error-budget', 'amara', 'sre', 'swe'],
      ['golden-path', 'kim', 'platform', 'swe'],
    ] as const) {
      const q = content().quests.find((x) => x.id === id)!;
      expect([q.quest.stage, q.quest.giver, q.quest.paths, q.quest.start.map], id).toEqual(['medior', giver, [path], 'medior-city']);
      expect(q.npc?.spawn.slot, id).toBe(q.quest.start.object);
      const specs = content().quests.map((x) => x.quest);
      expect(questState(won, specs, id), id).toBe('locked');
      const mine = conversation({ ...won, path }, content(), giver)!;
      const theirs = conversation({ ...won, path: other }, content(), giver)!;
      expect(mine).toMatchObject({ offer: id, battle: id });
      expect(theirs).toMatchObject({ offer: id, battle: id });
      // the mentor's greeting comes before the offer, and differs by path
      expect(mine.lines[0], id).not.toBe(theirs.lines[0]);
      expect(mine.lines.at(-1)).toBe(theirs.lines.at(-1));
    }
  });
  it('the Senior Summit interviews are started by their giver, who stands on the map roadmap.yaml plans for the town', () => {
    const { roadmap, quests } = content();
    const summit = roadmap.towns.find((t) => t.stage === 'senior')!;
    for (const id of ['ticket-booking-interview', 'collab-editor-interview']) {
      const q = quests.find((x) => x.id === id)!;
      expect(q.battle?.trigger.kind, id).toBe('npc');
      expect(q.quest.start.map, id).toBe(summit.map);
      expect(q.npc?.spawn.map, id).toBe(summit.map);
      expect(q.npc?.spawn.slot, id).toBe(q.quest.start.object);
      expect(q.battle!.rounds.length, id).toBeGreaterThanOrEqual(6);
      expect(q.battle!.rounds.length, id).toBeLessThanOrEqual(8);
    }
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
  it('do not give the answer away by length: the longest card is rarely the best', () => {
    let rounds = 0;
    let longestIsBest = 0;
    const { locales } = content();
    for (const b of battles()) {
      for (const r of b.spec.rounds) {
        if (r.type === 'order') continue;
        rounds++;
        const len = (o: { text: string }) => locales.en[questKey(b.id, o.text)]!.length;
        const longest = [...r.options].sort((x, y) => len(y) - len(x))[0]!;
        if (longest.grade === 'best') longestIsBest++;
      }
    }
    expect(longestIsBest / rounds).toBeLessThanOrEqual(0.5);
  });
  it('do not give the answer away by length rank either: no rank holds the best in most rounds', () => {
    const { locales } = content();
    const ranks = new Map<number, number>();
    let rounds = 0;
    for (const b of battles()) {
      for (const r of b.spec.rounds) {
        if (r.type === 'order' || r.type === 'clarify') continue;
        const len = (o: { text: string }) => locales.en[questKey(b.id, o.text)]!.length;
        const rank = [...r.options].sort((x, y) => len(x) - len(y)).findIndex((o) => o.grade === 'best');
        ranks.set(rank, (ranks.get(rank) ?? 0) + 1);
        rounds++;
      }
    }
    for (const [rank, n] of ranks) expect(n / rounds, `best is length rank ${rank + 1}`).toBeLessThanOrEqual(0.5);
  });
  it('are lost by a player who always picks the longest or the shortest cards', () => {
    const { locales } = content();
    for (const b of battles()) {
      for (const lang of ['en', 'nl'] as const) {
        for (const dir of [1, -1]) {
          const pick = (r: BattleRound) => {
            if (r.type === 'order') return worstAnswer(r);
            const len = (id: string) => locales[lang][questKey(b.id, r.options.find((o) => o.id === id)!.text)]!.length * dir;
            return ids(r).sort((x, y) => len(y) - len(x)).slice(0, pickOf(r));
          };
          expect(play(b.id, b.spec, pick).status, `${b.id} ${lang} ${dir > 0 ? 'longest' : 'shortest'}`).toBe('lost');
        }
      }
    }
  });
  it('do not give the answer away by length within one battle, in either language', () => {
    // The checks above run over all battles together; here each battle and each language must
    // hold on its own, so a new battle cannot hide behind the others.
    const { locales } = content();
    for (const b of battles()) {
      for (const lang of ['en', 'nl'] as const) {
        const rounds = b.spec.rounds.flatMap((r) => (r.type === 'order' ? [] : [r]));
        const len = (o: { text: string }) => locales[lang][questKey(b.id, o.text)]!.length;
        const longestIsBest = rounds.filter((r) => [...r.options].sort((x, y) => len(y) - len(x))[0]!.grade === 'best').length;
        expect(longestIsBest / rounds.length, `${b.id} ${lang}: the longest card is the best`).toBeLessThanOrEqual(0.5);
        const shortestIsBest = rounds.filter((r) => [...r.options].sort((x, y) => len(x) - len(y))[0]!.grade === 'best').length;
        expect(shortestIsBest / rounds.length, `${b.id} ${lang}: the shortest card is the best`).toBeLessThanOrEqual(0.5);
      }
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
