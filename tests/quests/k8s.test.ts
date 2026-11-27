// The first Kubernetes quest, content/quests/crashloop-config (Junior, KCNA level): shop-api
// crash-loops after a ConfigMap change. Played in the simulator: the symptom, the cause in the
// logs, the fix in the manifest, apply, and a rollout restart.

import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/content/types';
import { questKey } from '../../src/content/types';
import { run, saveFile } from '../../src/sim/session';
import { content, session, sh, steps } from '../helpers';

const ID = 'crashloop-config';
const CM = '/home/dev/shop-k8s/configmap.yaml';
const scenario = (): ScenarioSpec => {
  const q = content().quests.find((x) => x.id === ID);
  if (!q?.scenario) throw new Error(`no terminal quest ${ID}`);
  return q.scenario;
};
const cm = (s: ReturnType<typeof session>) => run(s, `edit ${CM}`).ui!.editor!.content;
const podNames = (s: ReturnType<typeof session>) => run(s, 'kubectl get pods -n shop').out.slice(1).map((l) => l.split(/\s+/)[0]!);

describe('the Kubernetes quest in the bundle', () => {
  it('is a Junior terminal quest on the Kubernetes branch, for the platform, SRE and DevOps paths', () => {
    const q = content().quests.find((x) => x.id === ID)!;
    expect(q.quest).toMatchObject({ stage: 'junior', branch: 'kubernetes', roadmap_node: 'k8s-fundamentals', paths: ['platform', 'sre', 'devops'] });
    expect(q.quest.start).toEqual({ map: 'server-room', object: 'rack-k8s-01' });
    expect(q.npc?.spawn).toMatchObject({ map: 'junior-village', slot: 'npc-5' });
    expect(content().locales.nl[questKey(ID, 'npc.name')]).toBe('Mila');
  });
});

describe('CrashLoopBackOff', () => {
  it('the pods live in the shop namespace and crash-loop', () => {
    const s = session(scenario());
    expect(sh(s, 'kubectl get pods')).toBe('No resources found in default namespace.');
    const out = run(s, 'kubectl get pods -n shop').out;
    expect(out).toHaveLength(3); // two replicas
    for (const line of out.slice(1)) expect(line).toMatch(/^shop-api-[a-z0-9]{9}-[a-z0-9]{5}\s+0\/1\s+CrashLoopBackOff\s+7\s+42m$/);
  });
  it('describe shows the back-off, the exit code and where the environment comes from; the logs say why', () => {
    const s = session(scenario());
    const [pod] = podNames(s);
    const d = sh(s, `kubectl describe pod ${pod} -n shop`);
    expect(d).toMatch(/Reason:\s+CrashLoopBackOff/);
    expect(d).toMatch(/Exit Code:\s+1/);
    expect(d).toMatch(/shop-api-config\s+ConfigMap/);
    expect(sh(s, `kubectl logs ${pod} -n shop`)).toMatch(/FATAL invalid LOG_LEVEL "verbose": must be one of debug, info, warn, error/);
    expect(sh(s, 'kubectl logs deployment/shop-api -n shop --tail=1')).toMatch(/FATAL/);
  });
  it('restarting without a fix brings new pods that crash the same way', () => {
    const s = session(scenario());
    const before = podNames(s);
    expect(sh(s, 'kubectl rollout restart deployment/shop-api -n shop')).toBe('deployment.apps/shop-api restarted');
    const after = run(s, 'kubectl get pods -n shop').out.slice(1);
    expect(after.every((l) => /CrashLoopBackOff\s+0\s+3s$/.test(l))).toBe(true);
    expect(after.map((l) => l.split(/\s+/)[0])).not.toEqual(before);
  });
  it('fixing the file without applying it changes nothing in the cluster', () => {
    const s = session(scenario());
    saveFile(s, CM, cm(s).replace('LOG_LEVEL: verbose', 'LOG_LEVEL: info'));
    const r = run(s, 'kubectl rollout restart deployment/shop-api -n shop');
    expect(r.won).toBe(false);
    expect(sh(s, 'kubectl get pods -n shop')).toMatch(/CrashLoopBackOff/);
  });
  it('applying the fix alone leaves the crashed pods crashing until a restart', () => {
    const s = session(scenario());
    saveFile(s, CM, cm(s).replace('LOG_LEVEL: verbose', 'LOG_LEVEL: info'));
    expect(sh(s, `kubectl apply -f ${CM}`)).toBe('configmap/shop-api-config configured');
    expect(run(s, 'kubectl get pods -n shop').won).toBe(false);
  });
  it('is won by fixing the manifest, applying it and restarting the rollout', () => {
    const s = session(scenario());
    saveFile(s, CM, cm(s).replace('LOG_LEVEL: verbose', 'LOG_LEVEL: "warn"'));
    expect(sh(s, 'kubectl apply -f ~/shop-k8s/')).toBe('configmap/shop-api-config configured\ndeployment/shop-api unchanged');
    const r = run(s, 'kubectl -n shop rollout restart deploy/shop-api');
    expect(r.justWon).toBe(true);
    const pods = run(s, 'kubectl get pods -n shop').out.slice(1);
    expect(pods.every((l) => /1\/1\s+Running/.test(l))).toBe(true);
    expect(sh(s, `kubectl logs ${pods[0]!.split(/\s+/)[0]} -n shop`)).toMatch(/listening on :8080/);
  });
  it('an invalid value still fails', () => {
    const s = session(scenario());
    saveFile(s, CM, cm(s).replace('LOG_LEVEL: verbose', 'LOG_LEVEL: chatty'));
    sh(s, `kubectl apply -f ${CM}`);
    expect(run(s, 'kubectl rollout restart deployment/shop-api -n shop').won).toBe(false);
  });
  it('hints walk a stuck player from the pods to the logs, the file, apply and restart', () => {
    const s = session(scenario());
    expect(steps(s, 'ls', 'pwd', 'cat ~/handover.txt').hints).toEqual(['hint.start']);
    expect(steps(s, 'kubectl get pods', 'kubectl get pods -n shop', 'ls ~/shop-k8s').hints).toEqual(['hint.logs']);
    expect(steps(s, 'kubectl logs deployment/shop-api -n shop', 'cat ~/shop-k8s/configmap.yaml', 'nope').hints).toEqual(['hint.edit']);
    saveFile(s, CM, cm(s).replace('LOG_LEVEL: verbose', 'LOG_LEVEL: info'));
    expect(steps(s, 'kubectl rollout restart deployment/shop-api -n shop').hints).toEqual(['hint.apply']);
    expect(steps(s, `kubectl apply -f ${CM}`, 'nope', 'nope').hints).toEqual(['hint.restart']);
  });
  it('deleting the manifest puts it back', () => {
    const s = session(scenario());
    const r = run(s, `rm ${CM}`);
    expect(r.events.map((e) => e.id)).toEqual(['manifest-gone']);
    expect(sh(s, `cat ${CM}`)).toMatch(/LOG_LEVEL: verbose/);
  });
});
