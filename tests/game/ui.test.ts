// The Phaser-free parts of the UI: the pixel font's wrapping, keyboard focus, dialogue pages
// and the game store the scenes sit on.

import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/content/types';
import { memoryStorage, openSave } from '../../src/core/persist';
import { newGame, SAVE_KEY } from '../../src/core/save';
import { ellipsize, FONT, GLYPHS, measure, paginate, sanitize, wrap } from '../../src/game/ui/font';
import { navigate } from '../../src/game/ui/nav';
import { GameStore, type Change } from '../../src/game/store';
import { content } from '../helpers';

describe('the pixel font', () => {
  it('has a glyph for every character in every locale string', () => {
    const missing = new Set<string>();
    for (const l of LOCALES) {
      for (const v of Object.values(content().locales[l])) for (const c of v.normalize('NFC')) if (!GLYPHS.has(c) && c !== '\n') missing.add(c);
    }
    expect([...missing]).toEqual([]);
  });

  it('draws every glyph inside its rows, capitals 7 px tall', () => {
    for (const g of GLYPHS.values()) {
      expect(g.pixels.length).toBeLessThanOrEqual(FONT.rows);
      expect(g.pixels.every((r) => r.length === g.width)).toBe(true);
    }
    expect(GLYPHS.get('E')!.pixels.length).toBe(7);
    expect(GLYPHS.get('g')!.pixels.length).toBe(9);
  });

  it('measures proportionally and wraps at spaces', () => {
    expect(measure('i')).toBe(1);
    expect(measure('ii')).toBe(3);
    expect(measure('')).toBe(0);
    const lines = wrap('the quick brown fox jumps over the lazy dog', 60);
    expect(lines.every((l) => measure(l) <= 60)).toBe(true);
    expect(lines.join(' ')).toBe('the quick brown fox jumps over the lazy dog');
    expect(wrap('a\nb', 100)).toEqual(['a', 'b']);
  });

  it('cuts a word longer than a line', () => {
    const lines = wrap('x'.repeat(40), 50);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((l) => measure(l) <= 50)).toBe(true);
    expect(lines.join('')).toBe('x'.repeat(40));
  });

  it('shows a missing glyph as a question mark, and ellipsizes', () => {
    expect(sanitize('a☃b')).toBe('a?b');
    const e = ellipsize('A rather long quest title indeed', 60);
    expect(e.endsWith('…')).toBe(true);
    expect(measure(e)).toBeLessThanOrEqual(60);
    expect(ellipsize('short', 60)).toBe('short');
  });

  it('pages text three lines at a time', () => {
    const text = content().locales.en['item.raspberry_pi.desc']!;
    const pages = paginate(text, 100, 3);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.split('\n').length <= 3)).toBe(true);
    expect(paginate('', 100, 3)).toEqual(['']);
  });
});

describe('the screens fit the content', () => {
  // The Career Trail screen (src/game/ui/TrailScene.ts) draws six branch rows of up to five
  // stones per town; content beyond that would run off the panel.
  const LIMITS = { branchesPerStage: 6, nodesPerBranch: 5 };
  it('every town has at most six branches, each with at most five stones', () => {
    const { roadmap } = content();
    for (const town of roadmap.towns) {
      const nodes = roadmap.nodes.filter((n) => n.stage === town.stage);
      const branches = new Set(nodes.map((n) => n.branch));
      expect(branches.size, `${town.id} has too many branches for the Career Trail screen`).toBeLessThanOrEqual(LIMITS.branchesPerStage);
      for (const b of branches) expect(nodes.filter((n) => n.branch === b).length, `${town.id}/${b}`).toBeLessThanOrEqual(LIMITS.nodesPerBranch);
    }
  });
});

