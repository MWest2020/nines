// The game's rules without rendering: money, XP per Career Trail branch, quest completion,
// homelab purchases, flags and the Career Trail's state. Pure: every function takes a
// GameState and returns a new one (the input is never changed), with no clock, no randomness
// and no DOM. The Phaser layer (src/game) calls these and renders the result.
//
// Economy (ARCHITECTURE.md, The Phaser layer): completing a quest adds its money and XP (to
// its branch) plus `income_per_quest` from owned items; scenario events add or subtract money,
// never below zero; a purchase subtracts the price. A battle won is a quest completed, so it
// pays through the same path. Every reward is paid once: a quest that is done stays done, and
// a positive event pays once per quest and event however often the terminal is replayed.
// Penalties are consequences and cost every time (ARCHITECTURE.md, Consequences).
// Hints cost AI tokens and scale a quest's money and XP down (core/tokens.ts).

import type { BranchId, ContentBundle, LocaleId, QuestEntry, Stage } from '../content/types';
import { own } from '../rules/own';
import { questState } from './progress';
import type { GameState } from './save';
import { addTokens, hintsTaken, rewardPercent, scaled } from './tokens';

/** The parts of the content bundle the rules read. */
export type Rules = Pick<ContentBundle, 'quests' | 'roadmap' | 'shop'>;

const findQuest = (rules: Rules, id: string): QuestEntry | undefined => rules.quests.find((q) => q.id === id);
const specs = (rules: Pick<Rules, 'quests'>) => rules.quests.map((q) => q.quest);

export const stateOf = (game: GameState, rules: Pick<Rules, 'quests'>, id: string) => questState(game, specs(rules), id);

// ---- items

/** The sum of one effect over the items the player owns. */
function effect(game: GameState, rules: Rules, name: 'income_per_quest' | 'hint_boost'): number {
  let sum = 0;
  for (const item of rules.shop.items) if (game.items.includes(item.id)) sum += item.effects[name] ?? 0;
  return sum;
}

/** How much sooner hints unlock (the Pi's local model notices sooner that you are stuck):
 *  passed to createSession and startBattle as hintBoost. Asking still costs a token. */
export const hintBoost = (game: GameState, rules: Rules): number => effect(game, rules, 'hint_boost');
export const incomePerQuest = (game: GameState, rules: Rules): number => effect(game, rules, 'income_per_quest');

export type BuyRefusal = 'unknown' | 'owned' | 'locked' | 'money';

export function canBuy(game: GameState, rules: Rules, itemId: string): { ok: true } | { ok: false; reason: BuyRefusal } {
  const item = rules.shop.items.find((i) => i.id === itemId);
  if (!item) return { ok: false, reason: 'unknown' };
  if (!item.consumable && game.items.includes(item.id)) return { ok: false, reason: 'owned' };
  if (!item.requires.every((r) => game.items.includes(r))) return { ok: false, reason: 'locked' };
  if (game.money < item.price) return { ok: false, reason: 'money' };
  return { ok: true };
}

export type BuyResult = { ok: true; game: GameState; price: number } | { ok: false; game: GameState; reason: BuyRefusal };

export function buy(game: GameState, rules: Rules, itemId: string): BuyResult {
  const check = canBuy(game, rules, itemId);
  if (!check.ok) return { ok: false, game, reason: check.reason };
  const item = rules.shop.items.find((i) => i.id === itemId)!;
  const paid = { ...game, money: game.money - item.price };
  // a consumable (AI credits) is used up at once: its tokens are added, nothing is owned
  if (item.consumable) return { ok: true, price: item.price, game: addTokens(paid, item.effects.tokens ?? 0) };
  return { ok: true, price: item.price, game: { ...paid, items: [...game.items, item.id] } };
}

// ---- quests

export type QuestRefusal = 'unknown' | 'locked' | 'done';

/** Accept a quest: available becomes active. Active stays active. */
export function startQuest(game: GameState, rules: Rules, id: string): { ok: true; game: GameState } | { ok: false; game: GameState; reason: QuestRefusal } {
  if (!findQuest(rules, id)) return { ok: false, game, reason: 'unknown' };
  const state = stateOf(game, rules, id);
  if (state === 'locked' || state === 'done') return { ok: false, game, reason: state };
  if (state === 'active') return { ok: true, game };
  return { ok: true, game: { ...game, quests: { ...game.quests, [id]: 'active' } } };
}

