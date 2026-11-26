import { describe, expect, it } from 'vitest';
import { gateOpen } from '../../src/battle/triggers';
import {
  applyEvent,
  buy,
  canBuy,
  completeQuest,
  gateWon,
  currentQuest,
  hintBoost,
  incomePerQuest,
  nodeState,
  recordBattle,
  type Rules,
  setFlag,
  setLocale,
  startQuest,
  tick,
  townOpen,
  trail,
} from '../../src/core/game';
import { memoryStorage, openSave } from '../../src/core/persist';
import { progressEnv } from '../../src/core/progress';
import { BACKUP_PREFIX, deserialize, type GameState, MIGRATIONS, newGame, SAVE_KEY, SAVE_VERSION, serialize } from '../../src/core/save';
import { conversation } from '../../src/core/talk';
import { compile, test } from '../../src/rules/expr';
import { PROGRESS_FACTS } from '../../src/rules/registries';
import { run } from '../../src/sim/session';
import { content, FIXTURE, session } from '../helpers';

const rules = (): Rules => content();

/** Freeze deeply, so a test fails if a rule changes its input instead of returning a new state. */
function frozen<T>(x: T): T {
  if (x && typeof x === 'object') {
    for (const v of Object.values(x)) frozen(v);
    Object.freeze(x);
  }
  return x;
}

const fresh = (money = 0): GameState => frozen({ ...newGame('en', 7), money });

/** Complete quests in order, failing loudly if one is refused. */
function done(game: GameState, ...ids: string[]): GameState {
  for (const id of ids) {
    const r = completeQuest(game, rules(), id);
    if (!r.ok) throw new Error(`${id}: ${r.reason}`);
    game = frozen(r.game);
  }
  return game;
}

describe('quest rewards', () => {
  it('pay money and XP to the quest branch, and unlock what the quest opens', () => {
    const r = completeQuest(fresh(), rules(), 'broken-pipeline');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.game.money).toBe(200);
    expect(r.game.xp).toEqual({ cicd: 25 });
    expect(r.game.quests['broken-pipeline']).toBe('done');
    expect(r.reward).toMatchObject({ money: 200, income: 0, xp: 25, branch: 'cicd', node: 'cicd-pipeline', unlocked: ['friday-scope'] });
  });

  it('are applied once only', () => {
    const once = done(fresh(), 'disk-full');
    const again = completeQuest(once, rules(), 'disk-full');
    expect(again).toEqual({ ok: false, game: once, reason: 'done' });
    expect(again.game.money).toBe(150);
    expect(again.game.xp).toEqual({ linux: 20 });
  });

  it('add up per branch, and XP accumulates on the branch of each quest', () => {
    const g = done(fresh(), 'disk-full', 'service-down', 'broken-pipeline');
    expect(g.money).toBe(150 + 175 + 200);
    expect(g.xp).toEqual({ linux: 20, incident: 25, cicd: 25 });
  });

  it('refuse locked and unknown quests without changing anything', () => {
    const g = fresh();
    expect(completeQuest(g, rules(), 'rate-limiter-interview')).toEqual({ ok: false, game: g, reason: 'locked' });
    expect(completeQuest(g, rules(), 'nope')).toEqual({ ok: false, game: g, reason: 'unknown' });
    expect(completeQuest(g, rules(), '__proto__')).toEqual({ ok: false, game: g, reason: 'unknown' });
  });

  it('include the homelab income once the Raspberry Pi is owned', () => {
    const bought = buy(fresh(200), rules(), 'raspberry-pi');
    expect(bought.ok).toBe(true);
    expect(incomePerQuest(bought.game, rules())).toBe(10);
    const r = completeQuest(frozen(bought.game), rules(), 'disk-full');
    expect(r.ok && r.reward.income).toBe(10);
    expect(r.game.money).toBe(0 + 150 + 10);
  });

  it('start a quest only when it is available', () => {
    const g = fresh();
    const s = startQuest(g, rules(), 'disk-full');
    expect(s.ok && s.game.quests['disk-full']).toBe('active');
    expect(startQuest(g, rules(), 'night-pager')).toMatchObject({ ok: false, reason: 'locked' });
    expect(startQuest(done(g, 'disk-full'), rules(), 'disk-full')).toMatchObject({ ok: false, reason: 'done' });
    // an active quest can be completed and still pays once
    const c = completeQuest(frozen(s.game), rules(), 'disk-full');
    expect(c.ok && c.game.money).toBe(150);
  });

  it('track the current quest: the most recently accepted active one', () => {
    let g = fresh();
    expect(currentQuest(g, rules())).toBeNull();
    g = frozen(startQuest(g, rules(), 'disk-full').game);
    g = frozen(startQuest(g, rules(), 'service-down').game);
    expect(currentQuest(g, rules())).toBe('service-down');
    g = done(g, 'service-down');
    expect(currentQuest(g, rules())).toBe('disk-full');
  });
});

