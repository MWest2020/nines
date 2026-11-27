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
// Karma, hustles and the independent contractor (core/karma.ts): a quest's `reward.karma` and
// an event's `karma` move the meter; a hustle is finished through finishHustle, which rolls its
// risk; a contractor's terminal job pays CONTRACT_PERCENT and damage costs DAMAGE_MULTIPLIER.

import type { BranchId, ContentBundle, LocaleId, QuestEntry, QuestKind, Stage } from '../content/types';
import { own } from '../rules/own';
import {
  ARREST_AFTER,
  ARREST_FINE,
  ARREST_KARMA,
  CAUGHT_FINE,
  CAUGHT_KARMA,
  CONTRACT_PERCENT,
  changeKarma,
  clampRisk,
  DAMAGE_MULTIPLIER,
  fine,
  questKind,
  reopenService,
  riskRoll,
} from './karma';
import { questState } from './progress';
import type { GameState } from './save';
import { addTokens, paidHints, rewardPercent, scaled } from './tokens';

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

/** `hustle`: a hustle is finished through finishHustle, which rolls its risk first. */
export type QuestRefusal = 'unknown' | 'locked' | 'done' | 'hustle';

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
  kind: QuestKind;
  /** karma changed by finishing it (community service: up to at least 0) */
  karma: number;
  /** the karma drop brought the agency: the fine it took */
  agency: { fine: number } | null;
  /** paid as an independent contractor: CONTRACT_PERCENT of the money */
  contract: boolean;
}

/**
 * An independent contractor's terminal job: a job whose scenario has procedures to skip. Only
 * there are procedures skipped, the money raised and damage billed; elsewhere a contractor works
 * like anyone else (DESIGN.md, Independent contractor).
 */
export const contracted = (game: GameState, entry: QuestEntry | undefined): boolean =>
  game.contractor && entry !== undefined && questKind(entry) === 'job' && (entry.scenario?.objectives.some((o) => o.procedure === true) ?? false);

export type CompleteResult = { ok: true; game: GameState; reward: Reward } | { ok: false; game: GameState; reason: QuestRefusal };

/**
 * Finish a quest and pay its reward. Only once: a done quest returns `reason: 'done'` and the
 * same state. A locked quest cannot be finished (the world never offers it, so that is a bug).
 * A hustle is finished with finishHustle, which rolls first.
 */
export function completeQuest(game: GameState, rules: Rules, id: string): CompleteResult {
  const entry = findQuest(rules, id);
  if (!entry) return { ok: false, game, reason: 'unknown' };
  if (questKind(entry) === 'hustle') return { ok: false, game, reason: 'hustle' };
  return pay(game, rules, entry);
}

function pay(game: GameState, rules: Rules, entry: QuestEntry): CompleteResult {
  const id = entry.id;
  const state = stateOf(game, rules, id);
  if (state === 'locked' || state === 'done') return { ok: false, game, reason: state };
  const q = entry.quest;
  const kind = questKind(entry);
  const contract = contracted(game, entry);
  // community service can come round again; its XP and the homelab's income are paid once
  const serviceKey = `service/${id}`;
  const again = kind === 'service' && game.claimed.includes(serviceKey);
  const income = again ? 0 : incomePerQuest(game, rules);
  const hints = paidHints(game, rules, id);
  const percent = rewardPercent(hints);
  const money = scaled(scaled(q.reward.money, percent), contract ? CONTRACT_PERCENT : 100);
  const xp = again ? 0 : scaled(q.reward.xp, percent);
  let next: GameState = {
    ...game,
    money: game.money + money + income,
    ...(kind === 'service' && !again ? { claimed: [...game.claimed, serviceKey] } : {}),
    xp: { ...game.xp, [q.branch]: (own(game.xp, q.branch) ?? 0) + xp },
    tech_debt: game.tech_debt + (q.reward.tech_debt ?? 0),
    quests: { ...game.quests, [id]: 'done' },
  };
  const k = changeKarma(next, rules, q.reward.karma ?? 0);
  next = k.game;
  if (kind === 'service') {
    // community service: probation ends, strikes are wiped, and karma is back to at least 0
    next = { ...next, karma: Math.max(0, next.karma), probation: false, strikes: 0 };
  }
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
      kind,
      karma: next.karma - game.karma,
      agency: k.agency,
      contract,
    },
  };
}

