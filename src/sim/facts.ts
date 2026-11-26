// Implementations of SCENARIO_FACTS (src/rules/registries.ts) over a SimState.

import type { ScenarioSpec } from '../content/types';
import type { Env } from '../rules/expr';
import { validateNinesCi } from './ci';
import { join } from './path';
import { signature, type SimState } from './state';
import { diskUsage, sizeOf } from './vfs';

export function pipelineFile(spec: ScenarioSpec, s: SimState): string | null {
  if (!spec.git?.pipeline || !s.git) return null;
  return join(s.git.root, spec.git.pipeline.file);
}

export function gitChanges(s: SimState) {
  const g = s.git;
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];
  if (!g) return { staged, unstaged, untracked };
  const work: Record<string, string> = {};
  for (const [p, n] of Object.entries(s.fs)) {
    const sig = signature(n);
    if (sig !== undefined && p.startsWith(g.root === '/' ? '/' : g.root + '/')) {
      work[p.slice(g.root === '/' ? 1 : g.root.length + 1)] = sig;
    }
  }
  for (const p of new Set([...Object.keys(g.head), ...Object.keys(g.index)])) {
    if (g.head[p] !== g.index[p]) staged.push(p);
  }
  for (const p of Object.keys(g.index)) if (work[p] !== g.index[p]) unstaged.push(p);
  for (const p of Object.keys(work)) if (!(p in g.index)) untracked.push(p);
  return { staged: staged.sort(), unstaged: unstaged.sort(), untracked: untracked.sort() };
}

export interface FactSource {
  state: () => SimState;
  initial: SimState;
  spec: ScenarioSpec;
  hintBoost: number;
}

export function scenarioEnv(src: FactSource): Env {
  const s = src.state;
  return {
    vars: {
      pipeline_valid: () => {
        const f = pipelineFile(src.spec, s());
        const n = f ? s().fs[f] : undefined;
        return n?.type === 'file' && n.content !== undefined && validateNinesCi(n.content).ok;
      },
      pipeline_status: () => s().pipeline.status,
      git_clean: () => {
        const c = gitChanges(s());
        return c.staged.length + c.unstaged.length + c.untracked.length === 0;
      },
      commits: () => s().git?.commits ?? 0,
      fails: () => s().counters.fails + src.hintBoost,
      commands: () => s().counters.commands,
    },
    funcs: {
      disk_usage: (p) => diskUsage(s(), String(p)),
      size: (p) => sizeOf(s(), String(p)),
      exists: (p) => s().fs[String(p)] !== undefined,
      removed: (p) => src.initial.fs[String(p)] !== undefined && s().fs[String(p)] === undefined,
      file_contains: (p, needle) => {
        const n = s().fs[String(p)];
        return n?.type === 'file' && (n.content ?? '').includes(String(needle));
      },
      service: (name) => s().services[String(name)]?.state ?? 'inactive',
      restarted: (name) => s().restarted.includes(String(name)),
      pods_running: (dep) => {
        const pods = s().pods.filter((p) => p.deployment === String(dep));
        return pods.length > 0 && pods.every((p) => p.status === 'Running');
      },
      ran: (cmd) => s().ran.includes(String(cmd)),
      flag: (name) => s().flags[String(name)] === true,
    },
  };
}
