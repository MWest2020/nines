// What every command module shares: the command signature, its context, small result helpers,
// flag parsing with the real tool's error, path resolution and the fake clock. The usage lines
// for `help <cmd>` live here too, so every module adds its own commands' syntax in one place.

import type { Translate } from '../../core/i18n';
import type { ScenarioSpec } from '../../content/types';
import type { Compiled, Env } from '../../rules/expr';
import { own } from '../../rules/own';
import { resolve } from '../path';
import { formatHuman } from '../size';
import type { SimState } from '../state';
import { type FlagSpec, type Flags, parseFlags } from './parse';

export interface Ui {
  pager?: true;
  clear?: true;
  close?: true;
  editor?: { path: string; content: string };
}

export interface CmdResult {
  out: string[];
  exit: number;
  /** counts as a failed attempt for hints; defaults to exit !== 0 */
  fail?: boolean;
  ui?: Ui;
  /** a destructive command hit something vital: the session raises the outage event */
  outage?: true;
}

export interface Ctx {
  s: SimState;
  spec: ScenarioSpec;
  env: Env;
  t: Translate;
  serviceRules: Record<string, Compiled | undefined>;
  deploymentRules: Record<string, Compiled | undefined>;
}

export type Command = (ctx: Ctx, args: string[], stdin: string[] | null) => CmdResult;

/** Paths whose recursive removal (or move) takes the whole machine down. */
export const VITAL_PATHS = new Set([
  '/', '/bin', '/boot', '/dev', '/etc', '/home', '/lib', '/lib64', '/opt', '/proc', '/root',
  '/sbin', '/srv', '/sys', '/usr', '/var',
]);

/** Syntax shown by `help <cmd>`. Syntax is code, not prose, so it is not translated. */
export const USAGE: Record<string, string> = {
  help: 'help [command]',
  ls: 'ls [-l] [-a] [-h] [path...]',
  cd: 'cd [dir | - | ~]',
  pwd: 'pwd',
  cat: 'cat <file...>',
  less: 'less <file>',
  tail: 'tail [-n N] <file...>',
  grep: 'grep [-i] [-v] [-n] [-c] [-r] [-F] <pattern> [file...]',
  df: 'df [-h] [path...]',
  du: 'du [-s] [-h] [-c] [path...]',
  rm: 'rm [-r] [-f] <path...>',
  mv: 'mv <source...> <destination>',
  edit: 'edit <file>',
  systemctl: 'systemctl status|restart|start|stop|reload|is-active <unit>',
  journalctl: 'journalctl -u <unit> [-n N]',
  kubectl: 'kubectl get pods|deploy|svc|cm|ns|events|rs|nodes|all [-n ns | -A] [-o wide|yaml|name] | describe pod|deploy|svc|cm|node [name] | logs <pod> | apply -f <file> | rollout restart|status|history|undo deployment/<name> | scale deployment/<name> --replicas=N | edit cm/<name> | delete pod <pod> | top pods|nodes',
  git: 'git status | add <path...> | commit -m "message" | log [--oneline] | diff [--staged] | restore <path> | -C <dir> <command>',
  clear: 'clear',
  exit: 'exit',
  logout: 'logout',
  whoami: 'whoami',
  id: 'id [user]',
  who: 'who',
  w: 'w',
  last: 'last [user]',
  hostname: 'hostname [-I]',
  uname: 'uname [-a] [-r] [-n] [-m]',
  ps: 'ps [aux | -ef] [-u user]',
  kill: 'kill [-9 | -15 | -s SIGNAL] <pid...>',
  pkill: 'pkill [-9] [-u user] [-t tty] [pattern]',
  env: 'env',
  printenv: 'printenv [name...]',
  echo: 'echo [-n] [text...]',
  date: 'date',
  uptime: 'uptime',
  head: 'head [-n N] [file...]',
  wc: 'wc [-l] [-w] [-c] [file...]',
  sort: 'sort [-r] [-n] [-h] [-u] [file...]',
  uniq: 'uniq [-c] [-d] [-u] [file]',
  find: 'find [path...] [-name pattern] [-iname pattern] [-type f|d] [-maxdepth N] [-size +N[kMG]]',
  which: 'which <command...>',
  man: 'man <command>',
  history: 'history [N]',
  nginx: 'nginx -t | -T | -v | -s reload|stop|quit|reopen',
};

export const ok = (out: string[] = [], ui?: Ui): CmdResult => (ui ? { out, exit: 0, ui } : { out, exit: 0 });
export const fail = (out: string[], exit = 1): CmdResult => ({ out, exit, fail: true });

export function flags(ctx: Ctx, cmd: string, args: string[], spec: FlagSpec): { f: Flags; rest: string[] } | CmdResult {
  const r = parseFlags(args, spec);
  if (!r.ok) return fail([ctx.t('sh.bad_option', { cmd, opt: r.bad }), ctx.t('sh.usage', { usage: own(USAGE, cmd) ?? cmd })], 2);
  return { f: r.flags, rest: r.rest };
}
export const isResult = (x: unknown): x is CmdResult => typeof x === 'object' && x !== null && 'exit' in x;

export const abs = (ctx: Ctx, p: string): string => resolve(ctx.s.cwd, ctx.s.home, p);

export function lines(content: string | undefined): string[] {
  if (content === undefined || content === '') return [];
  return content.replace(/\n$/, '').split('\n');
}

/** A fake clock for log lines: it moves 7 seconds per command, so output is deterministic. */
export function clock(s: SimState): string {
  const secs = 9 * 3600 + s.counters.commands * 7;
  const hh = String(Math.floor(secs / 3600) % 24).padStart(2, '0');
  const mm = String(Math.floor(secs / 60) % 60).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `Nov 26 ${hh}:${mm}:${ss}`;
}

export function fileLines(ctx: Ctx, cmd: string, arg: string): { lines: string[] } | { error: string } {
  const p = abs(ctx, arg);
  const n = ctx.s.fs[p];
  if (!n) return { error: ctx.t('sh.no_such', { cmd, path: arg }) };
  if (n.type === 'dir') return { error: ctx.t('sh.is_dir', { cmd, path: arg }) };
  if (n.content === undefined) return { lines: [ctx.t('sh.size_only', { path: arg, size: formatHuman(n.size) })] };
  return { lines: lines(n.content) };
}
