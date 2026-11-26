// The battle screen's model (src/battle/screen.ts): what may be picked, when Send works, what the
// transcript, whiteboard and debrief hold, retries, and every battle in content played through
// the screen the way the overlay plays it.

import { describe, expect, it } from 'vitest';
import { compileBattle } from '../../src/battle/engine';
import { perfectAnswer, worstAnswer } from '../../src/battle/score';
import * as S from '../../src/battle/screen';
import { townNotBuilt } from '../../src/battle/triggers';
import type { BattleSpec } from '../../src/content/types';
import { content } from '../helpers';

const opt = (id: string, grade: 'best' | 'fair' | 'weak') => ({ id, grade, text: `${id}.t`, why: `${id}.w` });

const SPEC: BattleSpec = {
  schema: 1,
  kind: 'design',
  attacker: 'attacker',
  intro: ['intro.1', 'intro.2'],
  trigger: { kind: 'npc' },
  rounds: [
    { id: 'ask', type: 'clarify', prompt: ['ask.p'], stakes: 20, pick: 2, options: [opt('a', 'best'), opt('b', 'best'), opt('c', 'fair'), opt('d', 'weak')] },
    { id: 'trade', type: 'tradeoff', prompt: ['trade.ctx', 'trade.q'], stakes: 20, options: [opt('x', 'best'), opt('y', 'weak'), opt('z', 'fair')] },
    { id: 'flaw', type: 'flaw', prompt: ['flaw.q'], stakes: 20, proposal: ['flaw.p1', 'flaw.p2'], options: [opt('f', 'best'), opt('g', 'weak')] },
    {
      id: 'steps',
      type: 'order',
      prompt: ['steps.q'],
      stakes: 20,
      items: [
        { id: 's1', text: 's1.t', why: 's1.w' },
        { id: 's2', text: 's2.t', why: 's2.w' },
        { id: 's3', text: 's3.t', why: 's3.w' },
      ],
    },
    {
      id: 'calc',
      type: 'estimate',
      prompt: ['calc.ctx', 'calc.q'],
      stakes: 20,
      value: 50,
      working: 'calc.working',
      options: [{ ...opt('lo', 'weak'), min: 0, max: 10 }, { ...opt('mid', 'best'), min: 10, max: 100 }, { ...opt('hi', 'weak'), min: 100 }],
    },
  ],
  hints: [{ id: 'h', round: 'ask', when: 'attempts >= 1', text: 'hint.ask' }],
  outro: { won: ['won.1'], lost: ['lost.1'] },
};

const B = compileBattle('fixture', SPEC);
const k = (key: string) => `quest.fixture.${key}`;

/** Answer the round on screen with these ids (an order round: reorder to them) and continue. */
function answer(s: S.Screen, ids: readonly string[]): S.Screen {
  let x = s;
  if (x.view!.round.type === 'order') {
    ids.forEach((id, i) => {
      x = S.move(x, x.selection.indexOf(id), i);
    });
  } else for (const id of ids) x = S.toggle(x, id);
  expect(S.canSend(x)).toBe(true);
  return S.send(x);
}