describe('the shop fits its text', () => {
  // ShopScene: an item card's description wraps into four lines of 174 px (the card's width
  // beside the art); more would be cut off.
  it('every item description fits in four lines, in both languages', () => {
    const b = content();
    for (const lang of LOCALES) {
      for (const item of b.shop.items) {
        const lines = wrap(b.locales[lang][item.description]!.replaceAll('{tokens}', String(item.effects.tokens ?? 0)), 174);
        expect(lines.length, `${lang} ${item.id}: ${lines.join(' / ')}`).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('keyboard focus', () => {
  const grid = [
    { x: 0, y: 0, w: 10, h: 10 },
    { x: 20, y: 0, w: 10, h: 10 },
    { x: 0, y: 20, w: 10, h: 10 },
    { x: 20, y: 20, w: 10, h: 10 },
  ];
  it('moves to the nearest item that way and stays at an edge', () => {
    expect(navigate(grid, 0, 'right')).toBe(1);
    expect(navigate(grid, 0, 'down')).toBe(2);
    expect(navigate(grid, 3, 'up')).toBe(1);
    expect(navigate(grid, 3, 'left')).toBe(2);
    expect(navigate(grid, 0, 'left')).toBe(0);
    expect(navigate([], 0, 'left')).toBe(-1);
  });
});

describe('the game store', () => {
  const make = (seed = 1) => {
    const st = memoryStorage();
    const { game, slot } = openSave(st, 'en', seed);
    const store = new GameStore(content(), game, slot);
    const changes: Change[] = [];
    store.subscribe((_g, c) => changes.push(c));
    return { st, store, changes };
  };

  it('saves after a quest, tells listeners, and pays once', () => {
    const { st, store, changes } = make();
    expect(store.completeQuest('disk-full').ok).toBe(true);
    expect(store.completeQuest('disk-full').ok).toBe(false);
    expect(changes.map((c) => c.kind)).toEqual(['reward']);
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game.money).toBe(150);
  });

  it('applies terminal events and saves the penalty at once', () => {
    const { st, store, changes } = make();
    store.completeQuest('disk-full');
    const delta = store.applyEvents('disk-full', [{ id: 'db', say: 'x', scope: 'quest', money: -100, karma: 0, reset: true, setFlag: 'oops' }]);
    expect(delta).toEqual({ money: -100, karma: 0, agency: null });
    expect(store.game.flags).toEqual({ oops: true });
    expect(changes.at(-1)).toEqual({ kind: 'money', delta: -100 });
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game.money).toBe(50);
  });

  it('finishes a hustle through the roll and saves either way; the contractor flag is saved too', () => {
    const { st, store, changes } = make(5);
    const clean = store.finishHustle('vending-prices', 0);
    expect(clean).toMatchObject({ ok: true, outcome: 'clean' });
    expect(changes.at(-1)?.kind).toBe('reward');
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game).toMatchObject({ karma: -20, money: 350 });
    // seed 5 rolls 50 for this job (tests/core/karma.test.ts covers the roll itself)
    const caught = make(5);
    caught.store.startQuest('vending-prices');
    expect(caught.store.finishHustle('vending-prices', 95)).toMatchObject({ ok: true, outcome: 'caught', roll: 50 });
    expect(caught.changes.at(-1)).toEqual({ kind: 'caught', quest: 'vending-prices', fine: 0, arrested: false });
    expect(JSON.parse(caught.st.data.get(SAVE_KEY)!).game).toMatchObject({ karma: -10, strikes: 1, caught: 1 });
    store.setContractor(true);
    expect(changes.at(-1)).toEqual({ kind: 'contractor', on: true });
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game.contractor).toBe(true);
  });

  it('opens community service when a save holds probation with the service already done', () => {
    const st = memoryStorage();
    const { game, slot } = openSave(st, 'en', 1);
    const store = new GameStore(content(), { ...game, probation: true, quests: { 'repair-cafe': 'done' } }, slot);
    expect(store.questState('repair-cafe')).toBe('available');
  });

  it('pays a terminal bonus once however often the terminal is replayed, and saves it', () => {
    const { st, store } = make();
    const bonus = [{ id: 'tidy', say: 'x', scope: 'quest' as const, money: 40, karma: 0, reset: false }];
    expect(store.applyEvents('disk-full', bonus).money).toBe(40);
    expect(store.applyEvents('disk-full', bonus).money).toBe(0);
    expect(store.game.money).toBe(40);
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game).toMatchObject({ money: 40, claimed: ['disk-full/tidy'] });
  });

  it('buys through the rules, and the Pi raises the hint boost', () => {
    const { store } = make();
    expect(store.buy('raspberry-pi')).toMatchObject({ ok: false, reason: 'money' });
    store.completeQuest('broken-pipeline');
    expect(store.hintBoost()).toBe(0);
    expect(store.buy('raspberry-pi')).toMatchObject({ ok: true });
    expect(store.hintBoost()).toBe(1);
    expect(store.game.money).toBe(0);
  });

  it('asking the AI pays a token and saves at once; the reward then pays 80%', () => {
    const { st, store, changes } = make();
    expect(store.hintOffer('service-down', 'hint.status')).toMatchObject({ kind: 'ask', cost: 1, percent: 100, after: 80 });
    expect(store.takeHint('service-down', 'hint.status')).toBe(true);
    expect(changes.at(-1)).toEqual({ kind: 'hint', quest: 'service-down', charged: 1 });
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game).toMatchObject({ tokens: 2, hints: { 'service-down': ['hint.status'] } });
    // asking again is free and changes nothing
    const n = changes.length;
    expect(store.takeHint('service-down', 'hint.status')).toBe(true);
    expect(changes.length).toBe(n);
    const r = store.completeQuest('service-down');
    expect(r.ok && r.reward).toMatchObject({ money: 140, xp: 20, percent: 80, hints: 1 });
  });

  it('drops a path the roadmap does not have when the store loads', () => {
    const st = memoryStorage();
    const opened = openSave(st, 'en', 1);
    expect(new GameStore(content(), { ...opened.game, path: 'wizard' }, opened.slot).game.path).toBeNull();
    expect(new GameStore(content(), { ...opened.game, path: 'sre' }, opened.slot).game.path).toBe('sre');
  });

  it('AI credits: bought again and again, never owned', () => {
    const { store } = make();
    store.completeQuest('broken-pipeline'); // €200
    expect(store.buy('ai-credits')).toMatchObject({ ok: true, price: 40 });
    expect(store.buy('ai-credits')).toMatchObject({ ok: true });
    expect(store.game).toMatchObject({ money: 120, tokens: 9, items: [] });
  });

  it('switches language: strings follow and the choice is saved', () => {
    const { st, store } = make();
    expect(store.t('ui.shop.title')).toBe('Homelab Store');
    store.setLocale('nl');
    expect(store.t('ui.shop.title')).toBe('Homelabwinkel');
    expect(JSON.parse(st.data.get(SAVE_KEY)!).game.locale).toBe('nl');
    const again = openSave(st, 'en', 9);
    expect(new GameStore(content(), again.game, again.slot).t('ui.close')).toBe('Sluiten');
  });

  it('counts a pager tick on every map change, deterministically per seed', () => {
    const fires = (seed: number) => {
      const { store } = make(seed);
      store.completeQuest('service-down');
      store.completeQuest('broken-pipeline');
      const out: (string | null)[] = [];
      for (let i = 0; i < 30; i++) out.push(store.enterMap({ map: 'junior-village', x: i, y: 1, facing: 'down' }));
      return out;
    };
    const a = fires(42);
    expect(a).toEqual(fires(42));
    expect(a.filter((x) => x === 'night-pager').length).toBeGreaterThan(0);
    expect(a.every((x) => x === null || x === 'night-pager')).toBe(true);
    // no pager before its condition holds
    const { store } = make(42);
    for (let i = 0; i < 30; i++) expect(store.enterMap({ map: 'm', x: 0, y: 0, facing: 'up' })).toBeNull();
    expect(store.game.ticks).toBe(30);
  });

  it('never writes over a newer save, whatever the player does', () => {
    const future = JSON.stringify({ format: 'nines-save', version: 99, game: {} });
    const st = memoryStorage({ [SAVE_KEY]: future });
    const { game, slot } = openSave(st, 'en', 0);
    const store = new GameStore(content(), game, slot);
    store.completeQuest('disk-full');
    store.setLocale('nl');
    store.enterMap({ map: 'x', x: 0, y: 0, facing: 'up' });
    expect(store.save()).toBe(false);
    expect(st.data.get(SAVE_KEY)).toBe(future);
    expect(store.game.money).toBe(150);
  });

  it('starts from a new game when there is no save', () => {
    const { store } = make(5);
    expect(store.game).toEqual(newGame('en', 5));
    expect(store.currentQuest()).toBeNull();
    expect(store.trail().nodes.length).toBe(content().roadmap.nodes.length);
  });
});
