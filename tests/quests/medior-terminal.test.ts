// Medior City's two terminal quests, played in the simulator on the real content files:
// Esra's authorised pentest of a webshop's staging site (the ethical hacker's Medior engagement)
// and Marieke's enterprise job at an insurer (a certificate renewal, by the book or as a
// contractor). The game side (paying, karma, the contractor's multipliers) runs through
// core/game.ts as in tests/quests/karma.test.ts.

import { describe, expect, it } from 'vitest';
import type { QuestEntry, ScenarioSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { applyEvent, completeQuest, type Rules, startQuest, stateOf } from '../../src/core/game';
import { newGame } from '../../src/core/save';
import { conversation } from '../../src/core/talk';
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
const ids = (r: RunResult) => r.events.map((e) => e.id);
/** A save that has reached Medior City: the gate interview is done. */
const medior = (extra: Partial<ReturnType<typeof newGame>> = {}) => ({
  ...newGame('en', 7),
  quests: { 'rate-limiter-interview': 'done' as const },
  ...extra,
});

describe('the Medior terminal quests in the bundle', () => {
  it('are in both languages, on their branches and nodes, with the gates the brief asks', () => {
    const b = content();
    const spec = (id: string) => quest(id).quest;
    expect(spec('webshop-scope')).toMatchObject({
      stage: 'medior',
      branch: 'security',
      roadmap_node: 'security-web-scope',
      paths: ['ethical'],
      requires: ['rate-limiter-interview'],
      available_when: 'path_chosen && karma >= 0 && !probation',
      giver: 'esra',
      start: { map: 'the-stack', object: 'stack-desk-pentest' },
      reward: { money: 450, xp: 50, karma: 10 },
    });
    expect(spec('insurer-cert')).toMatchObject({
      stage: 'medior',
      branch: 'linux',
      roadmap_node: 'linux-tls',
      paths: ['sre', 'systems', 'devops'],
      requires: ['rate-limiter-interview'],
      kind: 'job',
      available_when: 'karma >= 0 && !probation',
      giver: 'marieke',
      start: { map: 'the-stack', object: 'stack-rack-portal' },
      reward: { money: 500, xp: 50 },
    });
    expect(quest('webshop-scope').npc?.spawn).toMatchObject({ map: 'the-stack', slot: 'npc-2' });
    expect(quest('insurer-cert').npc?.spawn).toMatchObject({ map: 'medior-city', slot: 'npc-6' });
    for (const id of ['webshop-scope', 'insurer-cert']) {
      expect(b.locales.en[questKey(id, 'title')]).toBeTruthy();
      expect(b.locales.nl[questKey(id, 'title')]).toBeTruthy();
    }
  });
});

describe('webshop-scope: the Klompz staging pentest (ethical hacker, Medior)', () => {
  const FINDING = '/home/pentest/engagement/finding-01.txt';
  const writeUp = (s: Session, severity = 'high') =>
    editorText(s, FINDING)
      .replace('Title: ?', 'Title: debug diagnostics page open to the internet')
      .replace('Where: ?', 'Where: debug = true in /srv/staging/app/settings.ini; nginx routes /_debug/ to the app without allow/deny')
      .replace('What anyone on the internet could read: ?', 'What anyone on the internet could read: the environment, incl. PAYMENT_API_KEY and DB_PASSWORD (names from the app log; values not opened)')
      .replace('Evidence: ?', 'Evidence: staging-access.log, 198.51.100.23 and 203.0.113.9 fetched /_debug/env with 200')
      .replace('Severity: ?', `Severity: ${severity}`)
      .replace('Recommendation: ?', 'Recommendation: debug = false in staging too, remove the /_debug/ route or deny all but the office; rotate the payment key, the database password and the session secret');

  it('a careful play: scope, config, settings, logs, a finding; no secret opened, nothing changed', () => {
    const s = open('webshop-scope');
    expect(run(s, 'cat ~/engagement/scope.txt').objectives[0]).toMatchObject({ id: 'scope', done: true });
    expect(sh(s, 'ls /etc/nginx/sites-enabled')).toMatch(/staging/);
    expect(sh(s, 'cat /etc/nginx/sites-enabled/staging')).toMatch(/location \/_debug\/ \{\n\s+# allow 10\.20\.0\.0\/16;.*\n\s+# deny all;/);
    expect(sh(s, 'grep debug /srv/staging/app/settings.ini')).toMatch(/^debug = true$/m);
    // the .env is there (ls -la is evidence), but listing it does not open it
    const listing = run(s, 'ls -la /srv/staging/app');
    expect(listing.out.join('\n')).toMatch(/\.env/);
    expect(listing.events).toEqual([]);
    expect(sh(s, 'grep _debug /var/log/nginx/staging-access.log')).toMatch(/198\.51\.100\.23 .*"GET \/_debug\/env HTTP\/1\.1" 200/);
    expect(sh(s, 'cat /var/log/klompz/staging-app.log')).toMatch(/PAYMENT_API_KEY, DB_PASSWORD/);
    const r = saveFile(s, FINDING, writeUp(s));
    expect(r.events).toEqual([]);
    expect(r.objectives.map((o) => [o.id, o.done])).toEqual([
      ['scope', true],
      ['where', true],
      ['what', true],
      ['severity', true],
      ['close', true],
      ['rotate', true],
    ]);
    expect(r.justWon).toBe(true);
  });

  it('the finding is checked on key words, so a Dutch write-up wins too', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    const nl = editorText(s, FINDING)
      .replace('Where: ?', 'Where: debugmodus aan, diagnosepagina op /_debug/env')
      .replace('What anyone on the internet could read: ?', 'What anyone on the internet could read: het wachtwoord van de database')
      .replace('Severity: ?', 'Severity: hoog')
      .replace('Recommendation: ?', 'Recommendation: route afschermen, sleutels roteren');
    expect(saveFile(s, FINDING, nl).justWon).toBe(true);
  });

  it('the template alone, or a finding without a severity, wins nothing', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    expect(saveFile(s, FINDING, editorText(s, FINDING)).objectives.map((o) => o.done)).toEqual([true, false, false, false, false, false]);
    expect(saveFile(s, FINDING, writeUp(s, '?')).objectives.find((o) => o.id === 'severity')?.done).toBe(false);
  });

  it('scope first: touching the server before reading the scope gets a word from Esra', () => {
    const s = open('webshop-scope');
    expect(ids(run(s, 'cat /etc/nginx/sites-enabled/staging'))).toEqual(['scope-first']);
  });

  it('a sloppy play: a recursive grep over /srv walks into production and opens the secrets', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    const r = run(s, 'grep -r debug /srv');
    expect(r.events.map((e) => [e.id, e.money, e.karma])).toEqual([
      ['production', -150, -10],
      ['opened-secrets', 0, -5],
    ]);
    // grep -r over /etc is in scope and finds the route without either
    expect(run(s, 'grep -r _debug /etc').events).toEqual([]);
  });

  it('opening the staging .env is a karma hit; so is a recursive grep over /srv/staging, as the scope warns', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    expect(run(s, 'cat /srv/staging/app/.env').events.map((e) => [e.id, e.karma])).toEqual([['opened-secrets', -5]]);
    const g = open('webshop-scope');
    run(g, 'cat ~/engagement/scope.txt');
    expect(ids(run(g, 'grep -r debug /srv/staging'))).toEqual(['opened-secrets']);
  });

  it('production is out of scope even to list', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    expect(run(s, 'ls /srv/releases').events).toEqual([]); // the folder above it is fine
    expect(ids(run(s, 'ls /srv/releases/prod'))).toEqual(['production']);
  });

  it('report, do not fix: switching debug off or closing the route costs and is put back', () => {
    const s = open('webshop-scope');
    run(s, 'cat ~/engagement/scope.txt');
    const settings = editorText(s, '/srv/staging/app/settings.ini').replace('debug = true', 'debug = false');
    expect(saveFile(s, '/srv/staging/app/settings.ini', settings).events.map((e) => [e.id, e.money])).toEqual([['fixed-it', -75]]);
    expect(sh(s, 'grep debug /srv/staging/app/settings.ini')).toMatch(/^debug = true$/m);
    const site = editorText(s, '/etc/nginx/sites-enabled/staging').replace('# deny all;', 'deny all;');
    expect(ids(saveFile(s, '/etc/nginx/sites-enabled/staging', site))).toEqual(['fixed-it']); // armed again after a reset
  });

  it('pays €450, 50 XP and +10 karma; needs a chosen path and a clean record', () => {
    expect(stateOf(medior(), rules(), 'webshop-scope')).toBe('locked'); // no path yet
    expect(stateOf(medior({ path: 'ethical' }), rules(), 'webshop-scope')).toBe('available');
    expect(stateOf(medior({ path: 'sre' }), rules(), 'webshop-scope')).toBe('available'); // a side quest
    expect(stateOf(medior({ path: 'ethical', karma: -5 }), rules(), 'webshop-scope')).toBe('locked');
    expect(stateOf(medior({ path: 'ethical', probation: true }), rules(), 'webshop-scope')).toBe('locked');
    const r = completeQuest(medior({ path: 'ethical' }), rules(), 'webshop-scope');
    expect(r.ok && r.reward).toMatchObject({ money: 450, xp: 50, karma: 10 });
  });

  it('Esra sends a player without a path to the coach, and greets her mentees differently afterwards', () => {
    const lines = (g: ReturnType<typeof newGame>) => conversation(g, content(), 'esra')!.lines;
    expect(lines(medior())).toEqual([questKey('webshop-scope', 'npc.no_path')]);
    expect(lines(medior({ path: 'ethical', karma: -10 }))).toEqual([questKey('webshop-scope', 'npc.no_clearance')]);
    expect(conversation(medior({ path: 'swe' }), content(), 'esra')!.offer).toBe('webshop-scope');
    const done = { 'rate-limiter-interview': 'done' as const, 'webshop-scope': 'done' as const };
    expect(lines(medior({ path: 'ethical', quests: done }))).toEqual([questKey('webshop-scope', 'npc.after_mentee')]);
    expect(lines(medior({ path: 'platform', quests: done }))).toEqual([questKey('webshop-scope', 'npc.after_side')]);
  });
});

