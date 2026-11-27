// Opening a battle from the world: compile it, hold the UI while the overlay is open, record
// each finished try (a win pays once, a loss costs nothing), and after the overlay closes let
// the quest giver say their "done" lines. A gate battle into a town that has no map yet says on
// its end screen that the town opens later. Tries are counted per battle while the game runs,
// so a battle closed after a loss and opened again shows its hints and a new card order. The bridge (src/game/bridge.ts) calls this for an NPC talk, a
// battle object and the pager.

import type Phaser from 'phaser';
import { compileBattle } from '../../battle/engine';
import { attemptsAfter, openScreen } from '../../battle/screen';
import { townNotBuilt } from '../../battle/triggers';
import { type QuestEntry, questKey } from '../../content/types';
import type { Reward } from '../../core/game';
import { findNpc } from '../../core/talk';
import type { GameApi } from '../api';
import { allNpcs, standFrame } from '../world/sprites';
import { runBattle } from './BattleOverlay';

let open = false;
/** Tries per battle while the game runs (not saved, like battle sessions): hints grow with them. */
const attempts = new Map<string, number>();

/** Is a battle overlay open now? */
export const battleOpen = (): boolean => open;

/**
 * A head-only portrait of the NPC from its sheet's standing-down frame: the top of the frame,
 * scaled up crisply into a small canvas. Never a full figure (DESIGN.md, Battles: Layout).
 */
function portraitOf(game: Phaser.Game, api: GameApi, npcId: string | undefined): () => HTMLCanvasElement | null {
  const entry = npcId ? allNpcs(api.store.content).find((n) => n.npc.id === npcId) : undefined;
  return () => {
    if (!entry || !game.textures.exists(entry.textureKey)) return null;
    const frame = game.textures.getFrame(entry.textureKey, standFrame('down'));
    if (!frame) return null;
    const src = frame.source.image as CanvasImageSource;
    // the head: the top 9/16 of the frame, the middle 12/16 of its width
    const w = Math.round((frame.cutWidth * 12) / 16);
    const h = Math.round((frame.cutHeight * 9) / 16);
    const x = frame.cutX + Math.round((frame.cutWidth - w) / 2);
    const c = document.createElement('canvas');
    c.width = w * 4;
    c.height = h * 4;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, x, frame.cutY, w, h, 0, 0, c.width, c.height);
    return c;
  };
}

/** The lines under the verdict: what a win paid, or that it was won before. */
function rewardLines(api: GameApi, reward: Reward | null): string[] {
  const { t, store } = api;
  if (!reward) return [t('ui.battle.no_reward')];
  const branch = store.content.roadmap.branches.find((b) => b.id === reward.branch);
  const lines = [t('ui.toast.reward', { money: reward.money, xp: reward.xp, branch: branch ? t(branch.title) : reward.branch })];
  if (reward.income > 0) lines.push(t('ui.toast.income', { amount: reward.income }));
  return lines;
}

/** The town a gate battle opens, when that town has no map yet: the "opens later" line's params. */
export function gateLater(api: GameApi, entry: QuestEntry): { town: string } | null {
  const town = townNotBuilt(entry.battle?.trigger, api.store.content.maps);
  if (!town) return null;
  const spec = api.store.content.roadmap.towns.find((x) => x.id === town);
  return { town: spec ? api.t(spec.title) : town };
}

/** Open the battle of a quest and resolve when it is closed and the giver has had their say. */
export async function openBattle(game: Phaser.Game, api: GameApi, questId: string): Promise<void> {
  const entry = api.store.content.quests.find((q) => q.id === questId);
  if (!entry?.battle || open) return;
  open = true;
  const release = api.hold();
  const result: { paid: Reward | null } = { paid: null };
  const later = gateLater(api, entry);
  try {
    const battle = compileBattle(entry.id, entry.battle);
    const npc = findNpc(api.store.content, entry.quest.giver);
    const attacker = api.t(questKey(entry.id, entry.battle.attacker));
    const last = await runBattle({
      t: api.t,
      screen: openScreen(battle, { seed: api.store.game.seed, hintBoost: api.hintBoost(), attempt: attempts.get(entry.id) ?? 0 }),
      attacker,
      speaker: npc ? api.t(npc.key(npc.spec.name)) : attacker,
      portrait: portraitOf(game, api, npc?.spec.id),
      record: (outcome) => {
        const reward = api.recordBattle(entry.id, outcome);
        if (outcome === 'lost') return [];
        result.paid ??= reward;
        return [...rewardLines(api, reward), ...(later ? [api.t('ui.battle.gate_later', later)] : [])];
      },
    });
    attempts.set(entry.id, attemptsAfter(last));
  } finally {
    open = false;
    release();
  }
  // the end screen already said that a gate's town opens later
  if (result.paid) await api.showQuestDone(result.paid);
}
