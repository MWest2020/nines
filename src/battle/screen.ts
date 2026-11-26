// What the battle screen shows and how the player's input changes it, without the DOM. The
// overlay (src/game/battle/BattleOverlay.ts) renders a Screen and turns clicks and keys into
// the calls below; every rule about what may be picked, when Send works, what goes into the
// transcript and what the debrief holds lives here, so it is tested in Node.
//
// A Screen moves through three phases:
//   answer  a round is on screen; the player picks cards (or orders them) and sends
//   review  the answer, its mark and the explanations are in the transcript; Continue goes on
//   end     the battle is won or lost; the debrief lists every round; Try again starts over
//
// Text is never stored here, only locale keys: the screen is translated when it is drawn, so
// the NL/EN toggle reaches a battle that is already open.

import { type BattleRound, type BattleKind, type Grade, questKey } from '../content/types';
import { answerRound, type BattleState, type CompiledBattle, presentRound, retryBattle, type RoundResult, type RoundView, startBattle } from './engine';

/** One entry in the chat transcript. Keys are full locale keys. */
export type Entry =
  /** how the battle reached the player: the first intro line (PAGER 03:07 · ..., Incoming: ...) */
  | { kind: 'announce'; text: string }
  /** the rest of the intro and the outro: narration, no speaker */
  | { kind: 'narration'; text: string }
  /** the attacker speaks; `round` is the round the line belongs to */
  | { kind: 'attacker'; text: string; round: string }
  /** the player's answer: the cards sent, in order (numbered for an order round) */
  | { kind: 'answer'; round: string; texts: string[]; ordered: boolean }
  /** under the answer: the mark, the meter changes and the explanations */
  | { kind: 'note'; round: string; grade: Grade; confidence: number; pressure: number; explanations: string[] };

export type Phase = 'answer' | 'review' | 'end';

export interface DebriefRow {
  round: string;
  /** the question (the round's last prompt line) */
  question: string;
  /** the answer the player sent, as card text keys */
  answer: string[];
  ordered: boolean;
  grade: Grade;
  explanations: string[];
}

export interface Screen {
  readonly battle: CompiledBattle;
  readonly quest: string;
  readonly state: BattleState;
  readonly phase: Phase;
  /** the round on screen (answer phase) or just answered (review phase); null at the end */
  readonly view: RoundView | null;
  /** picked card ids; for an order round, every card in the player's current order */
  readonly selection: readonly string[];
  readonly transcript: readonly Entry[];
  readonly debrief: readonly DebriefRow[];
  /** the last answer's result (review and end phases) */
  readonly last: RoundResult | null;
}

/** Locale keys for the header and the meters, per kind (DESIGN.md, Battles: Meters). */
export const KIND_KEY: Readonly<Record<BattleKind, string>> = {
  design: 'ui.battle.kind.design',
  incident: 'ui.battle.kind.incident',
  stakeholder: 'ui.battle.kind.stakeholder',
};
export const PRESSURE_KEY: Readonly<Record<BattleKind, string>> = {
  design: 'ui.battle.pressure.design',
  incident: 'ui.battle.pressure.incident',
  stakeholder: 'ui.battle.pressure.stakeholder',
};
export const GRADE_KEY: Readonly<Record<Grade, string>> = {
  best: 'ui.battle.grade.best',
  fair: 'ui.battle.grade.fair',
  weak: 'ui.battle.grade.weak',
};
/** The mark next to a grade's word: meaning never by colour alone. */
export const GRADE_MARK: Readonly<Record<Grade, string>> = { best: '✓', fair: '½', weak: '✗' };

/** How the cards of a round are answered. */
export type Interaction = 'one' | 'many' | 'order';

export function interactionOf(round: BattleRound): Interaction {
  if (round.type === 'order') return 'order';
  return round.type === 'clarify' && (round.pick ?? 1) > 1 ? 'many' : 'one';
}

/** The instruction over the cards: a locale key and its parameters. */
export function instructionOf(view: RoundView): { key: string; params?: Record<string, number> } {
  const r = view.round;
  if (r.type === 'order') return { key: 'ui.battle.order' };
  if (r.type === 'clarify') return view.pick > 1 ? { key: 'ui.battle.pick', params: { n: view.pick } } : { key: 'ui.battle.pick_one' };
  if (r.type === 'flaw') return { key: 'ui.battle.pick_flaw' };
  if (r.type === 'estimate') return { key: 'ui.battle.pick_range' };
  return { key: 'ui.battle.pick_one' };
}

/** The locale key of a card's text. */
export function cardText(round: BattleRound, id: string): string {
  const card = round.type === 'order' ? round.items.find((i) => i.id === id) : round.options.find((o) => o.id === id);
  return card ? card.text : id;
}

const promptEntries = (quest: string, view: RoundView | null): Entry[] =>
  view ? view.round.prompt.map((p) => ({ kind: 'attacker' as const, text: questKey(quest, p), round: view.round.id })) : [];

/** Selection a round starts with: nothing picked, or the cards in display order for an order round. */
const freshSelection = (view: RoundView | null): string[] => (view && view.round.type === 'order' ? [...view.cards] : []);

function begin(b: CompiledBattle, quest: string, state: BattleState): Screen {
  const view = presentRound(b, state);
  const [first, ...rest] = b.spec.intro;
  const transcript: Entry[] = [
    ...(first !== undefined ? [{ kind: 'announce' as const, text: questKey(quest, first) }] : []),
    ...rest.map((k) => ({ kind: 'narration' as const, text: questKey(quest, k) })),
    ...promptEntries(quest, view),
  ];
  return { battle: b, quest, state, phase: 'answer', view, selection: freshSelection(view), transcript, debrief: [], last: null };
}