describe('battle results feed the same rewards', () => {
  it('a win completes the quest and pays once; a loss costs nothing and keeps it active', () => {
    const g = done(fresh(), 'broken-pipeline');
    const lost = recordBattle(g, rules(), 'friday-scope', 'lost');
    expect(lost).toMatchObject({ ok: false, reason: 'lost' });
    expect(lost.game.money).toBe(200);
    expect(lost.game.quests['friday-scope']).toBe('active');
    const won = recordBattle(frozen(lost.game), rules(), 'friday-scope', 'won');
    expect(won.ok).toBe(true);
    expect(won.game.money).toBe(400);
    expect(won.game.xp).toEqual({ cicd: 55 });
    const replay = recordBattle(frozen(won.game), rules(), 'friday-scope', 'won');
    expect(replay).toMatchObject({ ok: false, reason: 'done' });
    expect(replay.game).toBe(won.game);
    expect(recordBattle(frozen(won.game), rules(), 'friday-scope', 'lost').game).toBe(won.game);
  });

  it('a locked battle quest cannot be won', () => {
    expect(recordBattle(fresh(), rules(), 'rate-limiter-interview', 'won')).toMatchObject({ ok: false, reason: 'locked' });
  });
});

describe('scenario events', () => {
  it('a penalty costs every time but never takes money below zero', () => {
    let g = fresh(200);
    let r = applyEvent(g, 'disk-full', { id: 'db', money: -150 });
    expect([r.game.money, r.money]).toEqual([50, -150]);
    g = frozen(r.game);
    r = applyEvent(g, 'disk-full', { id: 'db', money: -150 });
    expect([r.game.money, r.money]).toEqual([0, -50]);
  });

  it('a bonus pays once per quest and event, and a flag is stored', () => {
    const g = fresh();
    const a = applyEvent(g, 'disk-full', { id: 'tidy', money: 50, setFlag: 'tidy' });
    expect(a.game.money).toBe(50);
    expect(a.game.flags).toEqual({ tidy: true });
    const b = applyEvent(frozen(a.game), 'disk-full', { id: 'tidy', money: 50 });
    expect([b.game.money, b.money]).toEqual([50, 0]);
    expect(applyEvent(frozen(a.game), 'service-down', { id: 'tidy', money: 50 }).game.money).toBe(100);
  });
});

