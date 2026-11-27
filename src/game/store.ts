// The one live game: the current GameState, the save slot and the translator, with the pure
// rules of src/core/game.ts behind every change. No Phaser here, so it is tested in Node; the
// scenes subscribe to it and redraw. Saves follow ARCHITECTURE.md (Saves, When): after a quest
// completes, after a purchase, on a locale change and when entering a map, plus after a
// terminal event that changed money (so a reload never undoes a penalty) and on request.

import { pagerFires } from '../battle/triggers';
import type { ContentBundle, LocaleId } from '../content/types';
import * as rules from '../core/game';
import { createTranslator, type Translate } from '../core/i18n';
import type { SaveSlot } from '../core/persist';
import { progressEnv } from '../core/progress';
import type { GameState } from '../core/save';
import * as karma from '../core/karma';
import * as tokens from '../core/tokens';
import { applyChoice, type ChoiceResult } from '../core/choice';
import { type Conversation, conversation, type TalkChoice } from '../core/talk';
import type { FiredEvent } from '../sim/session';

export type Change =
  | { kind: 'reward'; reward: rules.Reward }
  | { kind: 'money'; delta: number }
  | { kind: 'purchase'; item: string; price: number }
  | { kind: 'hint'; quest: string; charged: number }
  | { kind: 'caught'; quest: string; fine: number; arrested: boolean }
  | { kind: 'contractor'; on: boolean }
  | { kind: 'path'; path: string; fee: number }
  | { kind: 'quest'; id: string }
  | { kind: 'locale'; locale: LocaleId }
  | { kind: 'other' };

export type Listener = (game: GameState, change: Change) => void;

export class GameStore {
  private state: GameState;
  private translate: Translate;
  private listeners = new Set<Listener>();

  constructor(
    readonly content: ContentBundle,
    game: GameState,
    readonly slot: SaveSlot,
  ) {
    // a path the roadmap does not have (a hand-edited save, a renamed path) is no choice at all
    this.state = game.path !== null && !content.roadmap.paths.some((p) => p.id === game.path) ? { ...game, path: null } : game;
    // on probation, community service must be open: a repaired or hand-edited save could hold
    // probation with the service already done, which would shut clearance work for good
    if (this.state.probation) this.state = karma.reopenService(this.state, content);
    this.translate = createTranslator(content.locales, game.locale);
  }

  get game(): GameState {
    return this.state;
  }

  /** Translate a locale key in the player's language. */
  readonly t: Translate = (key, params) => this.translate(key, params);

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private commit(next: GameState, change: Change, persist: boolean): void {
    if (next === this.state) return;
    this.state = next;
    if (persist) this.save();
    for (const fn of [...this.listeners]) fn(next, change);
  }

  /** Write the save now. False when nothing was written (a newer save exists, or storage failed). */
  save(): boolean {
    return this.slot.save(this.state);
  }

  // ---- quests and battles

  startQuest(id: string): ReturnType<typeof rules.startQuest> {
    const r = rules.startQuest(this.state, this.content, id);
    this.commit(r.game, { kind: 'quest', id }, true);
    return r;
  }

  completeQuest(id: string): rules.CompleteResult {
    const r = rules.completeQuest(this.state, this.content, id);
    if (r.ok) this.commit(r.game, { kind: 'reward', reward: r.reward }, true);
    return r;
  }

  recordBattle(id: string, outcome: 'won' | 'lost'): ReturnType<typeof rules.recordBattle> {
    const r = rules.recordBattle(this.state, this.content, id, outcome);
    this.commit(r.game, r.ok ? { kind: 'reward', reward: r.reward } : { kind: 'quest', id }, true);
    return r;
  }

  /** Apply what a terminal step fired (RunResult.events): the total money and karma change, and
   *  the agency's fine when a karma drop brought it. */
  applyEvents(questId: string, events: readonly FiredEvent[]): { money: number; karma: number; agency: { fine: number } | null } {
    let game = this.state;
    let total = 0;
    let karmaTotal = 0;
    let agency: { fine: number } | null = null;
    for (const ev of events) {
      const r = rules.applyEvent(game, this.content, questId, { id: ev.id, money: ev.money, karma: ev.karma, ...(ev.setFlag ? { setFlag: ev.setFlag } : {}) });
      game = r.game;
      total += r.money;
      karmaTotal += r.karma;
      agency ??= r.agency;
    }
    this.commit(game, total !== 0 ? { kind: 'money', delta: total } : { kind: 'other' }, true);
    return { money: total, karma: karmaTotal, agency };
  }

