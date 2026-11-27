// Mark's first playtest (27 Nov 2026), item by item, on the real content: the bakery's commit,
// the guest logout and the borrowed library card on the vending job, Ans's desk, and the replay
// rules behind "Practice again".

import { describe, expect, it } from 'vitest';
import { applyChoice } from '../../src/core/choice';
import { completeQuest, finishHustle, type Rules, startQuest } from '../../src/core/game';
import { type GameState, newGame } from '../../src/core/save';
import { conversation } from '../../src/core/talk';
import { hintOffer, takeHint } from '../../src/core/tokens';
import { createSession, run, saveFile, type Session } from '../../src/sim/session';
import { content, sh, t } from '../helpers';

const scenario = (id: string) => content().quests.find((q) => q.id === id)!.scenario!;
const open = (id: string, flags: Record<string, boolean> = {}): Session => createSession(scenario(id), { t, flags });
const rules = (): Rules => content();

describe('the bakery: the rules say commit, and now you can', () => {
  it('git from the home directory names the repository; git -C, log, diff and commit work', () => {
    const s = open('bakery-hotfix');
    expect(sh(s, 'git status')).toBe('fatal: not a git repository (or any of the parent directories): .git\n(The repository on this machine is /srv/bakery: cd there first, or use git -C /srv/bakery status.)');
    expect(sh(s, 'git -C /srv/bakery status')).toBe('On branch main\nnothing to commit, working tree clean');
    expect(sh(s, 'git -C /srv/bakery log --oneline')).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) Initial import$/);
    saveFile(s, '/srv/bakery/prices.yaml', '# prices in euros, with a dot\nbread: 3.20\ncroissant: 1.80\napple_pie: 14.50\n');
    run(s, 'cd /srv/bakery');
    expect(sh(s, 'git diff')).toBe(['diff --git a/prices.yaml b/prices.yaml', '--- a/prices.yaml', '+++ b/prices.yaml', '@@ -1,4 +1,4 @@', ' # prices in euros, with a dot', ' bread: 3.20', '-croissant: 1,80', '+croissant: 1.80', ' apple_pie: 14.50'].join('\n'));
    expect(run(s, 'systemctl restart bakery-shop').exit).toBe(0);
    saveFile(s, '/home/dev/changes/CHG-1042.txt', 'What: croissant 1,80 -> 1.80\nWhy: the shop refused to start\nRollback: git revert\n');
    run(s, 'git add prices.yaml');
    expect(sh(s, 'git diff --staged --name-only')).toBe('prices.yaml');
    const r = run(s, 'git commit -m "prices: a dot, not a comma"');
    expect(r.out[0]).toMatch(/^\[main [0-9a-f]{7}\] prices: a dot, not a comma$/);
    expect(r.justWon).toBe(true);
    expect(sh(s, 'git log --oneline')).toMatch(/^[0-9a-f]{7} \(HEAD -> main\) prices: a dot, not a comma\n[0-9a-f]{7} Initial import$/);
  });
  it('git restore undoes a working-tree change', () => {
    const s = open('bakery-hotfix');
    saveFile(s, '/srv/bakery/prices.yaml', 'oops\n');
    run(s, 'cd /srv/bakery');
    run(s, 'git restore prices.yaml');
    expect(sh(s, 'cat prices.yaml')).toMatch(/croissant: 1,80/);
    expect(sh(s, 'git status')).toMatch(/working tree clean/);
  });
});

describe('the vending job: logging the guest out', () => {
  it('who, w and last show the kiosk login; logout signs the card out and the kiosk logs back in anonymously', () => {
    const s = open('vending-prices');
    expect(sh(s, 'who')).toBe('guest    pts/0        2026-11-26 08:58 (library card 4417)');
    expect(sh(s, 'w')).toMatch(/guest +pts\/0 +library card 441/);
    expect(sh(s, 'last')).toMatch(/guest +pts\/0 +library card 441 +Thu Nov 26 08:58 +still logged in\nguest +pts\/0 +library card 229 +Thu Nov 26 07:40 +- 08:12/);
    expect(run(s, 'pwd').risk!.factors.map((f) => f.id)).toEqual(['signed-in']);
    const r = run(s, 'logout');
    expect(r.out).toEqual(['Signed out: library card 4417. The kiosk logs you straight back in as kiosk (anonymous).']);
    expect(r.ui?.close).toBeUndefined(); // the shell stays: a kiosk logs you back in
    expect(r.risk!.factors).toEqual([]);
    expect(sh(s, 'who')).toMatch(/^guest +pts\/0 .*\(kiosk \(anonymous\)\)$/);
    // the anonymous kiosk shell is still yours; logging out of it leaves the terminal
    expect(run(s, 'logout').ui?.close).toBe(true);
  });
  it('kill <pid> or pkill -u guest ends the card session too', () => {
    const a = open('vending-prices');
    const pid = /^ +(\d+) pts\/0 .* bash$/m.exec(sh(a, 'ps'))![1]!;
    expect(sh(a, `kill -9 ${pid}`)).toMatch(/^Signed out: library card 4417/);
    expect(a.state.logins.find((l) => l.id === 'card')!.active).toBe(false);
    const b = open('vending-prices');
    expect(sh(b, 'pkill -u guest')).toMatch(/^Signed out: library card 4417/);
    expect(sh(b, 'ps aux')).toMatch(/guest .* -bash/); // the anonymous shell
    const c = open('vending-prices');
    expect(sh(c, 'pkill -t pts/0')).toMatch(/^Signed out/);
  });
  it('/etc, /etc/passwd and last are there now', () => {
    const s = open('vending-prices');
    expect(sh(s, 'grep guest /etc/passwd')).toBe('guest:x:1000:1000:guest:/home/guest:/bin/bash');
    expect(sh(s, 'ls /etc')).toMatch(/passwd/);
  });
});

