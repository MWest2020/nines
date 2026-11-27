// kubectl coverage (Mark's playtest: "basic commands such as kubectl get deploy must be there"),
// on the crashloop quest's real cluster and the fixture: get for every common kind with -n, -A
// and -o wide|yaml|name; describe deploy, svc, cm and node; rollout status, history and undo;
// scale; edit through the built-in editor; delete pod; top. All of it reads and changes the same
// stored cluster model as apply (#22).

import { describe, expect, it } from 'vitest';
import { createSession, run, saveFile, type Session } from '../../src/sim/session';
import { content, FIXTURE, session, sh, t } from '../helpers';

const crashloop = (): Session => createSession(content().quests.find((q) => q.id === 'crashloop-config')!.scenario!, { t });
const FIXED = (text: string) => text.replace('LOG_LEVEL: verbose', 'LOG_LEVEL: info');

describe('kubectl get', () => {
  it('deployments, replica sets, pods, config maps, services, namespaces and nodes', () => {
    const s = crashloop();
    expect(sh(s, 'kubectl get deploy -n shop')).toBe('NAME       READY   UP-TO-DATE   AVAILABLE   AGE\nshop-api   0/2     2            0           42m');
    expect(sh(s, 'kubectl get deployments')).toBe('No resources found in default namespace.');
    expect(sh(s, 'kubectl get rs -n shop')).toMatch(/^NAME +DESIRED +CURRENT +READY +AGE\nshop-api-\w{9} +2 +2 +0 +42m$/);
    expect(sh(s, 'kubectl get cm -n shop')).toBe('NAME               DATA   AGE\nkube-root-ca.crt   1      30d\nshop-api-config    3      42m');
    expect(sh(s, 'kubectl get svc')).toBe('NAME         TYPE        CLUSTER-IP   EXTERNAL-IP   PORT(S)   AGE\nkubernetes   ClusterIP   10.96.0.1    <none>        443/TCP   30d');
    expect(sh(s, 'kubectl get ns')).toMatch(/^NAME +STATUS +AGE\ndefault +Active +30d\n.*\nshop +Active +42m$/s);
    expect(sh(s, 'kubectl get nodes')).toMatch(/^NAME +STATUS +ROLES +AGE +VERSION\ncp-1 +Ready +control-plane +30d +v1\.31\.2\nworker-1 /);
    expect(sh(s, 'kubectl get events -n shop')).toMatch(/Warning +BackOff +pod\/shop-api-[\w-]+ +Back-off restarting failed container/);
    expect(sh(s, 'kubectl get pods -A')).toMatch(/^NAMESPACE +NAME +READY +STATUS +RESTARTS +AGE\nshop +shop-api-/);
    expect(sh(s, 'kubectl get deploy -A')).toMatch(/^NAMESPACE +NAME +READY/);
  });
  it('-o wide, -o yaml, -o name, one object by name, get all, -l and the errors', () => {
    const s = crashloop();
    expect(sh(s, 'kubectl get pods -n shop -o wide')).toMatch(/IP +NODE\n.*10\.244\.\d\.\d+ +worker-\d/);
    expect(sh(s, 'kubectl get deploy -n shop -o wide')).toMatch(/CONTAINERS +IMAGES +SELECTOR\nshop-api .* shop-api +registry\.example\.test\/shop-api:1\.8\.0 +app=shop-api/);
    // -o yaml shows what the cluster runs: the applied manifest
    expect(sh(s, 'kubectl get cm shop-api-config -n shop -o yaml')).toMatch(/kind: ConfigMap\n.*LOG_LEVEL: verbose$/s);
    expect(sh(s, 'kubectl get configmap/shop-api-config -n shop -o yaml')).toMatch(/LOG_LEVEL: verbose/);
    expect(sh(s, 'kubectl get deploy -n shop -o name')).toBe('deployment.apps/shop-api');
    expect(sh(s, 'kubectl get deploy shop-api -n shop')).toMatch(/^NAME .*\nshop-api /);
    expect(sh(s, 'kubectl get deploy nope -n shop')).toBe('Error from server (NotFound): deployments.apps "nope" not found');
    const all = sh(s, 'kubectl get all -n shop');
    expect(all).toMatch(/^NAME +READY +STATUS .*\npod\/shop-api-/s);
    expect(all).toMatch(/\n\nNAME +READY +UP-TO-DATE .*\ndeployment\.apps\/shop-api /s);
    expect(all).toMatch(/\nreplicaset\.apps\/shop-api-/);
    expect(sh(s, 'kubectl get pods -n shop -l app=shop-api').split('\n')).toHaveLength(3);
    expect(sh(s, 'kubectl get pods -n shop -l app=other')).toBe('No resources found in shop namespace.');
    expect(sh(s, 'kubectl get secrets')).toBe('error: the server doesn\'t have a resource type "secrets"');
    expect(sh(s, 'kubectl get')).toMatch(/^You must specify the type of resource to get/);
    expect(sh(s, 'kubectl get pods -o json')).toMatch(/-o wide, -o yaml and -o name/);
  });
});