describe('the battle screen', () => {
  it('opens with the announcement, the intro and the first question', () => {
    const s = S.openScreen(B, { seed: 7 });
    expect(s.phase).toBe('answer');
    expect(s.transcript).toEqual([
      { kind: 'announce', text: k('intro.1') },
      { kind: 'narration', text: k('intro.2') },
      { kind: 'attacker', text: k('ask.p'), round: 'ask' },
    ]);
    expect(s.view!.round.id).toBe('ask');
    expect(S.instructionOf(s.view!)).toEqual({ key: 'ui.battle.pick', params: { n: 2 } });
  });

  it('a pick-many round holds at most its picks, and Send waits until it is full', () => {
    let s = S.openScreen(B);
    expect(S.interactionOf(s.view!.round)).toBe('many');
    s = S.toggle(s, 'a');
    expect(S.canSend(s)).toBe(false);
    s = S.toggle(s, 'c');
    expect(S.full(s)).toBe(true);
    expect(S.toggle(s, 'b')).toBe(s); // refused while full
    s = S.toggle(s, 'c'); // unpick
    expect(s.selection).toEqual(['a']);
    s = S.toggle(s, 'b');
    expect(S.canSend(s)).toBe(true);
    expect(S.toggle(s, 'nope')).toBe(s);
  });

  it('a pick-one round replaces the pick; toggling it again clears it', () => {
    let s = answer(S.openScreen(B), ['a', 'b']);
    s = S.next(s);
    expect(S.interactionOf(s.view!.round)).toBe('one');
    expect(S.instructionOf(s.view!).key).toBe('ui.battle.pick_one');
    s = S.toggle(s, 'x');
    s = S.toggle(s, 'y');
    expect(s.selection).toEqual(['y']);
    s = S.toggle(s, 'y');
    expect(s.selection).toEqual([]);
    expect(S.canSend(s)).toBe(false);
    expect(S.send(s)).toBe(s);
  });

  it('send puts the answer and its note in the transcript, then continue asks the next question', () => {
    let s = S.openScreen(B);
    s = answer(s, ['a', 'd']);
    expect(s.phase).toBe('review');
    const [ans, note] = s.transcript.slice(-2);
    expect(ans).toEqual({ kind: 'answer', round: 'ask', texts: [k('a.t'), k('d.t')], ordered: false });
    expect(note).toMatchObject({ kind: 'note', round: 'ask', grade: 'fair', pressure: -10, confidence: -10 });
    expect((note as { explanations: string[] }).explanations).toEqual([k('a.w'), k('d.w'), k('b.w')]);
    expect(S.toggle(s, 'b')).toBe(s); // no picking while reviewing
    s = S.next(s);
    expect(s.phase).toBe('answer');
    expect(s.transcript.slice(-2)).toEqual([
      { kind: 'attacker', text: k('trade.ctx'), round: 'trade' },
      { kind: 'attacker', text: k('trade.q'), round: 'trade' },
    ]);
  });

  it('an order round starts with every card and moves them, clamped to the list', () => {
    let s = S.openScreen(B);
    for (const ids of [['a', 'b'], ['x'], ['f']]) s = S.next(answer(s, ids));
    expect(s.view!.round.id).toBe('steps');
    expect(S.interactionOf(s.view!.round)).toBe('order');
    expect([...s.selection].sort()).toEqual(['s1', 's2', 's3']);
    expect(S.canSend(s)).toBe(true);
    expect(s.selection).not.toEqual(['s1', 's2', 's3']); // never shown solved
    const first = s.selection[0]!;
    expect(S.move(s, 0, -5).selection[0]).toBe(first);
    const moved = S.move(s, 0, 99);
    expect(moved.selection.at(-1)).toBe(first);
    expect(S.move(s, 7, 0)).toBe(s);
    expect(S.toggle(s, 's1')).toBe(s);
    s = answer(s, ['s1', 's2', 's3']);
    expect(s.transcript.at(-2)).toMatchObject({ kind: 'answer', ordered: true, texts: [k('s1.t'), k('s2.t'), k('s3.t')] });
    expect(s.last!.grade).toBe('best');
  });

  it('the whiteboard holds the context so far, and the proposal only while it is judged', () => {
    let s = S.openScreen(B);
    expect(S.whiteboard(s)).toEqual({ notes: [], proposal: [] });
    s = S.next(answer(s, ['a', 'b']));
    expect(S.whiteboard(s).notes).toEqual([k('trade.ctx')]);
    s = answer(s, ['x']);
    expect(S.whiteboard(s).notes).toEqual([k('trade.ctx')]); // the next round's context waits for its prompt
    s = S.next(s);
    expect(S.whiteboard(s)).toEqual({ notes: [k('trade.ctx')], proposal: [k('flaw.p1'), k('flaw.p2')] });
    s = answer(s, ['f']);
    expect(S.whiteboard(s).proposal).toEqual([]);
    expect(S.boardText('"Per key: 100 a minute."')).toBe('Per key: 100 a minute.');
    expect(S.boardText('„Per sleutel."')).toBe('Per sleutel.');
  });

  it('a perfect play wins, with the outro and a debrief row per round', () => {
    let s = S.openScreen(B, { seed: 3 });
    for (const r of SPEC.rounds) {
      s = answer(s, perfectAnswer(r));
      s = S.next(s);
    }
    expect(s.phase).toBe('end');
    expect(s.state.status).toBe('won');
    expect(s.view).toBeNull();
    expect(s.transcript.at(-1)).toEqual({ kind: 'narration', text: k('won.1') });
    expect(s.debrief.map((d) => d.round)).toEqual(SPEC.rounds.map((r) => r.id));
    expect(s.debrief.every((d) => d.grade === 'best')).toBe(true);
    expect(s.debrief[1]!.question).toBe(k('trade.q'));
    expect(s.debrief[4]!.explanations).toContain(k('calc.working'));
    expect(S.next(s)).toBe(s);
  });

  it('a loss ends early when confidence runs out; retry starts fresh with hints', () => {
    const spec: BattleSpec = { ...SPEC, meters: { confidence: 30 } };
    const b = compileBattle('fixture', spec);
    let s = S.openScreen(b);
    s = answer(s, ['c', 'd']); // q = 0.25: costs 15
    s = S.next(s);
    s = answer(s, ['y']); // costs 20: confidence 0
    expect(S.finished(s)).toBe(true);
    expect(s.state.status).toBe('lost');
    s = S.next(s);
    expect(s.phase).toBe('end');
    expect(s.transcript.at(-1)).toEqual({ kind: 'narration', text: k('lost.1') });
    expect(s.debrief).toHaveLength(2);
    const again = S.retry(s);
    expect(again.phase).toBe('answer');
    expect(again.state.attempt).toBe(1);
    expect(again.state.confidence).toBe(30);
    expect(again.debrief).toEqual([]);
    expect(again.transcript[0]).toEqual({ kind: 'announce', text: k('intro.1') });
    expect(again.view!.hints).toEqual(['hint.ask']);
  });

  it('labels follow the kind, and confidence turns low at half', () => {
    expect(S.PRESSURE_KEY.design).toBe('ui.battle.pressure.design');
    expect(S.KIND_KEY.incident).toBe('ui.battle.kind.incident');
    expect(S.GRADE_MARK).toEqual({ best: '✓', fair: '½', weak: '✗' });
    expect(S.confidenceTone(51, 100)).toBe('ok');
    expect(S.confidenceTone(50, 100)).toBe('low');
    expect(S.confidenceTone(40, 60)).toBe('ok');
  });
});