describe('the shop', () => {
  it('refuses a purchase without the money, and changes nothing', () => {
    const g = fresh(199);
    expect(canBuy(g, rules(), 'raspberry-pi')).toEqual({ ok: false, reason: 'money' });
    expect(buy(g, rules(), 'raspberry-pi')).toEqual({ ok: false, game: g, reason: 'money' });
  });

  it('sells an item once, for its price', () => {
    const r = buy(fresh(350), rules(), 'raspberry-pi');
    expect(r).toMatchObject({ ok: true, price: 200 });
    expect(r.game.money).toBe(150);
    expect(r.game.items).toEqual(['raspberry-pi']);
    expect(buy(frozen(r.game), rules(), 'raspberry-pi')).toMatchObject({ ok: false, reason: 'owned' });
    expect(buy(fresh(999), rules(), 'gpu')).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('refuses an item whose required item is not owned', () => {
    const shop = { schema: 1 as const, items: [{ id: 'nas', title: 't', description: 'd', price: 1, requires: ['raspberry-pi'], effects: {} }] };
    expect(canBuy(fresh(999), { ...rules(), shop }, 'nas')).toEqual({ ok: false, reason: 'locked' });
  });

  it('the Raspberry Pi makes hints come one try sooner, in the terminal', () => {
    const owned = buy(fresh(200), rules(), 'raspberry-pi').game;
    expect(hintBoost(fresh(), rules())).toBe(0);
    expect(hintBoost(owned, rules())).toBe(1);
    // FIXTURE's hint needs two failed attempts; with the Pi, one is enough.
    const plain = session(FIXTURE, hintBoost(fresh(), rules()));
    const boosted = session(FIXTURE, hintBoost(owned, rules()));
    expect(run(plain, 'cat /nope').hints).toEqual([]);
    expect(run(boosted, 'cat /nope').hints).toEqual(['hint.one']);
  });
});

describe('saves', () => {
  it('round-trip a game in progress through the versioned format', () => {
    let g = done(fresh(), 'disk-full', 'service-down');
    g = frozen(buy(g, rules(), 'raspberry-pi').game);
    g = frozen(applyEvent(g, 'disk-full', { id: 'x', money: 5, setFlag: 'f' }).game);
    g = frozen(setLocale(tick(g), 'nl'));
    const raw = serialize(g);
    expect(JSON.parse(raw)).toMatchObject({ format: 'nines-save', version: SAVE_VERSION });
    expect(deserialize(raw, 'en')).toEqual({ kind: 'ok', game: g });
    const st = memoryStorage();
    const first = openSave(st, 'en', 1);
    expect(first.slot.status).toBe('new');
    expect(first.game.seed).toBe(1);
    expect(first.slot.save(g)).toBe(true);
    const second = openSave(st, 'en', 2);
    expect(second.slot.status).toBe('loaded');
    expect(second.game).toEqual(g);
  });

  it('migrate a version-1 save to the current version', () => {
    expect(SAVE_VERSION).toBe(2);
    expect(Object.keys(MIGRATIONS)).toEqual(['1']);
    const v1 = {
      format: 'nines-save',
      version: 1,
      game: { locale: 'nl', money: 350, xp: { linux: 20 }, quests: { 'disk-full': 'done' }, items: [], flags: {}, tech_debt: 0, player: { map: 'junior-village', x: 3, y: 4, facing: 'up' } },
    };
    const out = deserialize(JSON.stringify(v1), 'en');
    expect(out).toEqual({ kind: 'ok', game: { ...v1.game, seed: 0, ticks: 0, claimed: [] } });
  });

  it('never overwrite a save from a newer version', () => {
    const future = JSON.stringify({ format: 'nines-save', version: SAVE_VERSION + 1, game: { money: 9999 } });
    const st = memoryStorage({ [SAVE_KEY]: future });
    const { game, slot } = openSave(st, 'nl', 3);
    expect(slot.status).toBe('newer');
    expect(slot.writable).toBe(false);
    expect(game).toEqual(newGame('nl', 3));
    expect(slot.save(done(game, 'disk-full'))).toBe(false);
    expect(st.data.get(SAVE_KEY)).toBe(future);
    expect([...st.data.keys()]).toEqual([SAVE_KEY]);
  });

  it('stop writing when another tab with a newer version saved meanwhile', () => {
    const st = memoryStorage();
    const { game, slot } = openSave(st, 'en', 0);
    expect(slot.save(game)).toBe(true);
    const future = JSON.stringify({ format: 'nines-save', version: SAVE_VERSION + 1, game: {} });
    st.setItem(SAVE_KEY, future);
    expect(slot.save(game)).toBe(false);
    expect(slot.writable).toBe(false);
    expect(st.data.get(SAVE_KEY)).toBe(future);
  });

  it('back up an unreadable save and start fresh', () => {
    const st = memoryStorage({ [SAVE_KEY]: '{oops' });
    const { game, slot } = openSave(st, 'en', 5);
    expect(slot.status).toBe('recovered');
    expect(game).toEqual(newGame('en', 5));
    expect(st.data.get(`${BACKUP_PREFIX}1`)).toBe('{oops');
    expect(slot.save(game)).toBe(true);
  });

  it('play on in memory when the storage refuses', () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const { game, slot } = openSave(broken, 'en', 0);
    expect(slot.status).toBe('new');
    expect(slot.save(game)).toBe(false);
  });

  it('repair a hand-edited save: negative money, a bad seed, duplicate items', () => {
    const raw = JSON.stringify({ format: 'nines-save', version: 2, game: { money: -5, seed: 'x', ticks: -1, items: ['a', 'a', 3], claimed: 'no' } });
    expect(deserialize(raw, 'en')).toMatchObject({ kind: 'ok', game: { money: 0, seed: 0, ticks: 0, items: ['a'], claimed: [] } });
  });
});

describe('the Career Trail', () => {
  const states = (g: GameState) => Object.fromEntries(trail(g, rules()).nodes.map((n) => [n.id, n.state]));

  it('starts with the Junior roots open, their followers and Medior City locked', () => {
    const s = states(fresh());
    expect(s['linux-disk']).toBe('open');
    expect(s['linux-services']).toBe('locked');
    expect(s['incident-pager']).toBe('locked');
    expect(s['observability-logs']).toBe('locked');
    expect(Object.values(s)).not.toContain('done');
  });

  it('lights the three nodes of the three MVP quests', () => {
    const g = done(fresh(), 'disk-full', 'service-down', 'broken-pipeline');
    const view = trail(g, rules());
    expect(view.nodes.filter((n) => n.state === 'done').map((n) => n.id)).toEqual(['linux-disk', 'cicd-pipeline', 'incident-first']);
    expect(view.towns.find((t) => t.id === 'junior')).toMatchObject({ open: true, done: 3, total: 9 });
    expect(view.xp).toMatchObject({ linux: 20, cicd: 25, incident: 25, git: 0 });
    // the next nodes on those routes open
    expect(nodeState(g, rules(), 'incident-pager')).toBe('open');
    expect(nodeState(g, rules(), 'cicd-release-scope')).toBe('open');
    expect(view.nodes.find((n) => n.id === 'linux-disk')?.litBy).toEqual([{ quest: 'disk-full', state: 'done' }]);
  });

  it('keeps Medior routes locked until the gate interview is won, then opens them', () => {
    let g = done(fresh(), 'disk-full', 'service-down', 'broken-pipeline');
    expect(townOpen(g, rules(), 'medior')).toBe(false);
    expect(nodeState(g, rules(), 'observability-logs')).toBe('locked');
    const won = recordBattle(g, rules(), 'rate-limiter-interview', 'won');
    g = frozen(won.game);
    expect(townOpen(g, rules(), 'medior')).toBe(true);
    expect(nodeState(g, rules(), 'observability-logs')).toBe('open');
    // iac-first needs git-basics too, which no quest lights yet
    expect(nodeState(g, rules(), 'iac-first')).toBe('locked');
  });

  it('XP earned is what progress conditions read, so content can unlock with it', () => {
    const g = done(fresh(), 'disk-full');
    const env = progressEnv(g, rules().quests.map((q) => q.quest));
    expect(test(compile('xp("linux") >= 20 && xp("cicd") == 0', PROGRESS_FACTS), env)).toBe(true);
  });

  it('gateOpen in battle/triggers agrees with gateWon', () => {
    for (const g of [fresh(), done(fresh(), 'disk-full', 'service-down', 'broken-pipeline', 'rate-limiter-interview')]) {
      for (const town of ['junior', 'medior', 'senior']) expect(gateOpen(town, rules().quests, g)).toBe(gateWon(g, rules(), town));
    }
  });

  it('opens towns in road order: Senior Summit waits for Medior City', () => {
    const g = fresh();
    expect(['junior', 'medior', 'senior'].map((t) => townOpen(g, rules(), t))).toEqual([true, false, false]);
    expect(gateWon(g, rules(), 'senior')).toBe(true);
    expect(trail(g, rules()).towns.map((t) => t.open)).toEqual([true, false, false]);
    const won = done(g, 'disk-full', 'service-down', 'broken-pipeline', 'rate-limiter-interview');
    expect(['junior', 'medior', 'senior'].map((t) => townOpen(won, rules(), t))).toEqual([true, true, true]);
    expect(townOpen(g, rules(), 'atlantis')).toBe(false);
  });
});

describe('small setters', () => {
  it('return the same state when nothing changes', () => {
    const g = fresh();
    expect(setLocale(g, 'en')).toBe(g);
    expect(setFlag(g, 'x', false)).not.toBe(g);
    const f = frozen(setFlag(g, 'x', true));
    expect(setFlag(f, 'x', true)).toBe(f);
    expect(tick(tick(g)).ticks).toBe(2);
  });
});

describe('conversations', () => {
  it('offer a quest, repeat it while active, then fall back to the NPC lines', () => {
    let g = fresh();
    expect(conversation(g, content(), 'femke')).toEqual({
      speaker: 'quest.disk-full.npc.name',
      lines: ['quest.disk-full.offer.1', 'quest.disk-full.offer.2'],
      offer: 'disk-full',
    });
    g = frozen(startQuest(g, rules(), 'disk-full').game);
    expect(conversation(g, content(), 'femke')?.lines).toEqual(['quest.disk-full.active.1']);
    g = done(g, 'disk-full');
    expect(conversation(g, content(), 'femke')).toEqual({ speaker: 'quest.disk-full.npc.name', lines: ['quest.disk-full.npc.after'] });
  });

  it('name the battle a talk starts, and never start a pager battle by talking', () => {
    let g = done(fresh(), 'disk-full', 'broken-pipeline');
    expect(conversation(g, content(), 'ingrid')?.battle).toBeUndefined();
    g = done(g, 'service-down');
    expect(conversation(g, content(), 'ingrid')).toMatchObject({ offer: 'rate-limiter-interview', battle: 'rate-limiter-interview' });
    // Bas gives service-down (done) and night-pager (a pager battle, available now)
    expect(conversation(g, content(), 'bas')).toEqual({ speaker: 'quest.service-down.npc.name', lines: ['quest.service-down.npc.after'] });
    expect(conversation(g, content(), 'nobody')).toBeNull();
  });
});
