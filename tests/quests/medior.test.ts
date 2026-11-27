// Medior City (DESIGN.md, Medior City): the career coach, the mentors' first terminal quests
// (Systems: a degraded RAID; DevOps: a slow and leaky pipeline), the CKAD start (a readiness
// probe) and the city's side hustle (the car park), played in the simulator on the real content.

import { describe, expect, it } from 'vitest';
import type { QuestEntry, ScenarioSpec } from '../../src/content/types';
import { choosePath, completeQuest, finishHustle, type Rules, stateOf } from '../../src/core/game';
import { newGame } from '../../src/core/save';
import { conversation } from '../../src/core/talk';
import { createSession, run, saveFile, type Session } from '../../src/sim/session';
import { content, sh, steps, t } from '../helpers';

const quest = (id: string): QuestEntry => {
  const q = content().quests.find((x) => x.id === id);
  if (!q?.scenario) throw new Error(`no terminal quest ${id}`);
  return q;
};
const scenario = (id: string): ScenarioSpec => quest(id).scenario!;
const open = (id: string): Session => createSession(scenario(id), { t });
const editorText = (s: Session, path: string) => run(s, `edit ${path}`).ui!.editor!.content;
const rules = (): Rules => content();
const medior = (extra: Partial<ReturnType<typeof newGame>> = {}) => ({ ...newGame('en', 7), quests: { 'rate-limiter-interview': 'done' as const }, ...extra });
const specs = () => content().quests.map((q) => q.quest);

describe('Medior City: who stands where, and what opens when', () => {
  it('every path has a mentor in the city with a first quest that opens once a path is chosen', () => {
    const first: Record<string, string> = {
      swe: 'code-review',
      sre: 'error-budget',
      devops: 'pipeline-secrets',
      platform: 'golden-path',
      systems: 'degraded-raid',
      ethical: 'webshop-scope',
    };
    for (const [path, id] of Object.entries(first)) {
      const q = content().quests.find((x) => x.id === id)!;
      expect(q.quest.paths, id).toEqual([path]);
      expect(q.quest.stage, id).toBe('medior');
      expect(['medior-city', 'the-stack'], id).toContain(q.npc?.spawn.map);
      expect(stateOf(medior(), rules(), id), id).toBe('locked');
      const chosen = choosePath(medior(), rules(), path);
      if (!chosen.ok) throw new Error(chosen.reason);
      expect(stateOf(chosen.game, rules(), id), id).toBe('available');
    }
    // every path id in the roadmap is covered
    expect(Object.keys(first).sort()).toEqual(rules().roadmap.paths.map((p) => p.id).sort());
  });
  it('Joyce, the career coach, introduces the paths, then names the mentor of the one chosen', () => {
    const npc = content().npcs.find((n) => n.id === 'joyce')!;
    expect(npc).toMatchObject({ role: 'coach', spawn: { map: 'medior-city', slot: 'npc-1' } });
    expect(conversation(medior(), content(), 'joyce')?.lines).toEqual(['npc.joyce.intro.1', 'npc.joyce.intro.2']);
    for (const p of rules().roadmap.paths) {
      const lines = conversation(medior({ path: p.id }), content(), 'joyce')!.lines;
      expect(lines).toEqual([`npc.joyce.mentor.${p.id}`, 'npc.joyce.again']);
    }
    expect(content().npcs.filter((n) => n.role === 'coach')).toHaveLength(1);
  });
  it('the URL shortener moved from the gate to Hugo, and Ingrid keeps the gate', () => {
    expect(content().quests.find((q) => q.id === 'url-shortener')?.npc?.spawn.map).toBe('medior-city');
    expect(content().quests.find((q) => q.id === 'rate-limiter-interview')?.npc?.spawn).toMatchObject({ map: 'junior-village', slot: 'gate-medior' });
  });
});