describe('every battle in content, played through the screen', () => {
  const battles = content().quests.filter((q) => q.battle);

  it('there are battles to play', () => {
    expect(battles.length).toBeGreaterThanOrEqual(3);
  });

  for (const q of battles) {
    it(`${q.id}: perfect wins, worst loses, every card has text`, () => {
      const b = compileBattle(q.id, q.battle!);
      const { locales } = content();
      for (const pick of [perfectAnswer, worstAnswer]) {
        let s = S.openScreen(b, { seed: 11 });
        while (s.phase !== 'end') {
          const v = s.view!;
          for (const id of v.cards) expect(locales.en[`quest.${q.id}.${S.cardText(v.round, id)}`]).toBeTruthy();
          expect(locales.en[S.instructionOf(v).key]).toBeTruthy();
          s = S.next(answer(s, pick(v.round)));
        }
        expect(s.state.status).toBe(pick === perfectAnswer ? 'won' : 'lost');
        for (const e of s.transcript) {
          const keys = 'text' in e ? [e.text] : 'texts' in e ? e.texts : e.explanations;
          for (const key of keys) expect(locales.en[key], key).toBeTruthy();
        }
      }
    });
  }
});

describe('a gate into a town without a map', () => {
  const maps = [{ id: 'junior-village' }, { id: 'server-room' }];
  it('names the town while no map belongs to it', () => {
    expect(townNotBuilt({ kind: 'gate', town: 'medior' }, maps)).toBe('medior');
    expect(townNotBuilt({ kind: 'gate', town: 'medior' }, [...maps, { id: 'medior-city' }])).toBeNull();
    expect(townNotBuilt({ kind: 'gate', town: 'junior' }, maps)).toBeNull();
    expect(townNotBuilt({ kind: 'npc' }, maps)).toBeNull();
    expect(townNotBuilt(undefined, maps)).toBeNull();
  });
  it('holds for the shipped content: Medior City opens later', () => {
    const gate = content().quests.find((q) => q.battle?.trigger.kind === 'gate')!;
    expect(townNotBuilt(gate.battle!.trigger, content().maps)).toBe('medior');
  });
});