export interface Reward {
  quest: string;
  /** the quest's own money, after hints */
  money: number;
  /** extra money from owned homelab items (never scaled) */
  income: number;
  /** XP, after hints */
  xp: number;
  /** the share paid: 100, less PENALTY_PERCENT per AI hint taken, at least FLOOR_PERCENT */
  percent: number;
  /** AI hints taken on this quest */
  hints: number;
  /** what the quest pays without hints */
  full: { money: number; xp: number };
  branch: BranchId;
  tech_debt: number;
  /** the Career Trail node that lights up */
  node: string;
  /** quests that became available because this one is done */
  unlocked: string[];
}

export type CompleteResult = { ok: true; game: GameState; reward: Reward } | { ok: false; game: GameState; reason: QuestRefusal };

/**
 * Finish a quest and pay its reward. Only once: a done quest returns `reason: 'done'` and the
 * same state. A locked quest cannot be finished (the world never offers it, so that is a bug).
 */
export function completeQuest(game: GameState, rules: Rules, id: string): CompleteResult {
  const entry = findQuest(rules, id);
  if (!entry) return { ok: false, game, reason: 'unknown' };
  const state = stateOf(game, rules, id);
  if (state === 'locked' || state === 'done') return { ok: false, game, reason: state };
  const q = entry.quest;
  const income = incomePerQuest(game, rules);
  const hints = hintsTaken(game, id).length;
  const percent = rewardPercent(hints);
  const money = scaled(q.reward.money, percent);
  const xp = scaled(q.reward.xp, percent);
  const next: GameState = {
    ...game,
    money: game.money + money + income,
    xp: { ...game.xp, [q.branch]: (own(game.xp, q.branch) ?? 0) + xp },
    tech_debt: game.tech_debt + (q.reward.tech_debt ?? 0),
    quests: { ...game.quests, [id]: 'done' },
  };
  const unlocked = rules.quests
    .filter((x) => stateOf(game, rules, x.id) === 'locked' && stateOf(next, rules, x.id) === 'available')
    .map((x) => x.id);
  return {
    ok: true,
    game: next,
    reward: {
      quest: id,
      money,
      income,
      xp,
      percent,
      hints,
      full: { money: q.reward.money, xp: q.reward.xp },
      branch: q.branch,
      tech_debt: q.reward.tech_debt ?? 0,
      node: q.roadmap_node,
      unlocked,
    },
  };
}

/** A battle's end. Won completes its quest (and pays, once); lost keeps it active and costs nothing. */
export function recordBattle(
  game: GameState,
  rules: Rules,
  id: string,
  outcome: 'won' | 'lost',
): CompleteResult | { ok: false; game: GameState; reason: 'lost' } {
  if (outcome === 'won') return completeQuest(game, rules, id);
  const started = startQuest(game, rules, id);
  return started.ok ? { ok: false, game: started.game, reason: 'lost' } : started;
}

/** The quest the HUD shows: the most recently accepted one still active, if any. */
export function currentQuest(game: GameState, rules: Rules): string | null {
  const active = Object.keys(game.quests).filter((id) => game.quests[id] === 'active' && findQuest(rules, id));
  return active.at(-1) ?? null;
}

// ---- scenario events (src/sim/session.ts FiredEvent)

export interface EventOutcome {
  id: string;
  money: number;
  setFlag?: string;
}

/**
 * Apply an event a terminal session fired. A penalty (negative money) costs every time and
 * never takes money below zero; a bonus pays once per quest and event; a flag is set.
 * Returns the money actually changed, for the HUD.
 */
export function applyEvent(game: GameState, questId: string, ev: EventOutcome): { game: GameState; money: number } {
  let next = game;
  let delta = 0;
  if (ev.money < 0) {
    delta = -Math.min(game.money, -ev.money) || 0; // never -0
    next = { ...next, money: game.money + delta };
  } else if (ev.money > 0) {
    const key = `${questId}/${ev.id}`;
    if (!game.claimed.includes(key)) {
      delta = ev.money;
      next = { ...next, money: game.money + delta, claimed: [...game.claimed, key] };
    }
  }
  if (ev.setFlag) next = setFlag(next, ev.setFlag, true);
  return { game: next, money: delta };
}

// ---- small setters

export const setFlag = (game: GameState, name: string, value: boolean): GameState =>
  own(game.flags, name) === value ? game : { ...game, flags: { ...game.flags, [name]: value } };

export const setLocale = (game: GameState, locale: LocaleId): GameState => (game.locale === locale ? game : { ...game, locale });

export const setPlayer = (game: GameState, player: GameState['player']): GameState => ({ ...game, player: { ...player } });

/** Count a pager tick (the world calls this on a map change). */
export const tick = (game: GameState): GameState => ({ ...game, ticks: game.ticks + 1 });