describe('kubectl describe', () => {
  it('deploy, cm, node and svc', () => {
    const s = crashloop();
    const d = sh(s, 'kubectl describe deploy shop-api -n shop');
    expect(d).toMatch(/^Name: +shop-api\nNamespace: +shop/);
    expect(d).toMatch(/Replicas: +2 desired \| 2 updated \| 2 total \| 0 available \| 2 unavailable/);
    expect(d).toMatch(/shop-api-config +ConfigMap +Optional: false/);
    expect(d).toMatch(/Available +False +MinimumReplicasUnavailable/);
    expect(sh(s, 'kubectl describe cm shop-api-config -n shop')).toMatch(/Data\n====\nDB_HOST:\n----\npostgres\.shop\.svc\.cluster\.local\n\nDB_PORT:\n----\n5432\n\nLOG_LEVEL:\n----\nverbose/);
    expect(sh(s, 'kubectl describe node worker-1')).toMatch(/^Name: +worker-1\nRoles: +<none>.*Ready +True +KubeletReady/s);
    expect(sh(s, 'kubectl describe svc kubernetes')).toMatch(/IP: +10\.96\.0\.1/);
    expect(sh(s, 'kubectl describe deploy nope -n shop')).toBe('Error from server (NotFound): deployments.apps "nope" not found');
  });
});

