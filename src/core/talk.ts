// What an NPC says when the player talks to them, decided from the save. Pure.
//
// Quests come first: a quest this NPC gives that is active repeats its "active" lines; one
// that is available makes its offer. Otherwise the NPC's own dialogue speaks: the first entry
// whose progress condition holds (an entry without `when` always holds). An entry marked
// `intro: true` is also said before a quest's offer when it holds: how a mentor greets you
// differently on their own path than on another.
// A battle quest started by talking (trigger npc or gate) also names the battle to open.

import { type ContentBundle, type NpcSpec, npcKey, questKey } from '../content/types';
import { compile, test } from '../rules/expr';
import { PROGRESS_FACTS } from '../rules/registries';
import { stateOf } from './game';
import { progressEnv } from './progress';
import type { GameState } from './save';

export type TalkContent = Pick<ContentBundle, 'quests' | 'npcs'>;

/** An NPC and how to turn its own locale keys into bundle keys. */
export function findNpc(content: TalkContent, id: string): { spec: NpcSpec; key: (k: string) => string } | null {
  const world = content.npcs.find((n) => n.id === id);
  if (world) return { spec: world, key: (k) => npcKey(id, k) };
  const q = content.quests.find((x) => x.npc?.id === id);
  if (q?.npc) return { spec: q.npc, key: (k) => questKey(q.id, k) };
  return null;
}

export interface Conversation {
  /** locale key of the speaker's name */
  speaker: string;
  /** locale keys, in order */
  lines: string[];
  /** a quest this conversation offers: the game accepts it once the lines are read */
  offer?: string;
  /** a battle quest that starts when the lines are read */
  battle?: string;
}

export function conversation(game: GameState, content: TalkContent, npcId: string): Conversation | null {
  const npc = findNpc(content, npcId);
  if (!npc) return null;
  const speaker = npc.key(npc.spec.name);
  const given = content.quests.filter((q) => q.quest.giver === npcId);
  // A pager battle reaches the player by itself; talking to its giver never starts it.
  const talkable = given.filter((q) => q.battle?.trigger.kind !== 'pager');
  const battleOf = (id: string) => (talkable.find((q) => q.id === id)?.battle ? { battle: id } : {});
  const active = talkable.find((q) => stateOf(game, content, q.id) === 'active');
  if (active) return { speaker, lines: active.quest.dialogue.active.map((k) => questKey(active.id, k)), ...battleOf(active.id) };
  const env = progressEnv(game, content.quests.map((q) => q.quest));
  const holds = (d: { when?: string }) => d.when === undefined || test(compile(d.when, PROGRESS_FACTS), env);
  const offer = talkable.find((q) => stateOf(game, content, q.id) === 'available');
  if (offer) {
    // the first `intro` entry that holds is said before the offer (a mentor greeting their mentee)
    const intro = npc.spec.dialogue.find((d) => d.intro === true && holds(d));
    const lines = [...(intro?.lines ?? []).map(npc.key), ...offer.quest.dialogue.offer.map((k) => questKey(offer.id, k))];
    return { speaker, lines, offer: offer.id, ...battleOf(offer.id) };
  }
  const entry = npc.spec.dialogue.find(holds);
  return { speaker, lines: (entry?.lines ?? []).map(npc.key) };
}
