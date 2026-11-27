// The GameApi implementation: the store for state, the HUD for dialogue and toasts, and the
// screens (trail, shop, credits) as Phaser scenes launched over the world. installGameApi is
// called once from main.ts, before the scenes boot.

import Phaser from 'phaser';
import { questKey } from '../../content/types';
import type { LocaleId } from '../../content/types';
import type { HustleResult, QuestRefusal, Reward } from '../../core/game';
import type { Params } from '../../core/i18n';
import type { GameState } from '../../core/save';
import type { HintOffer } from '../../core/tokens';
import { type Conversation, findNpc } from '../../core/talk';
import type { FiredEvent } from '../../sim/session';
import { type DialogueLine, type GameApi, setGameApi } from '../api';
import type { GameStore } from '../store';
import { CreditsScene } from './CreditsScene';
import { pagesOf } from './DialogueBox';
import { HudScene } from './HudScene';
import { ShopScene } from './ShopScene';
import { TrailScene } from './TrailScene';

/** The UI scenes, in drawing order. They go after the world scenes in the game config. */
export const UI_SCENES = [HudScene, TrailScene, ShopScene, CreditsScene];

export class GameUi implements GameApi {
  private busy = 0;

  constructor(
    private readonly game: Phaser.Game,
    readonly store: GameStore,
  ) {}

  readonly t = (key: string, params?: Params): string => this.store.t(key, params);

  isBusy(): boolean {
    return this.busy > 0;
  }

  /**
   * Mark the UI busy until the returned function is called (once). The release lands after the
   * next game step, so a world that polls JustDown(Enter) never sees the Enter that closed a
   * dialogue or screen as a fresh press.
   */
  hold(): () => void {
    this.busy++;
    if (this.busy === 1) this.game.events.emit('nines-ui', true);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.game.events.once(Phaser.Core.Events.POST_STEP, () => {
        this.busy--;
        if (this.busy === 0) this.game.events.emit('nines-ui', false);
      });
    };
  }

  /** The HUD, once it has been created (the world may ask for dialogue during its own create). */
  private hud(): Promise<HudScene> {
    const hud = this.game.scene.getScene('hud') as HudScene | null;
    if (hud?.dialogue) return Promise.resolve(hud);
    return new Promise((resolve) => {
      const wait = () => {
        const h = this.game.scene.getScene('hud') as HudScene | null;
        if (h?.dialogue) return resolve(h);
        this.game.events.once(Phaser.Core.Events.POST_STEP, wait);
      };
      wait();
    });
  }

  async showDialogue(lines: readonly DialogueLine[]): Promise<void> {
    if (lines.length === 0) return;
    const release = this.hold();
    try {
      const hud = await this.hud();
      await hud.showPages(pagesOf(lines.map((l) => ({ speaker: l.speaker ? this.t(l.speaker) : null, text: this.t(l.text, l.params) }))));
    } finally {
      release();
    }
  }

  async talk(npcId: string): Promise<Conversation | null> {
    const c = this.store.conversation(npcId);
    if (!c) return null;
    await this.showDialogue(c.lines.map((text) => ({ speaker: c.speaker, text })));
    if (c.offer && this.startQuest(c.offer) === 'started') (await this.hud()).toast(this.t('ui.toast.quest', { title: this.t(questKey(c.offer, 'title')) }));
    return c;
  }

  private open = new Map<string, Promise<void>>();

  private openScreen(key: string): Promise<void> {
    const pending = this.open.get(key);
    if (pending) return pending;
    const mgr = this.game.scene;
    const release = this.hold();
    const p = new Promise<void>((resolve) => {
      mgr.run(key, {
        done: () => {
          this.open.delete(key);
          release();
          resolve();
        },
      });
      mgr.bringToTop(key);
    });
    this.open.set(key, p);
    return p;
  }

  openShop(): Promise<void> {
    return this.openScreen('shop');
  }

  openTrail(): Promise<void> {
    return this.openScreen('trail');
  }

  openCredits(): Promise<void> {
    return this.openScreen('credits');
  }

  toast(key: string, params?: Params): void {
    void this.hud().then((h) => h.toast(this.t(key, params)));
  }

  startQuest(id: string): 'started' | 'active' | QuestRefusal {
    const before = this.store.questState(id);
    const r = this.store.startQuest(id);
    if (!r.ok) return r.reason;
    return before === 'active' ? 'active' : 'started';
  }

  async showQuestDone(reward: Reward): Promise<void> {
    const entry = this.store.content.quests.find((q) => q.id === reward.quest);
    if (!entry) return;
    const npc = findNpc(this.store.content, entry.quest.giver);
    const speaker = npc ? npc.key(npc.spec.name) : undefined;
    await this.showDialogue(entry.quest.dialogue.done.map((k) => ({ text: questKey(entry.id, k), ...(speaker ? { speaker } : {}) })));
  }

  completeQuest(id: string): Reward | null {
    const r = this.store.completeQuest(id);
    return r.ok ? r.reward : null;
  }

  recordBattle(id: string, outcome: 'won' | 'lost'): Reward | null {
    const r = this.store.recordBattle(id, outcome);
    return r.ok ? r.reward : null;
  }

  applyTerminalEvents(questId: string, events: readonly FiredEvent[]): { money: number; karma: number; agency: { fine: number } | null } {
    return this.store.applyEvents(questId, events);
  }

  finishHustle(questId: string, risk: number): HustleResult {
    return this.store.finishHustle(questId, risk);
  }

  setContractor(on: boolean): void {
    this.store.setContractor(on);
  }

  hintBoost(): number {
    return this.store.hintBoost();
  }

  hintOffer(questId: string, key: string): HintOffer {
    return this.store.hintOffer(questId, key);
  }

  askHint(questId: string, key: string): boolean {
    return this.store.takeHint(questId, key);
  }

  enterMap(player: GameState['player']): string | null {
    return this.store.enterMap(player);
  }

  setLocale(locale: LocaleId): void {
    this.store.setLocale(locale);
    if (typeof document !== 'undefined') document.documentElement.lang = locale;
  }
}

/** Create the API, make it reachable from every scene, and tell the player about a save problem. */
export function installGameApi(game: Phaser.Game, store: GameStore): GameUi {
  const ui = new GameUi(game, store);
  setGameApi(game, ui);
  if (typeof document !== 'undefined') document.documentElement.lang = store.game.locale;
  if (store.slot.status === 'recovered') void ui.showDialogue([{ text: 'ui.save_corrupt' }]);
  if (store.slot.status === 'newer') void ui.showDialogue([{ text: 'ui.save_newer' }]);
  return ui;
}
