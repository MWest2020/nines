// The three MVP quests, played through the real content files. These are the proof that each
// quest can be completed in the simulator; the device check comes with the MVP build.

import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { run, saveFile } from '../../src/sim/session';
import { content, session, sh, steps } from '../helpers';

const scenario = (id: string): ScenarioSpec => {
  const q = content().quests.find((x) => x.id === id);
  if (!q?.scenario) throw new Error(`no terminal quest ${id}`);
  return q.scenario;
};

describe('content bundle', () => {
  it('has the three MVP quests with both languages', () => {
    const b = content();
    // at least these three: a guest cameo is one more folder, and these tests stay as they are
    expect(b.quests.filter((q) => q.scenario).map((q) => q.id)).toEqual(expect.arrayContaining(['broken-pipeline', 'disk-full', 'service-down']));
    for (const q of b.quests) {
      expect(b.locales.en[questKey(q.id, q.quest.title)]).toBeTruthy();
      expect(b.locales.nl[questKey(q.id, q.quest.title)]).toBeTruthy();
    }
    expect(b.credits).toEqual(expect.arrayContaining([{ name: 'Nines team', for: expect.arrayContaining(['quest:disk-full', 'npc:femke']) }]));
  });
});

describe('disk full', () => {
  it('starts above 80% and is won by removing the rotated logs', () => {
    const s = session(scenario('disk-full'));
    expect(sh(s, 'df -h /var').split('\n')[1]).toMatch(/ 95% \/var$/);
    const r = steps(s, 'du -sh /var/*', 'cd /var/log/nginx', 'ls', 'rm *.gz');
    expect(r.won).toBe(true);
    expect(r.justWon).toBe(true);
    expect(r.objectives.every((o) => o.done)).toBe(true);
  });
  it('can also be won by removing the forgotten debug log', () => {
    const s = session(scenario('disk-full'));
    expect(run(s, 'rm /var/log/shop/debug.log').won).toBe(true);
  });
  it('deleting the database costs money and restores the machine', () => {
    const s = session(scenario('disk-full'));
    const r = run(s, 'rm -r /var/lib/postgresql');
    expect(r.events).toEqual([{ id: 'database-gone', say: 'event.database_gone', scope: 'quest', money: -150, karma: 0, reset: true }]);
    expect(s.state.fs['/var/lib/postgresql/16/main/base.dat']).toBeDefined();
    expect(r.won).toBe(false);
  });
  it('gives hints to a player who is stuck', () => {
    const s = session(scenario('disk-full'));
    expect(steps(s, 'ls', 'pwd', 'cat NOTES.txt').hints).toEqual(['hint.df']);
  });
});

describe('broken pipeline', () => {
  const FIXED = 'stages:\n  - build\n  - test\n\nbuild:\n  stage: build\n  script:\n    - npm ci\n    - npm run build\n\ntest:\n  stage: test\n  needs: [build]\n  script:\n    - npm test\n';

  it('the file is invalid at the start, for the reason the log gives', () => {
    const s = session(scenario('broken-pipeline'));
    const opened = run(s, 'edit .nines-ci.yml');
    expect(opened.ui?.editor?.path).toBe('/home/dev/shop/.nines-ci.yml');
    expect(opened.objectives.find((o) => o.id === 'valid')?.done).toBe(false);
    expect(sh(s, 'cat ci-last-run.log')).toMatch(/line 15: Tabs are not allowed/);
  });
  it('fixing only the tab still fails on the stage typo', () => {
    const s = session(scenario('broken-pipeline'));
    const tabFixed = FIXED.replace('stage: test', 'stage: tset');
    saveFile(s, '/home/dev/shop/.nines-ci.yml', tabFixed);
    const r = steps(s, 'git add .nines-ci.yml', 'git commit -m "fix tabs"');
    expect(r.out).toContain('ci:   - job "test": stage "tset" is not in stages');
    expect(r.won).toBe(false);
  });
  it('is won by fixing the file, then add and commit', () => {
    const s = session(scenario('broken-pipeline'));
    expect(saveFile(s, '/home/dev/shop/.nines-ci.yml', FIXED).objectives.map((o) => o.done)).toEqual([true, false]);
    const r = steps(s, 'git status', 'git add .nines-ci.yml', 'git commit -m "fix pipeline"');
    expect(r.out.at(-1)).toBe('ci: pipeline #42 passed');
    expect(r.won).toBe(true);
  });
});

describe('service down', () => {
  it('restarting without a fix fails and points at the logs', () => {
    const s = session(scenario('service-down'));
    const r = run(s, 'systemctl restart nginx');
    expect(r.exit).toBe(1);
    expect(r.hints).toEqual(['hint.journal']);
    expect(sh(s, 'journalctl -u nginx | grep emerg')).toMatch(/unknown directive "listn" in \/etc\/nginx\/conf.d\/shop.conf:2/);
  });
  it('is won by fixing the typo and restarting', () => {
    const s = session(scenario('service-down'));
    const conf = run(s, 'edit /etc/nginx/conf.d/shop.conf').ui!.editor!;
    saveFile(s, conf.path, conf.content.replace('listn', 'listen'));
    const r = run(s, 'sudo systemctl restart nginx');
    expect(r.exit).toBe(0);
    expect(r.won).toBe(true);
    expect(sh(s, 'systemctl status nginx').split('\n')[2]).toBe('     Active: active (running)');
  });
  it('deleting the config is allowed, with a word of warning', () => {
    const s = session(scenario('service-down'));
    const r = run(s, 'rm /etc/nginx/conf.d/shop.conf');
    expect(r.events.map((e) => e.id)).toEqual(['config-gone']);
    saveFile(s, '/etc/nginx/conf.d/shop.conf', 'server {\n  listen 80;\n}\n');
    expect(run(s, 'systemctl restart nginx').won).toBe(true);
  });
});