// ---- hustles (DESIGN.md, Side hustles)

export type HustleResult =
  | { ok: true; outcome: 'clean'; game: GameState; reward: Reward; roll: number; risk: number; lesson: boolean }
  | {
      ok: true;
      outcome: 'caught';
      game: GameState;
      roll: number;
      risk: number;
      /** money actually taken: the fine, plus the arrest's when arrested */
      fine: number;
      karma: number;
      strikes: number;
      arrested: { fine: number } | null;
      agency: { fine: number } | null;
      lesson: boolean;
    }
  | { ok: false; game: GameState; reason: QuestRefusal };

/** What the player carried into a hustle from the save (scenario `carry`): the extra fine if
 *  caught with it, and the flags taken away then. */
export interface HustleCover {
  caughtFine?: number;
  confiscate?: string[];
}

/**
 * Finish a hustle: its risk (the scenario's, from sim/session.ts riskOf, 0 to RISK_CAP) against
 * the seeded roll. Clean: paid like any quest, its karma included. Caught: a fine, a karma hit
 * and a strike, and the job stays active; at ARREST_AFTER strikes the player is arrested: a big
 * fine and probation.
 */
export function finishHustle(game: GameState, rules: Rules, id: string, risk: number, opts: HustleCover = {}): HustleResult {
  const entry = findQuest(rules, id);
  if (!entry || questKind(entry) !== 'hustle') return { ok: false, game, reason: 'unknown' };
  const state = stateOf(game, rules, id);
  if (state === 'locked' || state === 'done') return { ok: false, game, reason: state };
  const r = clampRisk(risk);
  const dice = riskRoll(game, id);
  // the responsible-disclosure line is told at a hustle's first ending, not at every retry
  const lessonKey = `lesson/${id}`;
  const lesson = !game.claimed.includes(lessonKey);
  const told = (g: GameState): GameState => (lesson ? { ...g, claimed: [...g.claimed, lessonKey] } : g);
  if (dice >= r) {
    const paid = pay(game, rules, entry);
    return paid.ok ? { ok: true, outcome: 'clean', game: told(paid.game), reward: paid.reward, roll: dice, risk: r, lesson } : paid;
  }
  const strikes = game.strikes + 1;
  const arrest = strikes >= ARREST_AFTER;
  // an arrest is probation already, so the agency does not come on top of it; whatever the player
  // carried in that was not theirs (a borrowed card) is taken, and raises the fine
  const flags = { ...game.flags };
  for (const f of opts.confiscate ?? []) delete flags[f];
  let g: GameState = { ...game, flags, quests: { ...game.quests, [id]: 'active' }, strikes, caught: game.caught + 1, ...(arrest ? { probation: true } : {}) };
  const f1 = fine(g, CAUGHT_FINE + Math.max(0, Math.floor(opts.caughtFine ?? 0)));
  g = f1.game;
  const k1 = changeKarma(g, rules, CAUGHT_KARMA);
  g = k1.game;
  let taken = f1.paid;
  let karma = k1.karma;
  let arrested: { fine: number } | null = null;
  if (arrest) {
    const f2 = fine(g, ARREST_FINE);
    const k2 = changeKarma(f2.game, rules, ARREST_KARMA);
    g = reopenService(k2.game, rules);
    taken += f2.paid;
    karma += k2.karma;
    arrested = { fine: f2.paid };
  }
  return { ok: true, outcome: 'caught', game: told(g), roll: dice, risk: r, fine: taken, karma, strikes, arrested, agency: k1.agency, lesson };
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
  karma?: number;
  setFlag?: string;
}