describe('insurer-cert: the enterprise job at Grachtgarant', () => {
  const SITE = '/etc/nginx/sites-enabled/portal';
  const CHG = '/home/ops/changes/CHG-2291.txt';
  const INV = '/home/ops/inventory/certificates.txt';
  const OLD_CERT = 'ssl_certificate     /etc/nginx/tls/2025/fullchain.pem;';
  const OLD_KEY = 'ssl_certificate_key /etc/nginx/tls/2025/privkey.pem;';

  /** Point the site at a certificate and a key (paths), keeping the old lines as comments. */
  const pointAt = (s: Session, cert: string, key: string) =>
    saveFile(
      s,
      SITE,
      editorText(s, SITE)
        .replace(OLD_CERT, `# ${OLD_CERT}\n    ssl_certificate ${cert};`)
        .replace(OLD_KEY, `# ${OLD_KEY}\n    ssl_certificate_key ${key};`),
    );
  const renew = (s: Session) => {
    expect(sh(s, 'cat /etc/nginx/tls/2026/README.txt')).toMatch(/fullchain\.pem\s+cert\.pem followed by chain\.pem/);
    expect(sh(s, 'grep notAfter /etc/nginx/tls/2026/checks.txt')).toMatch(/notAfter=Jun 11 23:59:59 2027 GMT/);
    expect(sh(s, `grep ssl_ ${SITE}`)).toMatch(/2025\/privkey\.pem/);
    pointAt(s, '/etc/nginx/tls/2026/fullchain.pem', '/etc/nginx/tls/2026/privkey.pem');
    return run(s, 'systemctl restart nginx');
  };
  const paperwork = (s: Session) => {
    const record = editorText(s, CHG)
      .replace('Implemented by: ?', 'Implemented by: me, 26 Nov 09:05')
      .replace('Result: ?', 'Result: nginx runs on the 2026 certificate (fullchain.pem, privkey.pem), valid until 2027-06-11')
      .replace('Rollback used: ?', 'Rollback used: no; 2025 files kept');
    saveFile(s, CHG, record);
    const inv = editorText(s, INV).replace('portal-01   2026-11-26  CHG-1874', 'portal-01   2027-06-11  CHG-2291');
    return saveFile(s, INV, inv);
  };

  it('by the book: read the change, point nginx at the 2026 pair, restart, then the record and the inventory', () => {
    const s = open('insurer-cert');
    expect(sh(s, 'cat ~/changes/CHG-2291.txt')).toMatch(/Keep those files until the new certificate is live/);
    expect(sh(s, 'ls /etc/nginx/tls/2026')).toMatch(/fullchain\.pem/);
    const live = renew(s);
    expect(live.events).toEqual([]);
    expect(live.objectives.map((o) => [o.id, o.done, o.skipped ?? false])).toEqual([
      ['live', true, false],
      ['chain', true, false],
      ['change', false, false],
      ['inventory', false, false],
    ]);
    expect(live.won).toBe(false);
    expect(sh(s, 'systemctl status nginx')).toMatch(/Active: active \(running\)/);
    const r = paperwork(s);
    expect(r.events).toEqual([]);
    expect(r.justWon).toBe(true);
    // once live, the 2025 files may go: no rollback lost any more
    expect(run(s, 'rm -r /etc/nginx/tls/2025').events).toEqual([]);
  });

  it('a contractor is done when the portal runs on the new pair: the procedures are skipped', () => {
    const s = open('insurer-cert', true);
    const r = renew(s);
    expect(r.justWon).toBe(true);
    expect(r.objectives.filter((o) => o.skipped).map((o) => o.id)).toEqual(['change', 'inventory']);
  });

  it('a new certificate with the old key fails like nginx does: key values mismatch', () => {
    const s = open('insurer-cert');
    const cert = editorText(s, SITE).replace(OLD_CERT, 'ssl_certificate     /etc/nginx/tls/2026/fullchain.pem;');
    saveFile(s, SITE, cert);
    const r = run(s, 'systemctl restart nginx');
    expect(r.exit).not.toBe(0);
    expect(r.hints).toEqual(['hint.mismatch']);
    expect(sh(s, 'systemctl status nginx')).toMatch(/SSL_CTX_use_PrivateKey\("\/etc\/nginx\/tls\/2025\/privkey\.pem"\) failed .*key values mismatch/);
    expect(sh(s, 'journalctl -u nginx --no-pager')).toMatch(/configuration file \/etc\/nginx\/nginx\.conf test failed/);
  });

  it('restarting on the old pair still works (it is valid until midnight), but wins nothing', () => {
    const s = open('insurer-cert');
    const r = run(s, 'systemctl restart nginx');
    expect(r.exit).toBe(0);
    expect(r.objectives.map((o) => o.done)).toEqual([false, false, false, false]);
  });

  it('cert.pem alone starts nginx, but the chain is incomplete: that objective stays open', () => {
    const s = open('insurer-cert');
    pointAt(s, '/etc/nginx/tls/2026/cert.pem', '/etc/nginx/tls/2026/privkey.pem');
    const r = run(s, 'systemctl restart nginx');
    expect(r.exit).toBe(0);
    expect(r.objectives.map((o) => [o.id, o.done])).toEqual([
      ['live', true],
      ['chain', false],
      ['change', false],
      ['inventory', false],
    ]);
    expect(r.hints).toEqual(['hint.chain']);
  });

  it('a sloppy play: deleting the 2025 files before the new certificate is live costs €150 and is put back', () => {
    const s = open('insurer-cert');
    const r = run(s, 'rm -r /etc/nginx/tls/2025');
    expect(r.events.map((e) => [e.id, e.money, e.reset])).toEqual([['rollback-gone', -150, true]]);
    expect(sh(s, 'ls /etc/nginx/tls/2025')).toMatch(/privkey\.pem/);
    // and it stays armed: the same mistake twice costs twice
    expect(ids(run(s, 'rm /etc/nginx/tls/2025/fullchain.pem'))).toEqual(['rollback-gone']);
  });

  it('the new private key may not leave its folder: deleted or moved, it costs €200 and a re-issue', () => {
    const s = open('insurer-cert');
    expect(run(s, 'mv /etc/nginx/tls/2026/privkey.pem /tmp/').events.map((e) => [e.id, e.money])).toEqual([['key-gone', -200]]);
    expect(sh(s, 'ls /tmp')).not.toMatch(/privkey/);
    expect(ids(run(s, 'rm /etc/nginx/tls/2026/privkey.pem'))).toEqual(['key-gone']);
    expect(ids(run(s, 'rm /etc/nginx/tls/2026/chain.pem'))).toEqual(['delivery-gone']);
  });

  it('damage is billed three times to a contractor', () => {
    const ev = { id: 'rollback-gone', money: -150 };
    expect(applyEvent({ ...medior(), money: 1000 }, rules(), 'insurer-cert', ev).money).toBe(-150);
    expect(applyEvent({ ...medior(), money: 1000, contractor: true }, rules(), 'insurer-cert', ev).money).toBe(-450);
  });

  it('pays €500 on payroll, €750 as a contractor', () => {
    expect(completeQuest(medior(), rules(), 'insurer-cert')).toMatchObject({ reward: { money: 500, xp: 50, contract: false } });
    expect(completeQuest(medior({ contractor: true }), rules(), 'insurer-cert')).toMatchObject({ reward: { money: 750, contract: true } });
  });

  it('is locked on probation or below zero karma, open with a clean record (no path needed)', () => {
    expect(stateOf(medior(), rules(), 'insurer-cert')).toBe('available');
    expect(startQuest(medior({ probation: true }), rules(), 'insurer-cert')).toMatchObject({ ok: false, reason: 'locked' });
    expect(startQuest(medior({ karma: -1 }), rules(), 'insurer-cert')).toMatchObject({ ok: false, reason: 'locked' });
    expect(startQuest(medior({ karma: 0 }), rules(), 'insurer-cert').ok).toBe(true);
    // Marieke says why herself, and points at community service
    expect(conversation(medior({ probation: true }), content(), 'marieke')!.lines).toEqual([questKey('insurer-cert', 'npc.no_clearance')]);
    expect(conversation(medior(), content(), 'marieke')!.offer).toBe('insurer-cert');
  });

  it('a few steps in, the hints point at the change record and the delivery', () => {
    const s = open('insurer-cert');
    const r = steps(s, 'ls', 'pwd', 'ls ~/alerts');
    expect(r.hints).toEqual(['hint.change']);
  });
});