  // ---- hustles and the contractor (core/karma.ts)

  /** Finish a hustle: roll its risk, then pay or fine (saved at once either way). */
  finishHustle(id: string, risk: number, cover: rules.HustleCover = {}): rules.HustleResult {
    const r = rules.finishHustle(this.state, this.content, id, risk, cover);
    if (r.ok) {
      const change: Change = r.outcome === 'clean' ? { kind: 'reward', reward: r.reward } : { kind: 'caught', quest: id, fine: r.fine, arrested: r.arrested !== null };
      this.commit(r.game, change, true);
    }
    return r;
  }

  /** A dialogue choice was made: its karma and flag (core/choice.ts), saved at once. */
  choose(choice: Pick<TalkChoice, 'text' | 'karma' | 'setFlag'>): ChoiceResult {
    const r = applyChoice(this.state, this.content, choice);
    this.commit(r.game, { kind: 'other' }, true);
    return r;
  }

  /** Work as an independent contractor, or as an employee again. */
  setContractor(on: boolean): void {
    this.commit(karma.setContractor(this.state, on), { kind: 'contractor', on }, true);
  }

  /** hintBoost for createSession and startBattle: what the owned homelab gear adds. */
  hintBoost(): number {
    return rules.hintBoost(this.state, this.content);
  }

  // ---- AI tokens (core/tokens.ts)

  /** What asking the AI for this hint would cost now. */
  hintOffer(questId: string, key: string): tokens.HintOffer {
    return tokens.hintOffer(this.state, this.content, questId, key);
  }

  /** Pay for a hint (saved at once: a reload never refunds it). False when refused. */
  takeHint(questId: string, key: string): boolean {
    const r = tokens.takeHint(this.state, this.content, questId, key);
    if (r.ok && r.charged > 0) this.commit(r.game, { kind: 'hint', quest: questId, charged: r.charged }, true);
    return r.ok;
  }

  currentQuest(): string | null {
    return rules.currentQuest(this.state, this.content);
  }

  questState(id: string): ReturnType<typeof rules.stateOf> {
    return rules.stateOf(this.state, this.content, id);
  }

  conversation(npcId: string): Conversation | null {
    return conversation(this.state, this.content, npcId);
  }

  // ---- career paths (DESIGN.md, Career paths)

  /** Choose the career path at the coach (saved). False when refused. */
  choosePath(id: string): boolean {
    const r = rules.choosePath(this.state, this.content, id);
    if (r.ok) this.commit(r.game, { kind: 'path', path: id, fee: 0 }, true);
    return r.ok;
  }

  /** Change the career path at the coach, for its fee (saved). False when refused. */
  changePath(id: string): boolean {
    const r = rules.changePath(this.state, this.content, id);
    if (r.ok) this.commit(r.game, { kind: 'path', path: id, fee: r.fee }, true);
    return r.ok;
  }

  // ---- shop

  buy(itemId: string): rules.BuyResult {
    const r = rules.buy(this.state, this.content, itemId);
    if (r.ok) this.commit(r.game, { kind: 'purchase', item: itemId, price: r.price }, true);
    return r;
  }

  canBuy(itemId: string): ReturnType<typeof rules.canBuy> {
    return rules.canBuy(this.state, this.content, itemId);
  }

  // ---- world

  setLocale(locale: LocaleId): void {
    if (locale === this.state.locale) return;
    this.translate = createTranslator(this.content.locales, locale);
    this.commit(rules.setLocale(this.state, locale), { kind: 'locale', locale }, true);
  }

  setFlag(name: string, value = true): void {
    this.commit(rules.setFlag(this.state, name, value), { kind: 'other' }, false);
  }

  /**
   * The player entered a map: store where they are, count a pager tick, save, and return the
   * pager battle that goes off now, if any (the battle overlay opens it).
   */
  enterMap(player: GameState['player']): string | null {
    const next = rules.tick(rules.setPlayer(this.state, player));
    this.commit(next, { kind: 'other' }, true);
    const env = progressEnv(next, this.content.quests.map((q) => q.quest));
    for (const q of this.content.quests) {
      const trigger = q.battle?.trigger;
      if (trigger && pagerFires(q.id, trigger, next.ticks, env, this.questState(q.id), next.seed)) return q.id;
    }
    return null;
  }

  /** Remember where the player stands without saving (saved with the next save). */
  setPlayer(player: GameState['player']): void {
    this.state = rules.setPlayer(this.state, player);
  }

  trail(): rules.TrailView {
    return rules.trail(this.state, this.content);
  }
}