export interface EventApplied {
  game: GameState;
  /** money actually changed */
  money: number;
  /** karma actually changed */
  karma: number;
  /** the karma drop brought the agency */
  agency: { fine: number } | null;
}

/**
 * Apply an event a terminal session fired. A penalty (negative money or karma) costs every time,
 * and money never goes below zero; a bonus (positive money or karma) pays once per quest and
 * event; a flag is set. An independent contractor pays DAMAGE_MULTIPLIER times the penalty on a
 * job. Returns what actually changed, for the HUD.
 */
export function applyEvent(game: GameState, rules: Rules, questId: string, ev: EventOutcome): EventApplied {
  let next = game;
  let delta = 0;
  const key = `${questId}/${ev.id}`;
  const first = !game.claimed.includes(key);
  const karma = ev.karma ?? 0;
  if (ev.money < 0) {
    const bill = contracted(game, findQuest(rules, questId)) ? -ev.money * DAMAGE_MULTIPLIER : -ev.money;
    const f = fine(next, bill);
    next = f.game;
    delta = -f.paid || 0; // never -0
  } else if (ev.money > 0 && first) {
    delta = ev.money;
    next = { ...next, money: next.money + delta };
  }
  if ((ev.money > 0 || karma > 0) && first) next = { ...next, claimed: [...next.claimed, key] };
  let k: ReturnType<typeof changeKarma> = { game: next, karma: 0, agency: null };
  if (karma < 0 || (karma > 0 && first)) k = changeKarma(next, rules, karma);
  next = k.game;
  if (ev.setFlag) next = setFlag(next, ev.setFlag, true);
  return { game: next, money: delta, karma: k.karma, agency: k.agency };
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

/** What a career change costs at the coach (issue 24 on GitHub, its default: a paid change). */
export const CAREER_CHANGE_FEE = 300;

export type ChangeRefusal = 'unknown' | 'closed' | 'none' | 'same' | 'money';

/**
 * Choose a career path. It is chosen at Medior City, so the road there must be open; it is
 * chosen once, and changing it later is changePath (a fee at the coach). Choosing the same path
 * again is a no-op.
 */
export function choosePath(game: GameState, rules: Pick<Rules, 'quests' | 'roadmap'>, pathId: string): { ok: true; game: GameState } | { ok: false; game: GameState; reason: PathRefusal } {
  if (!rules.roadmap.paths.some((p) => p.id === pathId)) return { ok: false, game, reason: 'unknown' };
  if (game.path === pathId) return { ok: true, game };
  if (game.path !== null) return { ok: false, game, reason: 'chosen' };
  if (!townOpen(game, rules, 'medior')) return { ok: false, game, reason: 'closed' };
  return { ok: true, game: { ...game, path: pathId } };
}

/**
 * Change career path at the coach: only once a path is chosen, to a different one, for
 * CAREER_CHANGE_FEE (money never goes below zero, so the fee must be there). XP, quests and
 * karma stay: what you learned on the old path is still yours.
 */
export function changePath(
  game: GameState,
  rules: Pick<Rules, 'quests' | 'roadmap'>,
  pathId: string,
): { ok: true; game: GameState; fee: number } | { ok: false; game: GameState; reason: ChangeRefusal } {
  if (!rules.roadmap.paths.some((p) => p.id === pathId)) return { ok: false, game, reason: 'unknown' };
  if (!townOpen(game, rules, 'medior')) return { ok: false, game, reason: 'closed' };
  if (game.path === null) return { ok: false, game, reason: 'none' };
  if (game.path === pathId) return { ok: false, game, reason: 'same' };
  if (game.money < CAREER_CHANGE_FEE) return { ok: false, game, reason: 'money' };
  return { ok: true, fee: CAREER_CHANGE_FEE, game: { ...game, money: game.money - CAREER_CHANGE_FEE, path: pathId } };
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