describe('Systems: one disk left (degraded-raid)', () => {
  const ticket = '/home/dev/tickets/DC-REQUEST.txt';
  it('is solved by reading mdstat and SMART, checking the backup and naming the failed disk by serial', () => {
    const s = open('degraded-raid');
    expect(sh(s, 'cat /proc/mdstat')).toMatch(/sdb1\[1\]\(F\).*\n.*\[2\/1\] \[U_\]/);
    expect(sh(s, 'grep -i serial ~/disks/smart-sdb.txt')).toBe('Serial Number:    WD-WCC4E9X8Y7Z6');
    // naming the device is not enough: remote hands cannot see "sdb"
    let r = saveFile(s, ticket, editorText(s, ticket).replace('Bay:', 'Bay: sdb'));
    expect(r.won).toBe(false);
    r = saveFile(s, ticket, editorText(s, ticket).replace('Serial of the disk to pull:', 'Serial of the disk to pull: WD-WCC4E9X8Y7Z6'));
    expect(r.objectives.filter((o) => o.done).map((o) => o.id)).toEqual(['serial', 'healthy']);
    expect(run(s, 'tail -n 2 /var/log/backup.log').won).toBe(true);
  });
  it('the healthy disk on the request is refused, and wiping the share costs money and is undone', () => {
    const s = open('degraded-raid');
    sh(s, 'cat /var/log/backup.log');
    const both = saveFile(s, ticket, editorText(s, ticket).replace('Serial of the disk to pull:', 'Serial of the disk to pull: WD-WCC4E9X8Y7Z6 WD-WCC4E1A2B3C4'));
    expect(both.won).toBe(false);
    expect(both.events.map((e) => e.id)).toEqual(['wrong-disk']);
    const t2 = open('degraded-raid');
    const wipe = run(t2, 'rm /srv/share/README.txt');
    expect(wipe.events).toMatchObject([{ id: 'share-gone', money: -100 }]);
    expect(sh(t2, 'ls /srv/share')).toBe('README.txt');
  });
});

describe('DevOps: slow and leaky (pipeline-secrets)', () => {
  const ci = '/home/dev/payments-web/.nines-ci.yml';
  const fixed = (text: string) =>
    text
      .replace('  script:\n    - npm ci\n', '  cache:\n    key: package-lock.json\n    paths: [.npm]\n  script:\n    - npm ci --cache .npm --prefer-offline\n')
      .replace('  script:\n    - DEPLOY_TOKEN=dpl_live_7f3a9c21e8b44d06 ./deploy.sh\n', '  secrets: [DEPLOY_TOKEN]\n  script:\n    - ./deploy.sh\n');
  it('is solved by a secret from the store, a cache on the lockfile, a green commit and a revocation request', () => {
    const s = open('pipeline-secrets');
    expect(sh(s, 'cat ci-last-run.log')).toContain('no cache');
    const text = fixed(editorText(s, ci));
    expect(text).not.toContain('dpl_live');
    let r = saveFile(s, ci, text);
    expect(r.objectives.filter((o) => !o.done).map((o) => o.id)).toEqual(['green', 'revoke']);
    r = steps(s, 'git add .nines-ci.yml', 'git commit -m "ci: secrets and cache"');
    expect(r.out.join('\n')).toMatch(/passed/);
    expect(r.won).toBe(false);
    r = saveFile(s, '/home/dev/ops/revoke-request.txt', `${editorText(s, '/home/dev/ops/revoke-request.txt')}dpl_live_7f3a9c21e8b44d06\n`);
    expect(r.won).toBe(true);
  });
  it('a token pasted into the secrets list fails CI; a cache keyed on package.json gets a word from Ruben', () => {
    const s = open('pipeline-secrets');
    const bad = editorText(s, ci).replace('  script:\n    - DEPLOY_TOKEN=dpl_live_7f3a9c21e8b44d06 ./deploy.sh\n', '  secrets: [dpl_live_7f3a9c21e8b44d06]\n  script:\n    - ./deploy.sh\n');
    saveFile(s, ci, bad);
    const r = steps(s, 'git add .nines-ci.yml', 'git commit -m "oops"');
    expect(r.out.join('\n')).toMatch(/must be an upper-case name/);
    const t2 = open('pipeline-secrets');
    const key = saveFile(t2, ci, fixed(editorText(t2, ci)).replace('key: package-lock.json', 'key: package.json'));
    expect(key.events.map((e) => e.id)).toEqual(['package-json-key']);
    expect(key.objectives.find((o) => o.id === 'cache')?.done).toBe(false);
  });
});

