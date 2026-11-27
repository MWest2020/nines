// The sample cameo, content/quests/its-always-dns: a guest quest that arrived as one folder.
// These tests came in a later commit than the folder: the proof is that the folder alone
// validates, shows up in the game and the credits, and can be won in the simulator.

import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { run, saveFile } from '../../src/sim/session';
import { content, session, sh, steps } from '../helpers';

const ID = 'its-always-dns';
const scenario = (): ScenarioSpec => {
  const q = content().quests.find((x) => x.id === ID);
  if (!q?.scenario) throw new Error(`no terminal quest ${ID}`);
  return q.scenario;
};
const HOSTS = '/etc/hosts';
const hosts = (s: ReturnType<typeof session>) => run(s, `edit ${HOSTS}`).ui!.editor!.content;

describe('the sample cameo in the bundle', () => {
  it('is a terminal quest on a spare rack, given by an NPC on a cameo slot, in both languages', () => {
    const b = content();
    const q = b.quests.find((x) => x.id === ID)!;
    expect(q.quest.start).toEqual({ map: 'server-room', object: 'cameo-rack-1' });
    expect(q.npc?.spawn).toMatchObject({ map: 'junior-village', slot: 'cameo-1' });
    expect(q.npc?.sprite).toMatchObject({ file: 'yara.png', frame: 16, license: 'CC0-1.0' });
    expect(b.locales.en[questKey(ID, 'title')]).toBe("It's always DNS");
    expect(b.locales.nl[questKey(ID, 'title')]).toBe('Het is altijd DNS');
    expect(b.locales.nl[questKey(ID, 'npc.name')]).toBe('Yara'); // the folder's keys, namespaced as quest.<id>.<key>
  });
  it('puts its author on the credits screen, with the quest and the character', () => {
    expect(content().credits).toContainEqual({ name: 'Nines sample cameo', for: [`quest:${ID}`, 'npc:yara'] });
  });
});

describe("it's always DNS", () => {
  it('fails at the start: db.internal resolves to the old server', () => {
    const s = session(scenario());
    expect(sh(s, 'systemctl status invoice-api')).toMatch(/Active: failed/);
    expect(sh(s, 'journalctl -u invoice-api')).toMatch(/db.internal resolved to 10.0.4.12/);
    expect(sh(s, 'cat /etc/nsswitch.conf')).toMatch(/hosts:\s+files dns/);
    expect(sh(s, 'grep -r db.internal /etc')).toMatch(/\/etc\/hosts:10.0.4.12\s+db.internal/);
  });
  it('restarting without a fix fails again, and hints lead to /etc/hosts', () => {
    const s = session(scenario());
    const r = steps(s, 'systemctl status invoice-api', 'cat ~/migration.txt', 'cat /etc/resolv.conf', 'ls', 'pwd', 'systemctl restart invoice-api');
    expect(r.exit).toBe(1);
    expect(r.won).toBe(false);
    expect(r.hints).toEqual(['hint.resolved']);
    expect(steps(s, 'systemctl restart invoice-api').hints).toEqual(['hint.hosts']);
  });
  it('trying network tools it does not have gives the first hint, not the answer', () => {
    const s = session(scenario());
    expect(run(s, 'dig db.internal').hints).toEqual([]);
    expect(run(s, 'ping db-02').hints).toEqual([]);
    expect(run(s, 'nslookup db.internal').hints).toEqual(['hint.status']);
  });
  it('is won by removing the stale line and restarting', () => {
    const s = session(scenario());
    const fixed = hosts(s)
      .split('\n')
      .filter((l) => !l.includes('db.internal'))
      .join('\n');
    saveFile(s, HOSTS, fixed);
    const r = run(s, 'systemctl restart invoice-api');
    expect(r.exit).toBe(0);
    expect(r.won).toBe(true);
    expect(r.events).toEqual([]);
    expect(sh(s, 'journalctl -u invoice-api -n 4')).toMatch(/resolved to 10.0.4.30/);
  });
  it('commenting the stale line out works too, as on a real machine', () => {
    const s = session(scenario());
    saveFile(s, HOSTS, hosts(s).replace('10.0.4.12', '# 10.0.4.12'));
    expect(run(s, 'systemctl restart invoice-api').won).toBe(true);
  });
  it('pinning the new address works too, with a word about why that is fragile once it runs', () => {
    const s = session(scenario());
    expect(saveFile(s, HOSTS, hosts(s).replace('10.0.4.12', '10.0.4.30')).events).toEqual([]);
    const r = run(s, 'systemctl restart invoice-api');
    expect(r.won).toBe(true);
    expect(r.events.map((e) => e.id)).toEqual(['pinned-again']);
  });
  it('a wrong address does not fix it, nor a new line while the stale one stays', () => {
    for (const edit of [
      (h: string) => h.replace('10.0.4.12', '10.0.4.31'),
      (h: string) => h.replace('10.0.4.12', '10.0.4.300'),
      (h: string) => h + '10.0.4.30   db.internal\n',
    ]) {
      const s = session(scenario());
      saveFile(s, HOSTS, edit(hosts(s)));
      const r = run(s, 'systemctl restart invoice-api');
      expect(r.exit).toBe(1);
      expect(r.events).toEqual([]);
    }
  });
  it('dropping localhost starts the API but does not win: the box still needs its own names', () => {
    const s = session(scenario());
    saveFile(s, HOSTS, '127.0.1.1   api-02\n');
    const r = run(s, 'systemctl restart invoice-api');
    expect(r.exit).toBe(0);
    expect(r.objectives.map((o) => o.done)).toEqual([true, false]);
    expect(r.won).toBe(false);
  });
  it('deleting all of /etc/hosts is explained, and the machine is restored', () => {
    const s = session(scenario());
    const r = run(s, `rm ${HOSTS}`);
    expect(r.events.map((e) => e.id)).toEqual(['hosts-gone']);
    expect(s.state.fs[HOSTS]).toBeDefined();
    expect(r.won).toBe(false);
  });
});