describe("Ans's desk: the borrowed card (social engineering as a game choice)", () => {
  const game = (quests: Record<string, 'active' | 'done'> = {}): GameState => ({ ...newGame('en', 7), quests: { ...newGame('en', 7).quests, ...quests } });

  it('offers the choice only while the vending job is on offer or under way', () => {
    const idle = conversation(game({ 'vending-prices': 'done' }), content(), 'ans')!;
    expect(idle.choices).toBeUndefined();
    expect(idle.lines).toEqual(['npc.ans.idle.1', 'npc.ans.legal.1']);
    const g = startQuest(game(), rules(), 'vending-prices');
    expect(g.ok).toBe(true);
    const c = conversation(g.game, content(), 'ans')!;
    expect(c.choices!.map((x) => x.text)).toEqual(['npc.ans.choice.pocket', 'npc.ans.choice.hand_in', 'npc.ans.choice.leave']);
    expect(c.choices![0]).toMatchObject({ karma: -10, setFlag: 'borrowed-card' });
  });
  it('pocketing it costs karma and sets the flag; handing it in raises karma once and points to the legal way', () => {
    const g = startQuest(game(), rules(), 'vending-prices').game;
    const c = conversation(g, content(), 'ans')!;
    const pocket = applyChoice(g, rules(), c.choices![0]!);
    expect(pocket.karma).toBe(-10);
    expect(pocket.game.flags['borrowed-card']).toBe(true);
    expect(conversation(pocket.game, content(), 'ans')!.lines).toEqual(['npc.ans.missing.1', 'npc.ans.missing.2']);
    const hand = applyChoice(g, rules(), c.choices![1]!);
    expect(hand.karma).toBe(5);
    expect(conversation(hand.game, content(), 'ans')!.choices).toBeUndefined();
    expect(conversation(hand.game, content(), 'ans')!.lines).toContain('npc.ans.legal.1');
  });
  it('carried into the job: the kiosk shows the borrowed card and the heat drops', () => {
    const s = open('vending-prices', { 'borrowed-card': true });
    expect(sh(s, 'who')).toMatch(/\(library card 2291\)$/);
    const own = open('vending-prices').state;
    expect(own.flags['borrowed-card']).toBeUndefined();
    expect(run(s, 'pwd').risk).toEqual({ percent: 15, factors: [{ id: 'borrowed', text: 'risk.borrowed', add: -10 }, { id: 'borrowed-signed-in', text: 'risk.borrowed_signed_in', add: 5 }] });
    expect(run(s, 'logout').risk!.percent).toBe(10);
    expect(run(open('vending-prices'), 'logout').risk!.percent).toBe(20);
  });
  it('caught with the borrowed card: the fine rises and the card is taken', () => {
    const base = { ...startQuest(game(), rules(), 'vending-prices').game, money: 1000, flags: { 'borrowed-card': true } };
    // find a seed that is caught at 95%
    let caught = null;
    for (let seed = 0; seed < 50 && !caught; seed++) {
      const r = finishHustle({ ...base, seed }, rules(), 'vending-prices', 95, { caughtFine: 150, confiscate: ['borrowed-card'] });
      if (r.ok && r.outcome === 'caught') caught = r;
    }
    expect(caught).not.toBeNull();
    expect(caught!.fine).toBe(150 + 150);
    expect(caught!.game.flags['borrowed-card']).toBeUndefined();
  });
});

describe('Practice again: the replay rules', () => {
  it('a done quest pays nothing again, its hints are free, and a fresh machine can be won again', () => {
    let g: GameState = { ...newGame('en', 3), quests: { 'service-down': 'active' } };
    const first = completeQuest(g, rules(), 'service-down');
    expect(first.ok).toBe(true);
    g = first.ok ? first.game : g;
    expect(completeQuest(g, rules(), 'service-down')).toMatchObject({ ok: false, reason: 'done' });
    expect(hintOffer(g, rules(), 'service-down', 'hint.status').kind).toBe('free');
    expect(takeHint(g, rules(), 'service-down', 'hint.status').game.tokens).toBe(g.tokens);
    // the practice run: a new session of the same scenario starts broken and is won again
    const s = open('service-down');
    expect(sh(s, 'systemctl status nginx')).toMatch(/failed/);
    saveFile(s, '/etc/nginx/conf.d/shop.conf', 'server {\n  listen 80;\n  server_name shop.example.test;\n  root /var/www/shop;\n}\n');
    expect(run(s, 'systemctl restart nginx').justWon).toBe(true);
  });
});
