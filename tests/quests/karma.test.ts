// The karma quests played in the simulator on the real content files: the vending machine job
// (a hustle: careful and sloppy), the Polderbank pentest (the ethical hacker's first quest),
// community service at the Repair Café, and the bakery hotfix by the book and as a contractor.
// The game side (the roll, the fines, the multipliers) is in tests/core/karma.test.ts; here the
// risk the terminal reports goes into finishHustle as the overlay does.

import { describe, expect, it } from 'vitest';
import type { QuestEntry, ScenarioSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { applyEvent, completeQuest, finishHustle, type Rules, startQuest } from '../../src/core/game';
import { riskRoll } from '../../src/core/karma';
import { newGame } from '../../src/core/save';
import { createSession, run, type RunResult, saveFile, type Session } from '../../src/sim/session';
import { content, sh, steps, t } from '../helpers';

const quest = (id: string): QuestEntry => {
  const q = content().quests.find((x) => x.id === id);
  if (!q?.scenario) throw new Error(`no terminal quest ${id}`);
  return q;
};
const scenario = (id: string): ScenarioSpec => quest(id).scenario!;
const open = (id: string, skipProcedures = false): Session => createSession(scenario(id), { t, skipProcedures });
const editorText = (s: Session, path: string) => run(s, `edit ${path}`).ui!.editor!.content;
const rules = (): Rules => content();

describe('the karma quests in the bundle', () => {
  it('are in both languages, tagged with paths, with the kinds and gates DESIGN.md describes', () => {
    const b = content();
    const spec = (id: string) => quest(id).quest;
    expect(spec('vending-prices')).toMatchObject({ kind: 'hustle', available_when: 'karma <= 20', giver: 'vince', paths: ['ethical', 'systems'], reward: { money: 400, karma: -20 } });
    expect(spec('bank-pentest')).toMatchObject({ available_when: 'karma >= 0 && !probation', giver: 'sanne', paths: ['ethical', 'systems'], reward: { karma: 10 } });
    expect(spec('bank-pentest').kind).toBeUndefined(); // a job
    expect(spec('repair-cafe')).toMatchObject({ kind: 'service', available_when: 'probation || karma < 0', reward: { money: 0, karma: 25 } });
    expect(spec('repair-cafe').paths).toHaveLength(6);
    expect(spec('bakery-hotfix')).toMatchObject({ requires: ['disk-full'], giver: 'femke' });
    for (const id of ['vending-prices', 'bank-pentest', 'repair-cafe', 'bakery-hotfix']) {
      expect(b.locales.en[questKey(id, 'title')]).toBeTruthy();
      expect(b.locales.nl[questKey(id, 'title')]).toBeTruthy();
    }
    expect(b.locales.en['path.ethical']).toBe('Ethical Hacker');
    expect(b.locales.nl['path.ethical']).toBe('Ethical hacker');
  });
});

describe('the vending machine job (a hustle)', () => {
  /** Read the prices and drop them; `signOut` first or not. */
  function careful(signOut: boolean): { s: Session; win: RunResult } {
    const s = open('vending-prices');
    expect(sh(s, 'cat ~/job.txt')).toMatch(/Munchr Vending's 2027 prices/);
    expect(sh(s, 'ls /mnt/munchr-public')).toMatch(/internal/);
    expect(sh(s, 'cat /mnt/munchr-public/README.txt')).toMatch(/is \/internal still in here/);
    expect(sh(s, 'cat /mnt/munchr-public/internal/prices-2027.csv')).toMatch(/choco_bar,1.10,1.25/);
    if (signOut) run(s, 'rm ~/.kiosk/signed-in-as.txt');
    const drop = editorText(s, '~/drop/for-vince.txt').replace('choco_bar: ?', 'choco_bar: 1.25').replace('cola: ?', 'cola: 1.45');
    return { s, win: saveFile(s, '/home/guest/drop/for-vince.txt', drop) };
  }

  it('careful play: read only what the job needs, sign out, drop: 10% heat', () => {
    const { win } = careful(true);
    expect(win.justWon).toBe(true);
    expect(win.risk).toEqual({ percent: 10, factors: [] });
  });
  it('staying signed in with your own library card shows in the heat before the drop', () => {
    const s = open('vending-prices');
    expect(run(s, 'pwd').risk).toEqual({ percent: 30, factors: [{ id: 'signed-in', text: 'risk.signed_in', add: 20 }] });
    expect(careful(false).win.risk?.percent).toBe(30);
  });
  it('sloppy play: a recursive grep walks through HR (karma event too), failed commands beep, the file is taken', () => {
    const s = open('vending-prices');
    const r = run(s, 'grep -r choco /mnt/munchr-public');
    expect(r.out.join('\n')).toMatch(/prices-2027.csv:choco_bar,1.10,1.25/);
    expect(r.events).toEqual([{ id: 'hr', say: 'event.hr', scope: 'quest', money: 0, karma: -5, reset: false }]);
    steps(s, 'hack', 'enhance', 'mainframe'); // not commands of this terminal: three failures
    run(s, 'mv /mnt/munchr-public/internal/prices-2027.csv ~/');
    const drop = editorText(s, '~/drop/for-vince.txt').replace('?', '1.25').replace('?', '1.45');
    const win = saveFile(s, '/home/guest/drop/for-vince.txt', drop);
    expect(win.justWon).toBe(true);
    expect(win.risk?.factors.map((f) => f.id)).toEqual(['snooped', 'took', 'beeping', 'signed-in']);
    expect(win.risk?.percent).toBe(100); // the game caps it at 95 before it rolls
  });
  it('deleting the drop file resets the kiosk; the job still has to be done', () => {
    const s = open('vending-prices');
    const r = run(s, 'rm ~/drop/for-vince.txt');
    expect(r.events.map((e) => e.id)).toEqual(['drop-gone']);
    expect(sh(s, 'cat ~/drop/for-vince.txt')).toMatch(/choco_bar: \?/);
  });
  it('the risk the terminal reports goes into the roll: careful is usually clean, sloppy usually caught', () => {
    const careful10 = careful(true).win.risk!.percent;
    let clean = 0;
    let caught = 0;
    for (let seed = 0; seed < 200; seed++) {
      const g = { ...newGame('en', seed), money: 500 };
      if (finishHustle(g, rules(), 'vending-prices', careful10).ok && riskRoll(g, 'vending-prices') >= careful10) clean++;
      const r = finishHustle(g, rules(), 'vending-prices', 100);
      if (r.ok && r.outcome === 'caught') caught++;
    }
    expect(clean).toBeGreaterThan(150);
    expect(caught).toBeGreaterThan(170);
  });
});

describe('the Polderbank pentest (ethical hacker, Junior)', () => {
  const FINDING = '/home/pentest/engagement/finding-01.txt';
  const writeUp = (s: Session) =>
    editorText(s, FINDING)
      .replace('Title: ?', 'Title: directory listing exposes a database backup')
      .replace('Severity: ?', 'Severity: high')
      .replace('Where: ?', 'Where: /exports/ in /etc/nginx/sites-enabled/staging (autoindex on)')
      .replace('What anyone on the internet could do: ?', 'What anyone on the internet could do: list the folder and download db-backup-2026-11-20.sql.gz')
      .replace('Recommendation: ?', 'Recommendation: autoindex off, move the backup out of the web root, check the access log');

  it('is won by reading the scope, the config and the folder listing, and writing the finding up', () => {
    const s = open('bank-pentest');
    expect(run(s, 'cat ~/engagement/scope.txt').objectives[0]).toMatchObject({ id: 'scope', done: true });
    expect(sh(s, 'ls /etc/nginx/sites-enabled')).toMatch(/staging/);
    expect(sh(s, 'cat /etc/nginx/sites-enabled/staging')).toMatch(/location \/exports\/ \{[\s\S]*autoindex on;/);
    expect(sh(s, 'ls -lh /srv/www/staging/exports')).toMatch(/2.1G .*db-backup-2026-11-20\.sql\.gz/);
    // the access log shows someone from outside already asked for the listing
    expect(sh(s, 'grep exports /var/log/nginx/access.log')).toMatch(/203\.0\.113\.77 .*GET \/exports\/ HTTP\/1\.1" 200/);
    const r = saveFile(s, FINDING, writeUp(s));
    expect(r.events).toEqual([]);
    expect(r.justWon).toBe(true);
  });
  it('the template alone wins nothing: the severity line has to be written', () => {
    const s = open('bank-pentest');
    run(s, 'cat ~/engagement/scope.txt');
    const r = saveFile(s, FINDING, writeUp(s).replace('Severity: high', 'Severity: ?'));
    expect(r.objectives.map((o) => o.done)).toEqual([true, true, false]);
  });
  it('scope first: touching the server before reading the scope gets a word from Sanne', () => {
    const s = open('bank-pentest');
    expect(run(s, 'ls /etc/nginx').events.map((e) => e.id)).toEqual(['scope-first']);
  });
  it('out of scope: a recursive grep over /srv walks into the customer data, and that costs', () => {
    const s = open('bank-pentest');
    run(s, 'cat ~/engagement/scope.txt');
    const r = run(s, 'grep -r autoindex /srv');
    // and it read the backup on the way: grep -r opens every file below it
    expect(r.events.map((e) => [e.id, e.money, e.karma])).toEqual([['out-of-scope', -100, -10], ['opened-backup', 0, -5]]);
    // grep -r over /etc is in scope and finds the same thing
    expect(run(s, 'grep -r autoindex /etc').events).toEqual([]);
  });
  it('opening the backup is not evidence, it is a karma hit; ls -l was enough', () => {
    const s = open('bank-pentest');
    run(s, 'cat ~/engagement/scope.txt');
    expect(run(s, 'ls -l /srv/www/staging/exports').events).toEqual([]);
    expect(run(s, 'less /srv/www/staging/exports/db-backup-2026-11-20.sql.gz').events.map((e) => [e.id, e.karma])).toEqual([['opened-backup', -5]]);
  });
  it('report, do not fix: changing their config costs and is put back', () => {
    const s = open('bank-pentest');
    run(s, 'cat ~/engagement/scope.txt');
    const conf = editorText(s, '/etc/nginx/sites-enabled/staging').replace('autoindex on;', 'autoindex off;');
    const r = saveFile(s, '/etc/nginx/sites-enabled/staging', conf);
    expect(r.events.map((e) => [e.id, e.money])).toEqual([['fixed-it', -50]]);
    expect(sh(s, 'cat /etc/nginx/sites-enabled/staging')).toMatch(/autoindex on;/);
  });
  it('pays €300, 30 XP and +10 karma; a dirty record is turned away first', () => {
    const r = completeQuest(newGame('en', 1), rules(), 'bank-pentest');
    expect(r.ok && r.reward).toMatchObject({ money: 300, xp: 30, karma: 10 });
    expect(startQuest({ ...newGame('en', 1), karma: -20 }, rules(), 'bank-pentest')).toMatchObject({ ok: false, reason: 'locked' });
  });
});

describe('community service at the Repair Café', () => {
  it('is won by starting the booking page and writing in the logbook', () => {
    const s = open('repair-cafe');
    expect(sh(s, 'systemctl status booking-web')).toMatch(/Active: inactive/);
    expect(run(s, 'systemctl start booking-web').objectives.map((o) => o.done)).toEqual([true, false]);
    const log = editorText(s, '~/logbook.txt').replace('what I did: ?', 'what I did: systemctl start booking-web, it was stopped in the power cut');
    expect(saveFile(s, '/home/volunteer/logbook.txt', log).justWon).toBe(true);
  });
  it('deleting the logbook is put back', () => {
    const s = open('repair-cafe');
    expect(run(s, 'rm ~/logbook.txt').events.map((e) => e.id)).toEqual(['logbook-gone']);
    expect(sh(s, 'cat ~/logbook.txt')).toMatch(/REPAIR CAFE LOGBOOK/);
  });
  it('after an arrest, the shift is the way back to the bank', () => {
    const arrested = { ...newGame('en', 3), karma: -45, probation: true, strikes: 2 };
    expect(startQuest(arrested, rules(), 'bank-pentest').ok).toBe(false);
    const served = completeQuest(arrested, rules(), 'repair-cafe');
    expect(served.ok && served.reward.unlocked).toContain('bank-pentest');
    expect(served.game).toMatchObject({ karma: 0, probation: false, strikes: 0 });
  });
});

describe('the bakery hotfix: by the book, or as a contractor', () => {
  const fixPrices = (s: Session) => {
    expect(sh(s, 'systemctl status bakery-shop')).toMatch(/price '1,80' for croissant is not a number/);
    const prices = editorText(s, '/srv/bakery/prices.yaml').replace('croissant: 1,80', 'croissant: 1.80');
    saveFile(s, '/srv/bakery/prices.yaml', prices);
    return run(s, 'systemctl restart bakery-shop');
  };
  it('an employee fixes it, fills in the change ticket and commits the fix', () => {
    const s = open('bakery-hotfix');
    const fixed = fixPrices(s);
    expect(fixed.objectives.map((o) => [o.id, o.done, o.skipped ?? false])).toEqual([['shop', true, false], ['ticket', false, false], ['review', false, false]]);
    expect(fixed.won).toBe(false);
    const ticket = editorText(s, '~/changes/CHG-1042.txt')
      .replace('What: ?', 'What: croissant price 1,80 -> 1.80 in prices.yaml')
      .replace('Why: ?', 'Why: the shop refused to start')
      .replace('Rollback: ?', 'Rollback: git revert');
    saveFile(s, '/home/dev/changes/CHG-1042.txt', ticket);
    const r = steps(s, 'cd /srv/bakery', 'git add prices.yaml', 'git commit -m "CHG-1042: croissant price with a dot"');
    expect(r.justWon).toBe(true);
  });
  it('a contractor is done when the shop is up: the procedures are skipped', () => {
    const s = open('bakery-hotfix', true);
    const r = fixPrices(s);
    expect(r.justWon).toBe(true);
    expect(r.objectives.filter((o) => o.skipped).map((o) => o.id)).toEqual(['ticket', 'review']);
  });
  it('deleting the orders costs €120, or €360 billed to a contractor', () => {
    const s = open('bakery-hotfix', true);
    const r = run(s, 'rm /srv/bakery/data/orders.db');
    expect(r.events.map((e) => [e.id, e.money])).toEqual([['orders-gone', -120]]);
    const ev = { id: 'orders-gone', money: -120 };
    expect(applyEvent({ ...newGame('en', 1), money: 1000 }, rules(), 'bakery-hotfix', ev).money).toBe(-120);
    expect(applyEvent({ ...newGame('en', 1), money: 1000, contractor: true }, rules(), 'bakery-hotfix', ev).money).toBe(-360);
  });
  it('pays €200 on payroll, €300 as a contractor', () => {
    const base = { ...newGame('en', 1), quests: { 'disk-full': 'done' as const } };
    expect(completeQuest(base, rules(), 'bakery-hotfix')).toMatchObject({ reward: { money: 200, contract: false } });
    expect(completeQuest({ ...base, contractor: true }, rules(), 'bakery-hotfix')).toMatchObject({ reward: { money: 300, contract: true } });
  });
});
