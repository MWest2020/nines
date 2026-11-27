// The state of one simulated machine. Plain JSON: no classes, Maps or Sets, so a session can
// be cloned with structuredClone, reset from its initial snapshot, and saved if we ever want to.

import type { PodStatus, ScenarioSpec } from '../content/types';
import { setOwn } from '../rules/own';
import { manifestId, objectKey } from './manifest';
import { dirname, isUnder, normalize } from './path';
import { parseSize, utf8Length } from './size';

export type FsNode = { type: 'dir' } | { type: 'file'; size: number; content?: string };

export interface Mount {
  path: string;
  device: string;
  size: number;
  baseUsed: number;
}

export interface ServiceState {
  description: string;
  state: 'active' | 'inactive' | 'failed';
  enabled: boolean;
  logs: string[];
}

export interface Pod {
  name: string;
  namespace: string;
  deployment: string;
  status: PodStatus;
  restarts: number;
  age: string;
  logs: string[];
}

export interface GitState {
  root: string;
  branch: string;
  /** root-relative path -> content signature, at the last commit */
  head: Record<string, string>;
  /** root-relative path -> content signature, staged */
  index: Record<string, string>;
  commits: number;
}

export interface SimState {
  host: string;
  user: string;
  home: string;
  cwd: string;
  oldpwd: string;
  /** absolute path -> node; "/" is always a dir */
  fs: Record<string, FsNode>;
  mounts: Mount[];
  services: Record<string, ServiceState>;
  pods: Pod[];
  git: GitState | null;
  pipeline: { status: 'none' | 'passed' | 'failed'; runs: number };
  counters: { commands: number; fails: number };
  /** command names run, "systemctl" and "systemctl restart" alike */
  ran: string[];
  restarted: string[];
  flags: Record<string, boolean>;
  firedEvents: string[];
  shownHints: string[];
  /** bumps on every kubectl rollout, so new pod names are deterministic */
  generation: number;
  /** what the cluster runs: object key ("configmap/shop/shop-api-config") -> the manifest text
   *  last applied for it (kubectl apply -f), from whichever file */
  cluster: Record<string, string>;
}

export function ensureDir(fs: Record<string, FsNode>, p: string): void {
  let cur = p;
  const missing: string[] = [];
  while (!fs[cur]) {
    missing.push(cur);
    cur = dirname(cur);
  }
  for (const m of missing) fs[m] = { type: 'dir' };
}

export function writeFile(fs: Record<string, FsNode>, p: string, content: string, size?: number): void {
  ensureDir(fs, dirname(p));
  fs[p] = { type: 'file', size: size ?? utf8Length(content), content };
}

/** A string that changes whenever a file's content (or, for size-only files, its size) does. */
export function signature(node: FsNode | undefined): string | undefined {
  if (!node || node.type !== 'file') return undefined;
  return node.content ?? `\u0000size:${node.size}`;
}

/** Deterministic, k8s-looking name parts: FNV-1a over the seed, in k8s's safe alphabet. */
export function podSuffix(seed: string, length: number): string {
  const alphabet = 'bcdfghjklmnpqrstvwxz2456789';
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = '';
  for (let i = 0; i < length; i++) {
    out += alphabet[h % alphabet.length];
    h = Math.imul(h ^ (i + 1), 0x01000193) >>> 0;
  }
  return out;
}

export function makePods(
  name: string,
  spec: { namespace?: string; replicas?: number },
  generation: number,
  status: PodStatus,
  restarts: number,
  age: string,
  logs: string[],
): Pod[] {
  const rs = podSuffix(`${name}#${generation}`, 9);
  return Array.from({ length: spec.replicas ?? 1 }, (_, i) => ({
    name: `${name}-${rs}-${podSuffix(`${name}#${generation}#${i}`, 5)}`,
    namespace: spec.namespace ?? 'default',
    deployment: name,
    status,
    restarts,
    age,
    logs: [...logs],
  }));
}

export function createState(spec: ScenarioSpec): SimState {
  const fs: Record<string, FsNode> = { '/': { type: 'dir' } };
  for (const m of spec.mounts) ensureDir(fs, normalize(m.path));
  for (const d of spec.dirs ?? []) ensureDir(fs, normalize(d));
  for (const [raw, f] of Object.entries(spec.files ?? {})) {
    const p = normalize(raw);
    if (typeof f === 'string') writeFile(fs, p, f);
    else {
      const content = f.content;
      const size = f.size !== undefined ? parseSize(f.size) : utf8Length(content ?? '');
      ensureDir(fs, dirname(p));
      fs[p] = content === undefined ? { type: 'file', size } : { type: 'file', size, content };
    }
  }
  const home = normalize(spec.home);
  const cwd = normalize(spec.cwd ?? spec.home);
  ensureDir(fs, home);
  ensureDir(fs, cwd);

  const services: Record<string, ServiceState> = {};
  for (const [name, s] of Object.entries(spec.services ?? {})) {
    services[name] = {
      description: s.description,
      state: s.state,
      enabled: s.enabled ?? true,
      logs: [...(s.logs ?? [])],
    };
  }

  const pods: Pod[] = [];
  for (const [name, d] of Object.entries(spec.deployments ?? {})) {
    pods.push(...makePods(name, d, 0, d.status, d.restarts ?? 0, '42m', d.logs ?? []));
  }

  // manifests the cluster already runs: their objects, with the files' content at the start
  const cluster: Record<string, string> = {};
  for (const raw of spec.cluster ?? []) {
    const n = fs[normalize(raw)];
    const id = n?.type === 'file' && n.content !== undefined ? manifestId(n.content) : null;
    if (id) setOwn(cluster, objectKey(id, 'default'), n!.type === 'file' ? n!.content! : '');
  }

  let git: GitState | null = null;
  if (spec.git) {
    const root = normalize(spec.git.root);
    ensureDir(fs, root);
    const head: Record<string, string> = {};
    for (const [p, node] of Object.entries(fs)) {
      const sig = signature(node);
      if (sig !== undefined && isUnder(p, root) && p !== root) setOwn(head, p.slice(root === '/' ? 1 : root.length + 1), sig);
    }
    git = { root, branch: spec.git.branch ?? 'main', head, index: { ...head }, commits: 0 };
  }

  return {
    host: spec.host,
    user: spec.user,
    home,
    cwd,
    oldpwd: cwd,
    fs,
    mounts: spec.mounts
      .map((m) => ({
        path: normalize(m.path),
        device: m.device,
        size: parseSize(m.size),
        baseUsed: parseSize(m.base_used ?? 0),
      }))
      .sort((a, b) => a.path.length - b.path.length),
    services,
    pods,
    git,
    pipeline: { status: 'none', runs: 0 },
    counters: { commands: 0, fails: 0 },
    ran: [],
    restarted: [],
    flags: {},
    firedEvents: [],
    shownHints: [],
    generation: 0,
    cluster,
  };
}
