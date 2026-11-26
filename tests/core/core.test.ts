import { describe, expect, it } from 'vitest';
import { createTranslator, defaultLocale, interpolate } from '../../src/core/i18n';
import { progressEnv, questState } from '../../src/core/progress';
import { BACKUP_PREFIX, deserialize, loadFrom, newGame, SAVE_KEY, saveTo, serialize } from '../../src/core/save';
import { compile, test } from '../../src/rules/expr';
import { PROGRESS_FACTS } from '../../src/rules/registries';

describe('i18n', () => {
  const t = createTranslator({ en: { a: 'Hello {name}', only_en: 'en' }, nl: { a: 'Hallo {name}' } }, 'nl');
  it('translates, interpolates, falls back to English, shows unknown keys', () => {
    expect(t('a', { name: 'Mark' })).toBe('Hallo Mark');
    expect(t('only_en')).toBe('en');
    expect(t('missing')).toBe('missing');
    expect(interpolate('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
  it('picks Dutch for a Dutch device', () => {
    expect(defaultLocale(['nl-NL', 'en'])).toBe('nl');
    expect(defaultLocale(['en-GB'])).toBe('en');
    expect(defaultLocale([])).toBe('en');
  });
});

describe('save', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it('round-trips', () => {
    const g = { ...newGame('nl'), money: 150, quests: { 'disk-full': 'done' as const }, items: ['raspberry-pi'] };
    expect(deserialize(serialize(g), 'en')).toEqual({ kind: 'ok', game: g });
    const st = memory();
    saveTo(st, g);
    expect(JSON.parse(st.m.get(SAVE_KEY)!)).toMatchObject({ format: 'nines-save', version: 1 });
    expect(loadFrom(st, 'en')).toEqual({ kind: 'ok', game: g });
  });
  it('an empty store is a new game; garbage is backed up, never thrown away', () => {
    const st = memory();
    expect(loadFrom(st, 'en')).toEqual({ kind: 'empty' });
    st.setItem(SAVE_KEY, '{not json');
    expect(loadFrom(st, 'en').kind).toBe('unreadable');
    expect(st.m.get(`${BACKUP_PREFIX}1`)).toBe('{not json');
    st.setItem(SAVE_KEY, 'second');
    loadFrom(st, 'en');
    expect(st.m.get(`${BACKUP_PREFIX}1`)).toBe('{not json');
    expect(st.m.get(`${BACKUP_PREFIX}2`)).toBe('second');
  });
  it('refuses saves from the future and repairs wrong types', () => {
    expect(deserialize(JSON.stringify({ format: 'nines-save', version: 99, game: {} }), 'en')).toEqual({ kind: 'newer', version: 99 });
    const out = deserialize(JSON.stringify({ format: 'nines-save', version: 1, game: { money: 'lots', quests: { a: 'done', b: 'hacked' }, locale: 'fr' } }), 'nl');
    expect(out).toMatchObject({ kind: 'ok', game: { money: 0, quests: { a: 'done' }, locale: 'nl' } });
  });
});

describe('progress facts', () => {
  const quests = [
    { id: 'a', requires: [] },
    { id: 'b', requires: ['a'] },
  ] as never[];
  it('derives quest states', () => {
    const g = newGame('en');
    expect(questState(g, quests, 'a')).toBe('available');
    expect(questState(g, quests, 'b')).toBe('locked');
    g.quests['a'] = 'done';
    expect(questState(g, quests, 'b')).toBe('available');
  });
  it('answers dialogue conditions', () => {
    const g = { ...newGame('en'), money: 300, items: ['raspberry-pi'] };
    g.quests['a'] = 'done';
    const env = progressEnv(g, quests);
    expect(test(compile('quest("a") == "done" && money >= 200 && has_item("raspberry-pi")', PROGRESS_FACTS), env)).toBe(true);
    expect(test(compile('xp("linux") > 0 || flag("x") || tech_debt > 0', PROGRESS_FACTS), env)).toBe(false);
  });
});
