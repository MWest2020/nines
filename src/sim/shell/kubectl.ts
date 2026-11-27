// kubectl against the simulated cluster: the scenario's Deployments and their pods (SimState.pods),
// the objects the cluster runs (SimState.cluster: the manifests last applied, #22), each
// Deployment's replicas and revisions (SimState.rollouts), and a fixed three-node cluster.
//
// get (pods, deployments, services, namespaces, events, configmaps, replicasets, nodes, all;
// -n, -A, -o wide|yaml|name, -l app=x), describe (pod, deployment, service, configmap, node),
// logs, apply -f, rollout restart|status|history|undo, scale, edit (the built-in editor on a
// temporary file; saving applies it, src/sim/session.ts saveFile), delete pod (its Deployment makes
// a new one) and top (simulated numbers). Output follows the real tool's columns and wording.
// Deterministic: names, addresses and numbers come from hashes, never from a clock or dice.

import type { DeploymentSpec } from '../../content/types';
import { test } from '../../rules/expr';
import { own, setOwn } from '../../rules/own';
import { manifestId, manifestValue, objectKey, resourceName, significant } from '../manifest';
import { join } from '../path';
import { makePods, podSuffix, type Pod, type SimState } from '../state';
import { listDir } from '../vfs';
import { pidOf } from '../base';
import { abs, type CmdResult, type Command, type Ctx, fail, flags, isResult, ok, USAGE } from './util';

type Kind = 'pods' | 'deployments' | 'services' | 'namespaces' | 'events' | 'configmaps' | 'replicasets' | 'nodes' | 'all';

const KINDS: Record<string, Kind> = {
  po: 'pods', pod: 'pods', pods: 'pods',
  deploy: 'deployments', deployment: 'deployments', deployments: 'deployments', 'deployment.apps': 'deployments',
  svc: 'services', service: 'services', services: 'services',
  ns: 'namespaces', namespace: 'namespaces', namespaces: 'namespaces',
  ev: 'events', event: 'events', events: 'events',
  cm: 'configmaps', configmap: 'configmaps', configmaps: 'configmaps',
  rs: 'replicasets', replicaset: 'replicasets', replicasets: 'replicasets', 'replicaset.apps': 'replicasets',
  no: 'nodes', node: 'nodes', nodes: 'nodes',
  all: 'all',
};

/** The cluster key's kind for an object kind ("configmap/shop/x"). */
const CLUSTER_KIND: Partial<Record<Kind, string>> = { configmaps: 'configmap', services: 'service', deployments: 'deployment' };
const API_NAME: Record<Kind, string> = {
  pods: 'pod', deployments: 'deployment.apps', services: 'service', namespaces: 'namespace', events: 'event',
  configmaps: 'configmap', replicasets: 'replicaset.apps', nodes: 'node', all: 'all',
};

const NODES = [
  { name: 'cp-1', role: 'control-plane', ip: '10.0.10.11' },
  { name: 'worker-1', role: '<none>', ip: '10.0.10.21' },
  { name: 'worker-2', role: '<none>', ip: '10.0.10.22' },
] as const;
const K8S_VERSION = 'v1.31.2';
const SYSTEM_NAMESPACES = ['default', 'kube-node-lease', 'kube-public', 'kube-system'];

/** "kind/name" or "kind name": the kind (canonical) and the name, if given. */
function target(rest: string[], at: number): { kind: Kind | null; raw: string; name?: string } {
  const word = rest[at] ?? '';
  const slash = word.indexOf('/');
  if (slash > 0) {
    const kind = own(KINDS, word.slice(0, slash).toLowerCase()) ?? null;
    return { kind, raw: word.slice(0, slash), name: word.slice(slash + 1) };
  }
  const kind = own(KINDS, word.toLowerCase()) ?? null;
  const name = rest[at + 1];
  return name === undefined ? { kind, raw: word } : { kind, raw: word, name };
}

/** Columns padded like kubectl's tabwriter: three spaces after the widest cell. */
function table(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]! + 3))).join('').trimEnd());
}

const nsOf = (spec: DeploymentSpec | undefined): string => spec?.namespace ?? 'default';
const deployNames = (ctx: Ctx, ns: string | null): string[] =>
  Object.keys(ctx.spec.deployments ?? {}).filter((n) => ns === null || nsOf(own(ctx.spec.deployments, n)) === ns).sort();
const podsOf = (ctx: Ctx, name: string): Pod[] => ctx.s.pods.filter((p) => p.deployment === name);
const ready = (p: Pod): boolean => p.status === 'Running';
/** A pod whose readiness probe fails runs, but is not ready: Running, READY 0/1. */
const shownStatus = (p: Pod): string => (p.status === 'NotReady' ? 'Running' : p.status);
const nodeOf = (p: Pod) => NODES[1 + (pidOf(p.name, 0, 2) % 2)]!;
const podIp = (p: Pod): string => (p.status === 'Pending' ? '<none>' : `10.244.${1 + (pidOf(p.name, 0, 2) % 2)}.${pidOf(p.name, 2, 250)}`);
const clusterIp = (key: string): string => `10.96.${pidOf(key, 1, 250)}.${pidOf(`${key}#`, 2, 250)}`;

/** Cluster objects of one kind: [namespace, name, manifest text]. */
function objects(ctx: Ctx, kind: string, ns: string | null): [string, string, string][] {
  const out: [string, string, string][] = [];
  for (const [key, text] of Object.entries(ctx.s.cluster)) {
    const [k, n, name] = key.split('/');
    if (k === kind && (ns === null || n === ns) && n !== undefined && name !== undefined) out.push([n, name, text]);
  }
  return out.sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1]));
}

function namespaces(ctx: Ctx): string[] {
  const set = new Set(SYSTEM_NAMESPACES);
  for (const n of deployNames(ctx, null)) set.add(nsOf(own(ctx.spec.deployments, n)));
  for (const key of Object.keys(ctx.s.cluster)) set.add(key.split('/')[1] ?? 'default');
  return [...set].sort();
}