/** Open the screen on a fresh battle. `quest` is the quest id whose locale keys the battle uses. */
export function openScreen(b: CompiledBattle, opts: { seed?: number; hintBoost?: number } = {}): Screen {
  return begin(b, b.id, startBattle(b, opts));
}

/**
 * Pick or unpick a card. Pick-one rounds replace the pick. A pick-many round never holds more
 * than it allows: a further pick is refused (the screen is returned unchanged) until one is
 * unpicked. Order rounds ignore this (use move).
 */
export function toggle(s: Screen, id: string): Screen {
  if (s.phase !== 'answer' || !s.view || !s.view.cards.includes(id)) return s;
  const mode = interactionOf(s.view.round);
  if (mode === 'order') return s;
  if (mode === 'one') return { ...s, selection: s.selection[0] === id ? [] : [id] };
  if (s.selection.includes(id)) return { ...s, selection: s.selection.filter((x) => x !== id) };
  if (s.selection.length >= s.view.pick) return s;
  return { ...s, selection: [...s.selection, id] };
}

/** Is the pick-many round full, so the other cards cannot be picked now? */
export const full = (s: Screen): boolean => !!s.view && interactionOf(s.view.round) === 'many' && s.selection.length >= s.view.pick;

/** Move a card in an order round from one position to another (clamped to the list). */
export function move(s: Screen, from: number, to: number): Screen {
  if (s.phase !== 'answer' || !s.view || s.view.round.type !== 'order') return s;
  const n = s.selection.length;
  if (from < 0 || from >= n) return s;
  const dest = Math.max(0, Math.min(n - 1, to));
  if (dest === from) return s;
  const next = [...s.selection];
  const [card] = next.splice(from, 1);
  next.splice(dest, 0, card!);
  return { ...s, selection: next };
}

export const canSend = (s: Screen): boolean => s.phase === 'answer' && !!s.view && s.selection.length === s.view.pick;

/** Send the selection: the answer and its note join the transcript; the phase becomes review. */
export function send(s: Screen): Screen {
  if (!canSend(s) || !s.view) return s;
  const round = s.view.round;
  const { state, result } = answerRound(s.battle, s.state, s.selection);
  const ordered = round.type === 'order';
  const texts = s.selection.map((id) => questKey(s.quest, cardText(round, id)));
  const explanations = result.explanations.map((k) => questKey(s.quest, k));
  const question = round.prompt[round.prompt.length - 1]!;
  return {
    ...s,
    state,
    phase: 'review',
    last: result,
    transcript: [
      ...s.transcript,
      { kind: 'answer', round: round.id, texts, ordered },
      { kind: 'note', round: round.id, grade: result.grade, confidence: result.confidence, pressure: result.pressure, explanations },
    ],
    debrief: [...s.debrief, { round: round.id, question: questKey(s.quest, question), answer: texts, ordered, grade: result.grade, explanations }],
  };
}

/** The battle is over (after the answer that ended it is sent). */
export const finished = (s: Screen): boolean => s.state.status !== 'active';

/** From review: the next round's prompt, or the end with the outro. */
export function next(s: Screen): Screen {
  if (s.phase !== 'review') return s;
  if (finished(s)) {
    const outro = s.state.status === 'won' ? s.battle.spec.outro.won : s.battle.spec.outro.lost;
    return {
      ...s,
      phase: 'end',
      view: null,
      selection: [],
      transcript: [...s.transcript, ...outro.map((k) => ({ kind: 'narration' as const, text: questKey(s.quest, k) }))],
    };
  }
  const view = presentRound(s.battle, s.state);
  return { ...s, phase: 'answer', view, selection: freshSelection(view), transcript: [...s.transcript, ...promptEntries(s.quest, view)] };
}

/** A fresh try from any phase: meters refilled, a new card order, hints for the next attempt. */
export function retry(s: Screen): Screen {
  return begin(s.battle, s.quest, retryBattle(s.battle, s.state));
}

/**
 * The whiteboard of a design interview (DESIGN.md, Battles: Layout): the requirements so far,
 * which are the context lines the interviewer has given (every prompt line before a round's
 * question, from the rounds reached so far), and in a "spot the flaw" round the proposal being
 * judged. Notes are locale keys; boardText drops the speech marks from the translated text.
 */
export function whiteboard(s: Screen): { notes: string[]; proposal: string[] } {
  const reached = s.debrief.length + (s.phase === 'answer' ? 1 : 0);
  const notes = s.battle.spec.rounds
    .slice(0, reached)
    .flatMap((r) => r.prompt.slice(0, -1))
    .map((k) => questKey(s.quest, k));
  const round = s.view?.round;
  const proposal = s.phase === 'answer' && round?.type === 'flaw' ? round.proposal.map((k) => questKey(s.quest, k)) : [];
  return { notes, proposal };
}

/** Drop the speech marks around a whiteboard note (it is written up, not said). */
export const boardText = (text: string): string => text.replace(/^\s*["“„]/, '').replace(/["”]\s*$/, '');

/** Meter tone (DESIGN.md, Battles: Colours): Confidence is "ok" above half its maximum. */
export const confidenceTone = (value: number, max: number): 'ok' | 'low' => (value * 2 > max ? 'ok' : 'low');