describe('kubectl rollout, scale, edit, delete and top', () => {
  it('rollout history counts restarts, undo rolls back, status follows the pods', () => {
    const s = crashloop();
    expect(sh(s, 'kubectl rollout history deployment/shop-api -n shop')).toBe('deployment.apps/shop-api\nREVISION   CHANGE-CAUSE\n1          <none>\n');
    expect(sh(s, 'kubectl rollout undo deployment/shop-api -n shop')).toBe('error: no rollout history found for deployment "shop-api"');
    run(s, 'kubectl rollout restart deployment/shop-api -n shop');
    expect(sh(s, 'kubectl rollout history deploy shop-api -n shop')).toMatch(/1 +<none>\n2 +<none>/);
    expect(sh(s, 'kubectl rollout undo deploy/shop-api -n shop')).toBe('deployment.apps/shop-api rolled back');
    expect(sh(s, 'kubectl rollout status deployment/shop-api -n shop')).toMatch(/^Waiting for deployment "shop-api" rollout to finish: 0 of 2/);
    expect(sh(s, 'kubectl get rs -n shop').split('\n').length).toBe(4); // the current one and two old ones at 0
  });
  it('scale changes the replicas and the pods; get deploy shows it', () => {
    const s = crashloop();
    expect(sh(s, 'kubectl scale deployment/shop-api --replicas=3 -n shop')).toBe('deployment.apps/shop-api scaled');
    expect(sh(s, 'kubectl get deploy -n shop')).toMatch(/shop-api +0\/3 +3 +0/);
    expect(sh(s, 'kubectl get pods -n shop').split('\n')).toHaveLength(4);
    run(s, 'kubectl scale deploy shop-api --replicas 1 -n shop');
    expect(sh(s, 'kubectl get pods -n shop').split('\n')).toHaveLength(2);
    expect(sh(s, 'kubectl scale deployment/shop-api -n shop')).toBe('error: required flag(s) "replicas" not set');
    expect(sh(s, 'kubectl scale deployment/shop-api --replicas=-1 -n shop')).toBe('error: invalid argument "-1" for "--replicas" flag');
    expect(sh(s, 'kubectl scale deployment/shop-api --replicas=500 -n shop')).toMatch(/whole cluster/);
    // a later rollout keeps the scaled count
    run(s, 'kubectl rollout restart deployment/shop-api -n shop');
    expect(sh(s, 'kubectl get pods -n shop').split('\n')).toHaveLength(2);
  });
  it('edit opens the cluster copy in the built-in editor; saving applies it ("edited"), cancel changes nothing', () => {
    const s = crashloop();
    const r = run(s, 'kubectl edit cm/shop-api-config -n shop');
    const ed = r.ui!.editor!;
    expect(ed.path).toMatch(/^\/tmp\/kubectl-edit-\w+\.yaml$/);
    expect(ed.content).toMatch(/^# Please edit the object below.*LOG_LEVEL: verbose\n$/s);
    const saved = saveFile(s, ed.path, FIXED(ed.content));
    expect(saved.out).toEqual(['configmap/shop-api-config edited']);
    expect(s.state.fs[ed.path]).toBeUndefined();
    expect(sh(s, 'kubectl get cm shop-api-config -n shop -o yaml')).toMatch(/LOG_LEVEL: info/);
    // the cluster now has the fix, so fresh pods start healthy (the file on disk still says verbose)
    const win = run(s, 'kubectl rollout restart deployment/shop-api -n shop');
    expect(win.justWon).toBe(true);
    // unchanged and renamed edits
    const again = run(s, 'kubectl edit configmap shop-api-config -n shop').ui!.editor!;
    expect(saveFile(s, again.path, again.content).out).toEqual(['configmap/shop-api-config skipped: no changes']);
    const renamed = run(s, 'kubectl edit cm shop-api-config -n shop').ui!.editor!;
    const bad = saveFile(s, renamed.path, renamed.content.replace('name: shop-api-config', 'name: other'));
    expect(bad.out[0]).toBe('error: At least one of apiVersion, kind and name was changed');
    // like kubectl, the editor opens again on the same text
    expect(bad.ui?.editor?.content).toMatch(/name: other/);
    expect(sh(s, 'kubectl edit cm nope -n shop')).toMatch(/not found/);
  });
  it('the crashloop quest warns about editing the cluster by hand', () => {
    const s = crashloop();
    const r = run(s, 'kubectl edit cm/shop-api-config -n shop');
    expect(r.events.map((e) => e.id)).toEqual(['hand-edit']);
  });
  it('delete pod: the Deployment makes a new one, which starts like any fresh pod', () => {
    const s = crashloop();
    const pod = s.state.pods[0]!.name;
    expect(sh(s, `kubectl delete pod ${pod} -n shop`)).toBe(`pod "${pod}" deleted`);
    expect(s.state.pods).toHaveLength(2);
    expect(s.state.pods.some((p) => p.name === pod)).toBe(false);
    expect(s.state.pods.every((p) => p.status === 'CrashLoopBackOff')).toBe(true);
    // with the fix applied, a deleted pod comes back healthy: that is how a real cluster works
    saveFile(s, '/home/dev/shop-k8s/configmap.yaml', FIXED(sh(s, 'cat /home/dev/shop-k8s/configmap.yaml') + '\n'));
    run(s, 'kubectl apply -f /home/dev/shop-k8s/configmap.yaml');
    run(s, 'kubectl delete pods --all -n shop');
    expect(s.state.pods.every((p) => p.status === 'Running')).toBe(true);
    expect(sh(s, 'kubectl delete pod nope -n shop')).toBe('Error from server (NotFound): pods "nope" not found');
    expect(sh(s, 'kubectl delete deployment shop-api -n shop')).toMatch(/won't fix its config/);
  });
  it('top shows simulated numbers; version and config work', () => {
    const s = crashloop();
    expect(sh(s, 'kubectl top pods -n shop')).toMatch(/^NAME +CPU\(cores\) +MEMORY\(bytes\)\nshop-api-\S+ +1m +9Mi/);
    expect(sh(s, 'kubectl top nodes')).toMatch(/^NAME +CPU\(cores\) +CPU\(%\) +MEMORY\(bytes\) +MEMORY\(%\)\ncp-1 +\d+m/);
    expect(sh(s, 'kubectl version')).toMatch(/Client Version: v1\.31\.2/);
    expect(sh(s, 'kubectl config current-context')).toBe('nines-cluster');
  });
  it('the fixture cluster without manifests still answers', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'kubectl get deploy')).toMatch(/^NAME +READY .*\napi +0\/1 /);
    expect(sh(s, 'kubectl get cm')).toBe('NAME               DATA   AGE\nkube-root-ca.crt   1      30d');
    expect(sh(s, 'kubectl edit deploy api')).toMatch(/^$/);
  });
});