// ---- career paths (DESIGN.md, Career paths)

export type PathRefusal = 'unknown' | 'closed' | 'chosen';

/**
 * Choose a career path. It is chosen at Medior City, so the road there must be open; it is
 * chosen once (switching is a later design question). Choosing the same path again is a no-op.
 */
export function choosePath(game: GameState, rules: Pick<Rules, 'quests' | 'roadmap'>, pathId: string): { ok: true; game: GameState } | { ok: false; game: GameState; reason: PathRefusal } {
  if (!rules.roadmap.paths.some((p) => p.id === pathId)) return { ok: false, game, reason: 'unknown' };
  if (game.path === pathId) return { ok: true, game };
  if (game.path !== null) return { ok: false, game, reason: 'chosen' };
  if (!townOpen(game, rules, 'medior')) return { ok: false, game, reason: 'closed' };
  return { ok: true, game: { ...game, path: pathId } };
}

// ---- the Career Trail

export type NodeState = 'done' | 'open' | 'locked';

/**
 * Has the gate battle into this town been won (or does the town have no gate)? ARCHITECTURE.md,
 * Battles: gate. battle/triggers.ts gateOpen uses this.
 */
export function gateWon(game: GameState, rules: Pick<Rules, 'quests'>, town: string): boolean {
  return rules.quests.every((q) => q.battle?.trigger.kind !== 'gate' || q.battle.trigger.town !== town || stateOf(game, rules, q.id) === 'done');
}

/**
 * Is the road to this town open? The towns lie on one road in roadmap order, so a town is open
 * when its own gate is won and every town before it is open: Senior Summit stays closed while
 * the road to Medior City is.
 */
export function townOpen(game: GameState, rules: Pick<Rules, 'quests' | 'roadmap'>, town: string): boolean {
  const towns = rules.roadmap.towns;
  const at = towns.findIndex((t) => t.id === town);
  if (at < 0) return false;
  return towns.slice(0, at + 1).every((t) => gateWon(game, rules, t.id));
}

const stageOpen = (game: GameState, rules: Rules, stage: Stage): boolean =>
  rules.roadmap.towns.filter((t) => t.stage === stage).every((t) => townOpen(game, rules, t.id));

/**
 * A node is done when a quest that lights it is done. Otherwise it is open when every node it
 * requires is done and the road to its stage's town is open, and locked when not. Branches are
 * the routes of the trail: XP earned on a branch comes from the quests that light its nodes,
 * and each done node opens the next ones on its route.
 */
export function nodeState(game: GameState, rules: Rules, nodeId: string, seen: ReadonlySet<string> = new Set()): NodeState {
  if (rules.quests.some((q) => q.quest.roadmap_node === nodeId && stateOf(game, rules, q.id) === 'done')) return 'done';
  const node = rules.roadmap.nodes.find((n) => n.id === nodeId);
  if (!node || seen.has(nodeId)) return 'locked';
  if (!stageOpen(game, rules, node.stage)) return 'locked';
  const inner = new Set(seen).add(nodeId);
  return node.requires.every((r) => nodeState(game, rules, r, inner) === 'done') ? 'open' : 'locked';
}

export interface TrailNode {
  id: string;
  branch: BranchId;
  stage: Stage;
  title: string;
  requires: string[];
  state: NodeState;
  /** the quests that light this node, with their states */
  litBy: { quest: string; state: ReturnType<typeof questState> }[];
}

export interface TrailView {
  nodes: TrailNode[];
  towns: { id: string; stage: Stage; title: string; open: boolean; done: number; total: number }[];
  xp: Record<string, number>;
}

/** Everything the Career Trail screen draws, derived from the save and the roadmap. */
export function trail(game: GameState, rules: Rules): TrailView {
  const nodes = rules.roadmap.nodes.map((n) => ({
    id: n.id,
    branch: n.branch,
    stage: n.stage,
    title: n.title,
    requires: [...n.requires],
    state: nodeState(game, rules, n.id),
    litBy: rules.quests.filter((q) => q.quest.roadmap_node === n.id).map((q) => ({ quest: q.id, state: stateOf(game, rules, q.id) })),
  }));
  const towns = rules.roadmap.towns.map((t) => {
    const mine = nodes.filter((n) => n.stage === t.stage);
    return { id: t.id, stage: t.stage, title: t.title, open: townOpen(game, rules, t.id), done: mine.filter((n) => n.state === 'done').length, total: mine.length };
  });
  const xp = Object.fromEntries(rules.roadmap.branches.map((b) => [b.id, own(game.xp, b.id) ?? 0]));
  return { nodes, towns, xp };
}