describe('CKAD: not ready (readiness-probe)', () => {
  const dep = '/home/dev/invoice-k8s/deployment.yaml';
  it('Running but 0/1: describe shows the 404, the fix in the manifest rolls out by itself on apply', () => {
    const s = open('readiness-probe');
    expect(run(s, 'kubectl get pods -n billing').out[1]).toMatch(/0\/1\s+Running/);
    expect(sh(s, 'kubectl describe pods -n billing')).toMatch(/Readiness probe failed: HTTP probe failed with statuscode: 404/);
    expect(sh(s, 'kubectl logs deployment/invoice-api -n billing')).toMatch(/readiness on \/readyz/);
    // saving alone changes nothing in the cluster
    let r = saveFile(s, dep, editorText(s, dep).replace('path: /healthz', 'path: /readyz'));
    expect(r.won).toBe(false);
    expect(sh(s, 'kubectl apply -f ~/invoice-k8s/deployment.yaml')).toBe('deployment.apps/invoice-api configured');
    expect(run(s, 'kubectl get pods -n billing').out.slice(1).every((l) => /1\/1\s+Running/.test(l))).toBe(true);
    r = run(s, 'kubectl rollout status deployment/invoice-api -n billing');
    expect(r.out).toEqual(['deployment "invoice-api" successfully rolled out']);
    expect(r.won).toBe(true);
  });
  it('a wrong path stays NotReady; deleting the probe makes the pods Ready but does not finish the job', () => {
    const s = open('readiness-probe');
    saveFile(s, dep, editorText(s, dep).replace('path: /healthz', 'path: /health'));
    sh(s, 'kubectl apply -f ~/invoice-k8s');
    expect(run(s, 'kubectl get pods -n billing').out[1]).toMatch(/0\/1\s+Running/);
    const t2 = open('readiness-probe');
    const text = editorText(t2, dep).replace(/ {10}readinessProbe:\n(?: {12}.*\n)+/, '');
    expect(text).not.toContain('readinessProbe');
    saveFile(t2, dep, text);
    const r = run(t2, 'kubectl apply -f ~/invoice-k8s/deployment.yaml');
    expect(r.events.map((e) => e.id)).toEqual(['probe-removed']);
    expect(r.objectives.map((o) => [o.id, o.done])).toEqual([
      ['ready', true],
      ['probe', false],
    ]);
  });
});

describe('the car park (parking-garage, a hustle)', () => {
  const allow = '/home/service/exits/allow.txt';
  it('is only for players who already went shady (karma -20 or below), and Mo does not know anyone cleaner', () => {
    expect(stateOf(medior(), rules(), 'parking-garage')).toBe('locked');
    expect(stateOf(medior({ karma: -20 }), rules(), 'parking-garage')).toBe('available');
    expect(conversation(medior({ karma: 0 }), content(), 'mo')?.lines).toEqual(['quest.parking-garage.npc.too_clean']);
  });
  it('careful: camera off, nothing snooped, signed out: 25%; sloppy hits the cap', () => {
    const s = open('parking-garage');
    sh(s, 'cat ~/README.txt');
    saveFile(s, '/home/service/camera/settings.txt', 'recording: off\nview: pay station and barrier\n');
    sh(s, 'rm ~/.session/technician.txt');
    const win = saveFile(s, allow, `${editorText(s, allow)}MO-554-X\n`);
    expect(win.won).toBe(true);
    expect(win.risk).toEqual({ percent: 25, factors: [{ id: 'camera-off', text: 'risk.camera_off', add: 5 }] });
    const t2 = open('parking-garage');
    const peek = run(t2, 'cat ~/log/payments.log');
    expect(peek.events).toMatchObject([{ id: 'payments', karma: -5 }]);
    const sloppy = saveFile(t2, allow, `${editorText(t2, allow)}MO-554-X\n`);
    expect(sloppy.risk?.factors.map((f) => f.id)).toEqual(['camera', 'snooped', 'session']);
    expect(sloppy.risk?.percent).toBe(80);
  });
  it('pays like a hustle: clean pays €400 and karma -15, caught fines; a job like this is never completed directly', () => {
    const g = medior({ karma: -20, quests: { 'rate-limiter-interview': 'done', 'parking-garage': 'active' } });
    expect(completeQuest(g, rules(), 'parking-garage')).toMatchObject({ ok: false, reason: 'hustle' });
    const clean = finishHustle(g, rules(), 'parking-garage', 0);
    expect(clean).toMatchObject({ ok: true, outcome: 'clean', reward: { money: 400, karma: -15 } });
    const caught = finishHustle({ ...g, money: 1000 }, rules(), 'parking-garage', 95);
    if (caught.ok && caught.outcome === 'caught') expect(caught.fine).toBe(150);
    expect(specs().find((q) => q.id === 'parking-garage')?.kind).toBe('hustle');
  });
});