/** The keys under `data:` in a ConfigMap, with their values. */
function dataOf(text: string): [string, string][] {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => /^data:[ ]*$/.test(l));
  if (at < 0) return [];
  const out: [string, string][] = [];
  let indent = -1;
  for (const l of lines.slice(at + 1)) {
    if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
    const ind = /^[ ]*/.exec(l)![0].length;
    if (ind === 0) break;
    if (indent < 0) indent = ind;
    if (ind !== indent) continue;
    const m = /^[ ]*([A-Za-z0-9_.-]+):[ ]*(.*)$/.exec(l);
    if (m) out.push([m[1]!, m[2]!.replace(/^(["'])(.*)\1$/, '$2')]);
  }
  return out;
}

function services(ctx: Ctx, ns: string | null): { ns: string; name: string; type: string; ip: string; ports: string; selector: string }[] {
  const list = objects(ctx, 'service', ns).map(([n, name, text]) => {
    const port = manifestValue(text, 'port');
    const type = manifestValue(text, 'type') || 'ClusterIP';
    return { ns: n, name, type, ip: clusterIp(`${n}/${name}`), ports: port ? `${port}/TCP` : '<none>', selector: manifestValue(text, 'app') ? `app=${manifestValue(text, 'app')}` : '<none>' };
  });
  if (ns === null || ns === 'default') list.unshift({ ns: 'default', name: 'kubernetes', type: 'ClusterIP', ip: '10.96.0.1', ports: '443/TCP', selector: '<none>' });
  return list;
}

/** The ReplicaSet a pod belongs to: its name without the last part. */
const rsOf = (p: Pod): string => p.name.slice(0, p.name.lastIndexOf('-'));

// ------------------------------------------------------------------ get

function getPods(ctx: Ctx, ns: string | null, wide: boolean, label: string | null): string[] {
  const pods = ctx.s.pods.filter((p) => (ns === null || p.namespace === ns) && (label === null || label === `app=${p.deployment}`));
  if (pods.length === 0) return [];
  return table([
    [...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'READY', 'STATUS', 'RESTARTS', 'AGE', ...(wide ? ['IP', 'NODE'] : [])],
    ...pods.map((p) => [
      ...(ns === null ? [p.namespace] : []), p.name, ready(p) ? '1/1' : '0/1', shownStatus(p), String(p.restarts), p.age,
      ...(wide ? [podIp(p), p.status === 'Pending' ? '<none>' : nodeOf(p).name] : []),
    ]),
  ]);
}

function getDeployments(ctx: Ctx, ns: string | null, wide: boolean): string[] {
  const names = deployNames(ctx, ns);
  if (names.length === 0) return [];
  return table([
    [...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'READY', 'UP-TO-DATE', 'AVAILABLE', 'AGE', ...(wide ? ['CONTAINERS', 'IMAGES', 'SELECTOR'] : [])],
    ...names.map((n) => {
      const spec = own(ctx.spec.deployments, n);
      const pods = podsOf(ctx, n);
      const want = own(ctx.s.rollouts, n)?.replicas ?? pods.length;
      const r = pods.filter(ready).length;
      return [
        ...(ns === null ? [nsOf(spec)] : []), n, `${r}/${want}`, String(pods.length), String(r), '42m',
        ...(wide ? [n, spec?.image ?? `${n}:latest`, `app=${n}`] : []),
      ];
    }),
  ]);
}

function getReplicaSets(ctx: Ctx, ns: string | null): string[] {
  const rows: string[][] = [];
  for (const n of deployNames(ctx, ns)) {
    const spec = own(ctx.spec.deployments, n);
    const pods = podsOf(ctx, n);
    const revs = own(ctx.s.rollouts, n)?.revisions ?? [];
    const current = pods[0] ? rsOf(pods[0]) : `${n}-${revs.at(-1)?.rs ?? podSuffix(`${n}#0`, 9)}`;
    for (const r of revs.slice(0, -1).reverse()) {
      const name = `${n}-${r.rs}`;
      if (name !== current) rows.push([...(ns === null ? [nsOf(spec)] : []), name, '0', '0', '0', '42m']);
    }
    const want = own(ctx.s.rollouts, n)?.replicas ?? pods.length;
    rows.unshift([...(ns === null ? [nsOf(spec)] : []), current, String(want), String(pods.length), String(pods.filter(ready).length), pods[0]?.age ?? '42m']);
  }
  if (rows.length === 0) return [];
  return table([[...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'DESIRED', 'CURRENT', 'READY', 'AGE'], ...rows]);
}

function getServices(ctx: Ctx, ns: string | null, wide: boolean): string[] {
  const list = services(ctx, ns);
  if (list.length === 0) return [];
  return table([
    [...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)', 'AGE', ...(wide ? ['SELECTOR'] : [])],
    ...list.map((s) => [...(ns === null ? [s.ns] : []), s.name, s.type, s.ip, '<none>', s.ports, s.name === 'kubernetes' ? '30d' : '42m', ...(wide ? [s.selector] : [])]),
  ]);
}

function getConfigMaps(ctx: Ctx, ns: string | null): string[] {
  const rows: string[][] = [];
  for (const n of ns === null ? namespaces(ctx) : [ns]) {
    rows.push([...(ns === null ? [n] : []), 'kube-root-ca.crt', '1', '30d']);
    for (const [, name, text] of objects(ctx, 'configmap', n)) rows.push([...(ns === null ? [n] : []), name, String(dataOf(text).length), '42m']);
  }
  return table([[...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'DATA', 'AGE'], ...rows]);
}

function getNodes(wide: boolean): string[] {
  return table([
    ['NAME', 'STATUS', 'ROLES', 'AGE', 'VERSION', ...(wide ? ['INTERNAL-IP', 'OS-IMAGE', 'KERNEL-VERSION'] : [])],
    ...NODES.map((n) => [n.name, 'Ready', n.role, '30d', K8S_VERSION, ...(wide ? [n.ip, 'Nines Linux 1.0', '6.8.0-nines'] : [])]),
  ]);
}

/** What happened lately, from the pods' states: newest last, like kubectl get events. */
function events(ctx: Ctx, ns: string | null): string[][] {
  const rows: string[][] = [];
  for (const p of ctx.s.pods.filter((x) => ns === null || x.namespace === ns)) {
    const obj = `pod/${p.name}`;
    const nsCol = ns === null ? [p.namespace] : [];
    const spec = own(ctx.spec.deployments, p.deployment);
    const image = spec?.image ?? `${p.deployment}:latest`;
    if (p.status === 'Pending') rows.push([...nsCol, p.age, 'Warning', 'FailedScheduling', obj, '0/3 nodes are available: 3 Insufficient cpu.']);
    else {
      rows.push([...nsCol, p.age, 'Normal', 'Scheduled', obj, `Successfully assigned ${p.namespace}/${p.name} to ${nodeOf(p).name}`]);
      if (p.status === 'ImagePullBackOff') rows.push([...nsCol, '20s', 'Warning', 'Failed', obj, `Failed to pull image "${image}": not found`]);
      else rows.push([...nsCol, p.age, 'Normal', 'Started', obj, `Started container ${p.deployment}`]);
      if (p.status === 'CrashLoopBackOff' || p.status === 'Error') rows.push([...nsCol, '20s', 'Warning', 'BackOff', obj, `Back-off restarting failed container ${p.deployment} in pod ${p.name}_${p.namespace}`]);
      if (p.status === 'NotReady') rows.push([...nsCol, '20s', 'Warning', 'Unhealthy', obj, `Readiness probe failed: ${spec?.readiness_failure ?? 'the probe did not succeed'}`]);
    }
  }
  for (const n of deployNames(ctx, ns)) {
    const revs = own(ctx.s.rollouts, n)?.revisions ?? [];
    const want = own(ctx.s.rollouts, n)?.replicas ?? 1;
    if (revs.length > 1) rows.push([...(ns === null ? [nsOf(own(ctx.spec.deployments, n))] : []), '3s', 'Normal', 'ScalingReplicaSet', `deployment/${n}`, `Scaled up replica set ${n}-${revs.at(-1)!.rs} to ${want}`]);
  }
  return rows;
}

function getEvents(ctx: Ctx, ns: string | null): string[] {
  const rows = events(ctx, ns);
  if (rows.length === 0) return [];
  return table([[...(ns === null ? ['NAMESPACE'] : []), 'LAST SEEN', 'TYPE', 'REASON', 'OBJECT', 'MESSAGE'], ...rows]);
}

function getNamespaces(ctx: Ctx): string[] {
  return table([['NAME', 'STATUS', 'AGE'], ...namespaces(ctx).map((n) => [n, 'Active', SYSTEM_NAMESPACES.includes(n) ? '30d' : '42m'])]);
}

/** A manifest for an object the cluster runs, or one written from what is known about it. */
function yamlOf(ctx: Ctx, kind: Kind, ns: string, name: string): string | null {
  const ck = own(CLUSTER_KIND, kind);
  const stored = ck ? own(ctx.s.cluster, `${ck}/${ns}/${name}`) : undefined;
  if (stored !== undefined) return stored.replace(/\n$/, '');
  if (kind === 'deployments') {
    const spec = own(ctx.spec.deployments, name);
    if (!spec || nsOf(spec) !== ns) return null;
    return [
      'apiVersion: apps/v1', 'kind: Deployment', 'metadata:', `  name: ${name}`, `  namespace: ${ns}`, 'spec:',
      `  replicas: ${own(ctx.s.rollouts, name)?.replicas ?? 1}`, '  selector:', '    matchLabels:', `      app: ${name}`, '  template:',
      '    metadata:', '      labels:', `        app: ${name}`, '    spec:', '      containers:', `        - name: ${name}`, `          image: ${spec.image ?? `${name}:latest`}`,
    ].join('\n');
  }
  if (kind === 'pods') {
    const p = ctx.s.pods.find((x) => x.name === name && x.namespace === ns);
    if (!p) return null;
    return ['apiVersion: v1', 'kind: Pod', 'metadata:', `  name: ${p.name}`, `  namespace: ${p.namespace}`, '  labels:', `    app: ${p.deployment}`, 'status:', `  phase: ${p.status === 'Pending' ? 'Pending' : 'Running'}`].join('\n');
  }
  return null;
}

function get(ctx: Ctx, rest: string[], ns: string | null, output: string | undefined, label: string | null): CmdResult {
  const tgt = target(rest, 1);
  if (!rest[1]) return fail(['You must specify the type of resource to get. Use "kubectl api-resources" for a complete list of supported resources.']);
  if (!tgt.kind) return fail([`error: the server doesn't have a resource type "${tgt.raw}"`]);
  const kind = tgt.kind;
  const wide = output === 'wide';
  if (output !== undefined && !['wide', 'yaml', 'name'].includes(output)) return fail([ctx.t('sh.kubectl_output', { output })]);
  const nsShown = ns ?? 'default';
  if (tgt.name !== undefined) {
    // one object by name: as a table row, its manifest, or its name
    const where = ns ?? 'default';
    const exists = existsNamed(ctx, kind, where, tgt.name);
    if (!exists) return fail([`Error from server (NotFound): ${kind === 'deployments' ? 'deployments.apps' : kind} "${tgt.name}" not found`]);
    if (output === 'name') return ok([`${API_NAME[kind]}/${tgt.name}`]);
    if (output === 'yaml') {
      const y = yamlOf(ctx, kind, where, tgt.name);
      return y === null ? fail([ctx.t('sh.kubectl_output', { output })]) : ok(y.split('\n'));
    }
    const all = getOf(ctx, kind, where, wide, label);
    return ok([all[0]!, ...all.slice(1).filter((l) => l.split(/\s+/)[0] === tgt.name)]);
  }
  if (kind === 'all') {
    const out: string[] = [];
    const add = (rows: string[], prefix: string) => {
      if (rows.length === 0) return;
      if (out.length > 0) out.push('');
      const [head, ...body] = rows;
      out.push(head!.replace(/^(NAMESPACE\s+)?NAME/, (_m, n: string | undefined) => `${n ?? ''}NAME`), ...body.map((r) => (ns === null ? r.replace(/^(\S+\s+)/, `$1${prefix}/`) : `${prefix}/${r}`)));
    };
    add(getPods(ctx, ns, wide, label), 'pod');
    add(getServices(ctx, ns, wide), 'service');
    add(getDeployments(ctx, ns, wide), 'deployment.apps');
    add(getReplicaSets(ctx, ns), 'replicaset.apps');
    return out.length > 0 ? ok(out) : ok([ctx.t('sh.no_pods', { ns: nsShown })]);
  }
  const rows = getOf(ctx, kind, ns, wide, label);
  if (rows.length <= 1) return ok([ns === null || kind === 'nodes' || kind === 'namespaces' ? 'No resources found' : ctx.t('sh.no_pods', { ns: nsShown })]);
  if (output === 'name') return ok(rows.slice(1).map((r) => `${API_NAME[kind]}/${r.split(/\s+/)[ns === null ? 1 : 0]}`));
  if (output === 'yaml') {
    const docs = rows.slice(1).map((r) => {
      const cells = r.split(/\s+/);
      return yamlOf(ctx, kind, ns === null ? cells[0]! : ns, cells[ns === null ? 1 : 0]!);
    }).filter((y): y is string => y !== null);
    return docs.length > 0 ? ok(docs.join('\n---\n').split('\n')) : fail([ctx.t('sh.kubectl_output', { output })]);
  }
  return ok(rows);
}

function getOf(ctx: Ctx, kind: Kind, ns: string | null, wide: boolean, label: string | null): string[] {
  switch (kind) {
    case 'pods': return getPods(ctx, ns, wide, label);
    case 'deployments': return getDeployments(ctx, ns, wide);
    case 'services': return getServices(ctx, ns, wide);
    case 'namespaces': return getNamespaces(ctx);
    case 'events': return getEvents(ctx, ns);
    case 'configmaps': return getConfigMaps(ctx, ns);
    case 'replicasets': return getReplicaSets(ctx, ns);
    case 'nodes': return getNodes(wide);
    default: return [];
  }
}

function existsNamed(ctx: Ctx, kind: Kind, ns: string, name: string): boolean {
  switch (kind) {
    case 'pods': return ctx.s.pods.some((p) => p.namespace === ns && p.name === name);
    case 'deployments': return deployNames(ctx, ns).includes(name);
    case 'services': return services(ctx, ns).some((s) => s.name === name);
    case 'configmaps': return name === 'kube-root-ca.crt' || objects(ctx, 'configmap', ns).some(([, n]) => n === name);
    case 'namespaces': return namespaces(ctx).includes(name);
    case 'nodes': return NODES.some((n) => n.name === name);
    case 'replicasets': return getReplicaSets(ctx, ns).slice(1).some((r) => r.split(/\s+/)[0] === name);
    default: return false;
  }
}

// ------------------------------------------------------------------ describe

function describe(ctx: Ctx, rest: string[], ns: string, all: boolean): CmdResult {
  const tgt = target(rest, 1);
  if (!rest[1]) return fail(['You must specify the type of resource to describe. Use "kubectl api-resources" for a complete list of supported resources.']);
  if (!tgt.kind) return fail([`error: the server doesn't have a resource type "${tgt.raw}"`]);
  const name = tgt.name;
  switch (tgt.kind) {
    case 'pods': {
      // like kubectl: an exact name, else every pod whose name starts with it
      const here = ctx.s.pods.filter((p) => all || p.namespace === ns);
      const exact = here.filter((p) => p.name === name);
      const pods = name === undefined ? here : exact.length > 0 ? exact : here.filter((p) => p.name.startsWith(name));
      if (pods.length === 0) return name === undefined ? ok([ctx.t('sh.no_pods', { ns })]) : fail([ctx.t('sh.pod_not_found', { pod: name })]);
      return ok(pods.flatMap((p, i) => [...(i > 0 ? [''] : []), ...describePod(p, own(ctx.spec.deployments, p.deployment))]), { pager: true });
    }
    case 'deployments': {
      const names = deployNames(ctx, all ? null : ns).filter((n) => name === undefined || n === name || n.startsWith(name));
      if (names.length === 0) return name === undefined ? ok([ctx.t('sh.no_pods', { ns })]) : fail([ctx.t('sh.deploy_not_found', { name })]);
      return ok(names.flatMap((n, i) => [...(i > 0 ? [''] : []), ...describeDeployment(ctx, n)]), { pager: true });
    }
    case 'services': {
      const list = services(ctx, all ? null : ns).filter((s) => name === undefined || s.name === name);
      if (list.length === 0) return fail([`Error from server (NotFound): services "${name ?? ''}" not found`]);
      return ok(list.flatMap((s, i) => {
        const backends = ctx.s.pods.filter((p) => p.namespace === s.ns && s.selector === `app=${p.deployment}` && ready(p)).map((p) => `${podIp(p)}:${s.ports.split('/')[0]}`);
        return [
          ...(i > 0 ? [''] : []),
          `Name:              ${s.name}`, `Namespace:         ${s.ns}`, `Selector:          ${s.selector}`, `Type:              ${s.type}`,
          `IP:                ${s.ip}`, `Port:              <unset>  ${s.ports}`, `Endpoints:         ${backends.length > 0 ? backends.join(',') : '<none>'}`, 'Events:            <none>',
        ];
      }), { pager: true });
    }
    case 'configmaps': {
      const list = objects(ctx, 'configmap', all ? null : ns).filter(([, n]) => name === undefined || n === name);
      if (list.length === 0) return fail([`Error from server (NotFound): configmaps "${name ?? ''}" not found`]);
      return ok(list.flatMap(([n, cm, text], i) => [
        ...(i > 0 ? [''] : []),
        `Name:         ${cm}`, `Namespace:    ${n}`, 'Labels:       <none>', 'Annotations:  <none>', '', 'Data', '====',
        ...dataOf(text).flatMap(([k, v]) => [`${k}:`, '----', v, '']),
        'Events:  <none>',
      ]), { pager: true });
    }
    case 'nodes': {
      const list = NODES.filter((n) => name === undefined || n.name === name);
      if (list.length === 0) return fail([`Error from server (NotFound): nodes "${name ?? ''}" not found`]);
      return ok(list.flatMap((n, i) => {
        const pods = ctx.s.pods.filter((p) => p.status !== 'Pending' && nodeOf(p).name === n.name);
        return [
          ...(i > 0 ? [''] : []),
          `Name:               ${n.name}`, `Roles:              ${n.role}`, `Addresses:          InternalIP: ${n.ip}`,
          'Conditions:', '  Type             Status  Reason', '  ----             ------  ------', '  MemoryPressure   False   KubeletHasSufficientMemory',
          '  DiskPressure     False   KubeletHasNoDiskPressure', '  Ready            True    KubeletReady',
          'Capacity:', '  cpu:     4', '  memory:  8Gi', '  pods:    110',
          `System Info:`, `  Kernel Version:    6.8.0-nines`, `  Kubelet Version:   ${K8S_VERSION}`,
          `Non-terminated Pods:  (${pods.length} in total)`,
          ...pods.map((p) => `  ${p.namespace.padEnd(12)}${p.name}`),
        ];
      }), { pager: true });
    }
    default:
      return fail([ctx.t('sh.kubectl_describe_kind', { kind: tgt.raw })]);
  }
}

function describeDeployment(ctx: Ctx, name: string): string[] {
  const spec = own(ctx.spec.deployments, name);
  const pods = podsOf(ctx, name);
  const want = own(ctx.s.rollouts, name)?.replicas ?? pods.length;
  const r = pods.filter(ready).length;
  const rs = pods[0] ? rsOf(pods[0]) : `${name}-${own(ctx.s.rollouts, name)?.revisions.at(-1)?.rs ?? ''}`;
  const revs = own(ctx.s.rollouts, name)?.revisions.length ?? 1;
  return [
    `Name:                   ${name}`,
    `Namespace:              ${nsOf(spec)}`,
    `Labels:                 app=${name}`,
    `Annotations:            deployment.kubernetes.io/revision: ${revs}`,
    `Selector:               app=${name}`,
    `Replicas:               ${want} desired | ${pods.length} updated | ${pods.length} total | ${r} available | ${pods.length - r} unavailable`,
    'StrategyType:           RollingUpdate',
    'Pod Template:',
    `  Labels:  app=${name}`,
    '  Containers:',
    `   ${name}:`,
    `    Image:      ${spec?.image ?? `${name}:latest`}`,
    ...(spec?.config_map ? ['    Environment Variables from:', `      ${spec.config_map}  ConfigMap  Optional: false`] : []),
    'Conditions:',
    '  Type           Status  Reason',
    '  ----           ------  ------',
    `  Available      ${r >= want && want > 0 ? 'True ' : 'False'}   ${r >= want && want > 0 ? 'MinimumReplicasAvailable' : 'MinimumReplicasUnavailable'}`,
    '  Progressing    True    NewReplicaSetAvailable',
    `NewReplicaSet:   ${rs} (${pods.length}/${want} replicas created)`,
    'Events:',
    '  Type    Reason             Age   From                   Message',
    '  ----    ------             ----  ----                   -------',
    `  Normal  ScalingReplicaSet  ${(pods[0]?.age ?? '42m').padEnd(6)}deployment-controller  Scaled up replica set ${rs} to ${want}`,
  ];
}

/** Phase, container state and events of a pod, as kubectl describe pod prints them (abridged). */
function describePod(p: Pod, spec: DeploymentSpec | undefined): string[] {
  const rs = rsOf(p);
  const phase = p.status === 'Pending' || p.status === 'ImagePullBackOff' ? 'Pending' : 'Running';
  const isReady = p.status === 'Running';
  const image = spec?.image ?? `${p.deployment}:latest`;
  const state: string[] =
    p.status === 'Running' || p.status === 'NotReady'
      ? ['    State:          Running']
      : p.status === 'Error'
        ? ['    State:          Terminated', '      Reason:       Error', '      Exit Code:    1']
        : p.status === 'Pending'
          ? [] // not scheduled yet: no node, so no container state
          : ['    State:          Waiting', `      Reason:       ${p.status}`];
  if (p.status === 'CrashLoopBackOff') state.push('    Last State:     Terminated', '      Reason:       Error', '      Exit Code:    1');
  const seen = (n: number) => (n > 1 ? `20s (x${n} over ${p.age})` : p.age);
  const events: string[] =
    p.status === 'NotReady'
      ? [
          `  Normal   Started    ${p.age.padEnd(19)}kubelet  Started container ${p.deployment}`,
          `  Warning  Unhealthy  ${seen(p.restarts + 12).padEnd(19)}kubelet  Readiness probe failed: ${spec?.readiness_failure ?? 'the probe did not succeed'}`,
        ]
      : p.status === 'Running'
        ? [
            `  Normal   Pulled     ${p.age.padEnd(19)}kubelet  Container image "${image}" already present on machine`,
            `  Normal   Started    ${p.age.padEnd(19)}kubelet  Started container ${p.deployment}`,
          ]
        : p.status === 'Pending'
          ? [`  Warning  FailedScheduling  ${p.age.padEnd(12)}default-scheduler  0/3 nodes are available: 3 Insufficient cpu.`]
          : p.status === 'ImagePullBackOff'
            ? [
                `  Warning  Failed     ${seen(p.restarts + 1).padEnd(19)}kubelet  Failed to pull image "${image}": not found`,
                `  Normal   BackOff    ${seen(p.restarts + 1).padEnd(19)}kubelet  Back-off pulling image "${image}"`,
              ]
            : [`  Warning  BackOff    ${seen(p.restarts + 1).padEnd(19)}kubelet  Back-off restarting failed container ${p.deployment} in pod ${p.name}_${p.namespace}`];
  return [
    `Name:             ${p.name}`,
    `Namespace:        ${p.namespace}`,
    `Node:             ${p.status === 'Pending' ? '<none>' : `${nodeOf(p).name}/${nodeOf(p).ip}`}`,
    `Labels:           app=${p.deployment}`,
    `Status:           ${phase}`,
    `IP:               ${podIp(p)}`,
    `Controlled By:    ReplicaSet/${rs}`,
    'Containers:',
    `  ${p.deployment}:`,
    `    Image:          ${image}`,
    ...state,
    `    Ready:          ${isReady ? 'True' : 'False'}`,
    `    Restart Count:  ${p.restarts}`,
    ...(spec?.config_map ? ['    Environment Variables from:', `      ${spec.config_map}  ConfigMap  Optional: false`] : []),
    'Events:',
    '  Type     Reason     Age                From     Message',
    '  ----     ------     ----               ----     -------',
    ...events,
  ];
}

// ------------------------------------------------------------------ changes

/**
 * Replace a Deployment's pods with a new generation, healthy when its `restart.succeeds_if` holds:
 * what `rollout restart` does, and what applying a changed Deployment does on a real cluster. A
 * new revision is recorded for rollout history.
 */
export function rollout(ctx: Ctx, name: string, cause = '<none>'): void {
  const spec = own(ctx.spec.deployments, name);
  if (!spec) return;
  const { status, logs } = health(ctx, name, spec);
  ctx.s.generation++;
  const replicas = own(ctx.s.rollouts, name)?.replicas ?? spec.replicas ?? 1;
  ctx.s.pods = [...ctx.s.pods.filter((p) => p.deployment !== name), ...makePods(name, { ...spec, replicas }, ctx.s.generation, status, 0, '3s', logs)];
  const r = own(ctx.s.rollouts, name);
  if (r) r.revisions.push({ rs: podSuffix(`${name}#${ctx.s.generation}`, 9), cause });
}

/** How a fresh pod of this Deployment starts now: its restart rule decides. */
function health(ctx: Ctx, name: string, spec: DeploymentSpec): { status: Pod['status']; logs: string[] } {
  const rule = own(ctx.deploymentRules, name);
  const healthy = rule === undefined || test(rule, ctx.env);
  return healthy
    ? { status: 'Running', logs: spec.restart?.logs_on_success ?? [] }
    : { status: spec.restart?.status_on_failure ?? spec.status, logs: spec.restart?.logs_on_failure ?? spec.logs ?? [] };
}

/** "deployment/x", "deploy x", "deployments x": the Deployment's name, or undefined. */
function deploymentArg(rest: string[], at: number): string | undefined {
  const m = /^(?:deployments?|deploy|deployment\.apps)\/(.+)$/.exec(rest[at] ?? '');
  if (m) return m[1];
  if (['deployment', 'deployments', 'deploy', 'deployment.apps'].includes(rest[at] ?? '')) return rest[at + 1];
  return undefined;
}

function rolloutCmd(ctx: Ctx, rest: string[], ns: string): CmdResult {
  const sub = rest[1];
  if (!['restart', 'status', 'history', 'undo'].includes(sub ?? '')) return fail([ctx.t('sh.usage', { usage: USAGE['kubectl']! })]);
  const name = deploymentArg(rest, 2);
  if (!name) return fail([ctx.t('sh.usage', { usage: USAGE['kubectl']! })]);
  const spec = own(ctx.spec.deployments, name);
  if (!spec || nsOf(spec) !== ns) return fail([ctx.t('sh.deploy_not_found', { name })]);
  const pods = podsOf(ctx, name);
  const revs = own(ctx.s.rollouts, name)?.revisions ?? [];
  switch (sub) {
    case 'status': {
      const r = pods.filter(ready).length;
      if (r === pods.length && pods.length > 0) return ok([`deployment "${name}" successfully rolled out`]);
      // the real command waits; this terminal shows where the rollout stands and returns
      return { out: [`Waiting for deployment "${name}" rollout to finish: ${r} of ${pods.length} updated replicas are available...`, ctx.t('sh.rollout_wait_note')], exit: 1, fail: false };
    }
    case 'history':
      return ok([`deployment.apps/${name}`, ...table([['REVISION', 'CHANGE-CAUSE'], ...revs.map((r, i) => [String(i + 1), r.cause])]), '']);
    case 'undo': {
      if (revs.length < 2) return fail([`error: no rollout history found for deployment "${name}"`]);
      rollout(ctx, name, '<none>');
      ctx.s.restarted.push(name);
      return ok([`deployment.apps/${name} rolled back`]);
    }
    default:
      rollout(ctx, name);
      ctx.s.restarted.push(name);
      return ok([`deployment.apps/${name} restarted`]);
  }
}

function scale(ctx: Ctx, rest: string[], ns: string, replicasRaw: string | true | undefined): CmdResult {
  const name = deploymentArg(rest, 1);
  if (!name) return fail([ctx.t('sh.usage', { usage: 'kubectl scale deployment/<name> --replicas=<n>' })]);
  if (typeof replicasRaw !== 'string') return fail(['error: required flag(s) "replicas" not set']);
  const n = Number(replicasRaw);
  if (!Number.isInteger(n) || n < 0) return fail([`error: invalid argument "${replicasRaw}" for "--replicas" flag`]);
  if (n > 20) return fail([ctx.t('sh.kubectl_scale_big', { n })]);
  const spec = own(ctx.spec.deployments, name);
  if (!spec || nsOf(spec) !== ns) return fail([ctx.t('sh.deploy_not_found', { name })]);
  const r = own(ctx.s.rollouts, name);
  if (r) r.replicas = n;
  const pods = podsOf(ctx, name);
  if (n < pods.length) {
    const keep = new Set(pods.slice(0, n).map((p) => p.name));
    ctx.s.pods = ctx.s.pods.filter((p) => p.deployment !== name || keep.has(p.name));
  } else if (n > pods.length) {
    // new pods of the current ReplicaSet start the way any fresh pod of it would
    const { status, logs } = health(ctx, name, spec);
    const rs = pods[0] ? rsOf(pods[0]) : `${name}-${r?.revisions.at(-1)?.rs ?? podSuffix(`${name}#0`, 9)}`;
    for (let i = pods.length; i < n; i++) {
      ctx.s.pods.push({ name: `${rs}-${podSuffix(`${rs}#scale#${i}#${ctx.s.counters.commands}`, 5)}`, namespace: nsOf(spec), deployment: name, status, restarts: 0, age: '1s', logs: [...logs] });
    }
  }
  return ok([`deployment.apps/${name} scaled`]);
}

function deleteCmd(ctx: Ctx, rest: string[], ns: string, everything: boolean): CmdResult {
  const tgt = target(rest, 1);
  if (!rest[1]) return fail(['error: You must provide one or more resources by argument or filename.']);
  if (!tgt.kind) return fail([`error: the server doesn't have a resource type "${tgt.raw}"`]);
  const names = tgt.name !== undefined ? [tgt.name, ...(rest[1]!.includes('/') ? rest.slice(2) : rest.slice(3))] : [];
  switch (tgt.kind) {
    case 'pods': {
      const victims = everything ? ctx.s.pods.filter((p) => p.namespace === ns).map((p) => p.name) : names;
      if (victims.length === 0) return fail(['error: resource(s) were provided, but no name was specified']);
      const out: string[] = [];
      let bad = false;
      for (const v of victims) {
        const pod = ctx.s.pods.find((p) => p.namespace === ns && p.name === v);
        if (!pod) {
          out.push(ctx.t('sh.pod_not_found', { pod: v }));
          bad = true;
          continue;
        }
        // its Deployment's ReplicaSet makes a new pod at once; it starts like any fresh pod
        const spec = own(ctx.spec.deployments, pod.deployment);
        const { status, logs } = spec ? health(ctx, pod.deployment, spec) : { status: pod.status, logs: pod.logs };
        const rs = rsOf(pod);
        const fresh: Pod = { ...pod, name: `${rs}-${podSuffix(`${pod.name}#deleted#${ctx.s.counters.commands}`, 5)}`, status, restarts: 0, age: '1s', logs: [...logs] };
        ctx.s.pods = ctx.s.pods.map((p) => (p === pod ? fresh : p));
        out.push(`pod "${v}" deleted`);
      }
      return bad ? { out, exit: 1, fail: true } : ok(out);
    }
    case 'configmaps':
    case 'services': {
      const ck = own(CLUSTER_KIND, tgt.kind)!;
      const out: string[] = [];
      for (const v of names) {
        const key = `${ck}/${ns}/${v}`;
        if (own(ctx.s.cluster, key) === undefined) return fail([`Error from server (NotFound): ${tgt.kind} "${v}" not found`]);
        delete ctx.s.cluster[key];
        out.push(`${ck} "${v}" deleted`);
      }
      return names.length > 0 ? ok(out) : fail(['error: resource(s) were provided, but no name was specified']);
    }
    default:
      return fail([ctx.t('sh.kubectl_delete_kind', { kind: tgt.raw })]);
  }
}

/** kubectl edit: the object's manifest in the built-in editor, from a temporary file. */
function edit(ctx: Ctx, rest: string[], ns: string): CmdResult {
  const tgt = target(rest, 1);
  if (!tgt.kind || tgt.name === undefined) return fail([ctx.t('sh.usage', { usage: 'kubectl edit configmap/<name> | deployment/<name> | service/<name>' })]);
  const ck = own(CLUSTER_KIND, tgt.kind);
  const text = yamlOf(ctx, tgt.kind, ns, tgt.name);
  if (!ck || text === null) return fail([`Error from server (NotFound): ${tgt.kind} "${tgt.name}" not found`]);
  const path = `/tmp/kubectl-edit-${podSuffix(`${ck}/${ns}/${tgt.name}#${ctx.s.counters.commands}`, 6)}.yaml`;
  const content = `# Please edit the object below. Saving applies it to the cluster;\n# cancel to leave it as it is.\n#\n${text}\n`;
  ctx.s.fs[path] = { type: 'file', size: content.length, content };
  ctx.s.kubeEdit = { path, key: `${ck}/${ns}/${tgt.name}`, kind: ck, name: tgt.name };
  return ok([], { editor: { path, content } });
}

function top(ctx: Ctx, rest: string[], ns: string | null): CmdResult {
  const what = own(KINDS, rest[1] ?? '');
  if (what === 'nodes') {
    return ok(table([['NAME', 'CPU(cores)', 'CPU(%)', 'MEMORY(bytes)', 'MEMORY(%)'], ...NODES.map((n) => {
      const cpu = pidOf(n.name, 90, 400);
      const mem = pidOf(`${n.name}#m`, 1200, 2400);
      return [n.name, `${cpu}m`, `${Math.round(cpu / 40)}%`, `${mem}Mi`, `${Math.round(mem / 82)}%`];
    })]));
  }
  if (what !== 'pods') return fail([ctx.t('sh.usage', { usage: 'kubectl top pods|nodes [-n <namespace>]' })]);
  const pods = ctx.s.pods.filter((p) => (ns === null || p.namespace === ns) && p.status !== 'Pending');
  if (pods.length === 0) return ok([ctx.t('sh.no_pods', { ns: ns ?? 'default' })]);
  return ok(table([[...(ns === null ? ['NAMESPACE'] : []), 'NAME', 'CPU(cores)', 'MEMORY(bytes)'], ...pods.map((p) => {
    // a container that keeps crashing barely gets going
    const up = p.status === 'Running' || p.status === 'NotReady';
    return [...(ns === null ? [p.namespace] : []), p.name, `${up ? pidOf(p.name, 3, 40) : 1}m`, `${up ? pidOf(`${p.name}#m`, 48, 160) : 9}Mi`];
  })]));
}

// ------------------------------------------------------------------ the command

export const kubectl: Command = (ctx, args) => {
  const r = flags(ctx, 'kubectl', args, {
    bool: 'Apw',
    value: 'nofl',
    long: {
      namespace: 'value', 'all-namespaces': 'bool', tail: 'value', previous: 'bool', output: 'value', filename: 'value', follow: 'bool',
      replicas: 'value', all: 'bool', selector: 'value', watch: 'bool', 'to-revision': 'value', force: 'bool', 'grace-period': 'value', 'show-labels': 'bool',
    },
  });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const usage = () => fail([ctx.t('sh.usage', { usage: USAGE['kubectl']! })]);
  const nsFlag = f['n'] ?? f['namespace'];
  const ns = typeof nsFlag === 'string' ? nsFlag : 'default';
  const all = f['A'] === true || f['all-namespaces'] === true;
  const outRaw = f['o'] ?? f['output'];
  const output = typeof outRaw === 'string' ? outRaw : undefined;
  const labelRaw = f['l'] ?? f['selector'];
  const label = typeof labelRaw === 'string' ? labelRaw : null;
  const watchNote = f['w'] === true || f['watch'] === true ? [ctx.t('sh.follow_note')] : [];
  switch (rest[0]) {
    case 'get': {
      const res = get(ctx, rest, all ? null : ns, output, label);
      return watchNote.length > 0 && res.exit === 0 ? { ...res, out: [...res.out, ...watchNote] } : res;
    }
    case 'describe':
      return describe(ctx, rest, ns, all);
    case 'apply': {
      const file = f['f'] ?? f['filename'];
      if (typeof file !== 'string') return fail([ctx.t('sh.kubectl_need_file')]);
      const p = abs(ctx, file);
      const node = ctx.s.fs[p];
      if (!node) return fail([ctx.t('sh.kubectl_no_path', { path: file })]);
      const targets = node.type === 'dir'
        ? listDir(ctx.s, p).filter((n) => /\.ya?ml$/.test(n) && ctx.s.fs[join(p, n)]?.type === 'file').map((n) => ({ path: join(p, n), shown: join(file, n) }))
        : [{ path: p, shown: file }];
      const out: string[] = [];
      let bad = false;
      const rolls: string[] = [];
      for (const tgt of targets) {
        const res = applyManifest(ctx, tgt.path, tgt.shown, ns);
        out.push(res.line);
        bad ||= res.bad;
        if (res.rollout && !rolls.includes(res.rollout)) rolls.push(res.rollout);
      }
      // a changed pod template rolls the Deployment out, as on a real cluster: after the whole
      // apply, so a ConfigMap applied in the same command is already there for the new pods
      for (const name of rolls) rollout(ctx, name);
      return bad ? { out, exit: 1, fail: true } : ok(out);
    }
    case 'logs': {
      // -f is a filename for apply, so here it arrives holding the target: logs -f <pod> follows
      const follow = typeof f['f'] === 'string' || f['follow'] === true;
      const tgt = rest[1] ?? (typeof f['f'] === 'string' ? f['f'] : undefined);
      if (!tgt) return usage();
      const dep = /^(?:deployments?|deploy)\/(.+)$/.exec(tgt)?.[1];
      const matches = dep !== undefined ? ctx.s.pods.filter((p) => p.namespace === ns && p.deployment === dep) : [];
      const pod = dep !== undefined ? matches[0] : ctx.s.pods.find((p) => p.namespace === ns && p.name === tgt.replace(/^pods?\//, ''));
      if (!pod) return fail([ctx.t('sh.pod_not_found', { pod: tgt })]);
      const tailRaw = f['tail'];
      const n = typeof tailRaw === 'string' ? Number(tailRaw) : -1;
      return ok([
        // kubectl says which pod it picked when a deployment has several
        ...(matches.length > 1 ? [`Found ${matches.length} pods, using pod/${pod.name}`] : []),
        ...(n >= 0 ? (n === 0 ? [] : pod.logs.slice(-n)) : pod.logs),
        ...(follow ? [ctx.t('sh.follow_note')] : []),
      ]);
    }
    case 'rollout':
      return rolloutCmd(ctx, rest, ns);
    case 'scale':
      return scale(ctx, rest, ns, f['replicas']);
    case 'delete':
      return deleteCmd(ctx, rest, ns, f['all'] === true);
    case 'edit':
      return edit(ctx, rest, ns);
    case 'top':
      return top(ctx, rest, all ? null : ns);
    case 'version':
      return ok([`Client Version: ${K8S_VERSION}`, 'Kustomize Version: v5.4.2', `Server Version: ${K8S_VERSION}`]);
    case 'cluster-info':
      return ok([`Kubernetes control plane is running at ${NODES[0].ip}:6443`, 'CoreDNS is running in kube-system (service kube-dns)']);
    case 'config':
      if (rest[1] === 'current-context' || rest[1] === 'get-contexts') return ok(rest[1] === 'current-context' ? ['nines-cluster'] : ['CURRENT   NAME            CLUSTER         AUTHINFO   NAMESPACE', `*         nines-cluster   nines-cluster   dev        ${ns}`]);
      return usage();
    default:
      return usage();
  }
};

/**
 * kubectl apply -f for one file: the cluster now runs this content for the object the file
 * names (kind, metadata.namespace or the -n namespace, metadata.name), whichever file it came
 * from. Only the shape is checked (kind and name, no tabs in the indentation, as YAML forbids
 * them); comments and blank lines never make a change. The content is what a scenario's
 * applied_value() and applied_contains() read. `expect`: kubectl edit's object, whose kind and
 * name the edit may not change.
 */
export function applyManifest(ctx: Ctx, path: string, shown: string, ns: string, expect?: string): { line: string; bad: boolean; rollout?: string } {
  const node = ctx.s.fs[path];
  const text = node?.type === 'file' ? (node.content ?? '') : '';
  const tab = text.split('\n').findIndex((l) => /^[ ]*\t/.test(l));
  if (tab >= 0) return { bad: true, line: ctx.t('sh.kubectl_yaml_tab', { path: shown, line: tab + 1 }) };
  const id = manifestId(text);
  if (!id) return { bad: true, line: ctx.t('sh.kubectl_invalid', { path: shown }) };
  const key = objectKey(id, ns);
  if (expect !== undefined && key !== expect) return { bad: true, line: 'error: At least one of apiVersion, kind and name was changed' };
  const before = own(ctx.s.cluster, key);
  setOwn(ctx.s.cluster, key, text);
  const how = before === undefined ? 'created' : significant(before) === significant(text) ? 'unchanged' : 'configured';
  // a configured Deployment that the scenario runs rolls out new pods (its namespace must match)
  const dep = id.kind === 'Deployment' && how === 'configured' ? own(ctx.spec.deployments, id.name) : undefined;
  const rollsOut = dep !== undefined && nsOf(dep) === (id.namespace ?? ns);
  return { bad: false, line: `${resourceName(id.kind)}/${id.name} ${how}`, ...(rollsOut ? { rollout: id.name } : {}) };
}
