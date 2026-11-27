// The shared base shell (Mark's playtest, 27 Nov 2026): the everyday commands every machine has,
// whatever its quest. Who am I and where (whoami, id, hostname, uname, env, date, uptime), text
// tools (echo, head, wc, sort, uniq), finding things (find, which) and help (man, history).
// The logins and processes (who, w, last, ps, kill, pkill, logout) are in procs.ts.

import { own } from '../../rules/own';
import { KERNEL, clockTime, uidOf } from '../base';
import { basename, isUnder, join, relativeTo } from '../path';
import { formatHuman, parseSize } from '../size';
import { subtree } from '../vfs';
import { abs, type Command, fail, fileLines, flags, isResult, ok, USAGE } from './util';

/** Built into the shell: `which` says so instead of naming a file. */
export const BUILTINS = new Set(['cd', 'pwd', 'echo', 'history', 'exit', 'logout', 'help', 'kill']);

const whoami: Command = (ctx) => ok([ctx.s.user]);

const id: Command = (ctx, args) => {
  const user = args[0] ?? ctx.s.user;
  const uid = uidOf(ctx.spec, user);
  if (uid === undefined) return fail([`id: '${user}': no such user`]);
  const groups = uid === 0 ? '0(root)' : user === ctx.spec.user ? `${uid}(${user}),4(adm),27(sudo)` : `${uid}(${user})`;
  return ok([`uid=${uid}(${user}) gid=${uid}(${user}) groups=${groups}`]);
};

const hostname: Command = (ctx, args) => {
  if (args.includes('-I') || args.includes('-i')) return ok(['10.20.0.15']);
  if (args.length > 0 && !args[0]!.startsWith('-')) return fail([ctx.t('sh.hostname_set')]);
  return ok([ctx.s.host]);
};

const uname: Command = (ctx, args) => {
  const r = flags(ctx, 'uname', args, { bool: 'asnrvmo', long: { all: 'bool' } });
  if (isResult(r)) return r;
  const f = r.f;
  if (f['a'] || f['all']) return ok([`Linux ${ctx.s.host} ${KERNEL.release} ${KERNEL.version} ${KERNEL.machine} GNU/Linux`]);
  const parts: string[] = [];
  if (f['s'] || Object.keys(f).length === 0) parts.push('Linux');
  if (f['n']) parts.push(ctx.s.host);
  if (f['r']) parts.push(KERNEL.release);
  if (f['v']) parts.push(KERNEL.version);
  if (f['m']) parts.push(KERNEL.machine);
  if (f['o']) parts.push('GNU/Linux');
  return ok([parts.join(' ')]);
};

/** The environment a login shell would have. $VAR itself is not expanded (sh.unsupported). */
export function environment(ctx: Parameters<Command>[0]): [string, string][] {
  return [
    ['SHELL', '/bin/bash'],
    ['PWD', ctx.s.cwd],
    ['LOGNAME', ctx.s.user],
    ['HOME', ctx.s.home],
    ['LANG', 'C.UTF-8'],
    ['TERM', 'xterm-256color'],
    ['USER', ctx.s.user],
    ['HOSTNAME', ctx.s.host],
    ['PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
    ...(ctx.s.oldpwd !== ctx.s.cwd ? [['OLDPWD', ctx.s.oldpwd] as [string, string]] : []),
  ];
}

const env: Command = (ctx, args) => {
  const vars = environment(ctx);
  if (args.length > 0) {
    // printenv NAME
    const out = args.map((a) => vars.find(([k]) => k === a)?.[1]).filter((v): v is string => v !== undefined);
    return out.length === args.length ? ok(out) : { out, exit: 1, fail: false };
  }
  return ok(vars.map(([k, v]) => `${k}=${v}`));
};

const echo: Command = (_ctx, args) => {
  const newline = args[0] !== '-n';
  const words = newline ? args : args.slice(1);
  return ok(words.length === 0 && !newline ? [] : [words.join(' ')]);
};

const date: Command = (ctx) => ok([`Thu Nov 26 ${clockTime(ctx.s.counters.commands)} UTC 2026`]);

const uptime: Command = (ctx) => {
  const users = ctx.s.logins.filter((l) => l.active).length;
  return ok([` ${clockTime(ctx.s.counters.commands)} up 3 days, 12:53,  ${users} user${users === 1 ? '' : 's'},  load average: 0.08, 0.05, 0.01`]);
};

/** Lines from files or stdin, for head, wc, sort and uniq. */
function inputs(ctx: Parameters<Command>[0], cmd: string, files: string[], stdin: string[] | null): { label: string; lines: string[] }[] | { error: string[] } {
  if (files.length === 0) {
    if (stdin) return [{ label: '', lines: stdin }];
    return { error: [ctx.t('sh.missing_operand', { cmd }), ctx.t('sh.usage', { usage: own(USAGE, cmd) ?? cmd })] };
  }
  const out: { label: string; lines: string[] }[] = [];
  const errors: string[] = [];
  for (const a of files) {
    const got = fileLines(ctx, cmd, a);
    if ('error' in got) errors.push(got.error);
    else out.push({ label: a, lines: got.lines });
  }
  return errors.length > 0 ? { error: errors } : out;
}

const head: Command = (ctx, args, stdin) => {
  const norm = args.flatMap((a) => (/^-\d+$/.test(a) ? ['-n', a.slice(1)] : [a]));
  const r = flags(ctx, 'head', norm, { bool: 'q', value: 'n', long: { lines: 'value' } });
  if (isResult(r)) return r;
  const nRaw = r.f['n'] ?? r.f['lines'] ?? '10';
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 0) return fail([ctx.t('sh.bad_number', { cmd: 'head', value: String(nRaw) })]);
  const src = inputs(ctx, 'head', r.rest, stdin);
  if ('error' in src) return fail(src.error);
  const out: string[] = [];
  src.forEach((s, i) => {
    if (src.length > 1) {
      if (i > 0) out.push('');
      out.push(`==> ${s.label} <==`);
    }
    out.push(...s.lines.slice(0, n));
  });
  return ok(out);
};

const wc: Command = (ctx, args, stdin) => {
  const r = flags(ctx, 'wc', args, { bool: 'lwcm', long: { lines: 'bool', words: 'bool', bytes: 'bool' } });
  if (isResult(r)) return r;
  const f = r.f;
  const pick = { l: f['l'] || f['lines'], w: f['w'] || f['words'], c: f['c'] || f['m'] || f['bytes'] };
  const any = pick.l || pick.w || pick.c;
  // a file known only by its size (a 2.1G backup): wc -c reports that size; lines and words are unknown
  for (const a of r.rest) {
    const n = ctx.s.fs[abs(ctx, a)];
    if (n?.type === 'file' && n.content === undefined) {
      if (any && pick.c && !pick.l && !pick.w && r.rest.length === 1) return ok([`${n.size} ${a}`]);
      return fail([ctx.t('sh.size_only', { path: a, size: formatHuman(n.size) })]);
    }
  }
  const src = inputs(ctx, 'wc', r.rest, stdin);
  if ('error' in src) return fail(src.error);
  const count = (ls: string[]) => ({
    l: ls.length,
    w: ls.join(' ').split(/\s+/).filter((x) => x !== '').length,
    c: ls.reduce((n, l) => n + new TextEncoder().encode(l).length + 1, 0),
  });
  const row = (c: { l: number; w: number; c: number }, label: string) =>
    [...(!any || pick.l ? [c.l] : []), ...(!any || pick.w ? [c.w] : []), ...(!any || pick.c ? [c.c] : [])].map((n) => String(n).padStart(any && src.length === 1 ? 1 : 7)).join(' ') + (label ? ` ${label}` : '');
  const counts = src.map((s) => count(s.lines));
  const out = src.map((s, i) => row(counts[i]!, s.label));
  if (src.length > 1) out.push(row(counts.reduce((a, b) => ({ l: a.l + b.l, w: a.w + b.w, c: a.c + b.c })), 'total'));
  return ok(out);
};

const sort: Command = (ctx, args, stdin) => {
  const r = flags(ctx, 'sort', args, { bool: 'rnuhf' });
  if (isResult(r)) return r;
  const src = inputs(ctx, 'sort', r.rest, stdin);
  if ('error' in src) return fail(src.error);
  let all = src.flatMap((s) => s.lines);
  const key = (l: string) => (r.f['f'] ? l.toLowerCase() : l);
  if (r.f['n'] || r.f['h']) {
    const num = (l: string) => {
      const m = /^\s*(-?[\d.]+)([KMGT]?)/i.exec(l);
      if (!m) return 0;
      return r.f['h'] ? parseSize(`${m[1]}${m[2]!.toUpperCase()}`) : Number(m[1]);
    };
    all = [...all].sort((a, b) => num(a) - num(b) || (a < b ? -1 : a > b ? 1 : 0));
  } else all = [...all].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  if (r.f['r']) all.reverse();
  if (r.f['u']) all = all.filter((l, i) => i === 0 || l !== all[i - 1]);
  return ok(all);
};

const uniq: Command = (ctx, args, stdin) => {
  const r = flags(ctx, 'uniq', args, { bool: 'cdu' });
  if (isResult(r)) return r;
  const src = inputs(ctx, 'uniq', r.rest.slice(0, 1), stdin);
  if ('error' in src) return fail(src.error);
  const runs: { line: string; n: number }[] = [];
  for (const l of src.flatMap((s) => s.lines)) {
    const last = runs.at(-1);
    if (last && last.line === l) last.n++;
    else runs.push({ line: l, n: 1 });
  }
  const kept = runs.filter((x) => (r.f['d'] ? x.n > 1 : r.f['u'] ? x.n === 1 : true));
  return ok(kept.map((x) => (r.f['c'] ? `${String(x.n).padStart(7)} ${x.line}` : x.line)));
};

function globRe(pattern: string, ci: boolean): RegExp {
  let re = '';
  for (const ch of pattern) re += ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${re}$`, ci ? 'i' : '');
}

/** find [path...] [-name pattern] [-iname pattern] [-type f|d] [-maxdepth N] [-size +N[kMG]]. */
const find: Command = (ctx, args) => {
  const roots: string[] = [];
  let i = 0;
  while (i < args.length && !args[i]!.startsWith('-')) roots.push(args[i++]!);
  const tests: ((p: string) => boolean)[] = [];
  let maxdepth = Infinity;
  while (i < args.length) {
    const opt = args[i]!;
    const val = args[i + 1];
    if (opt === '-print') {
      i++;
      continue;
    }
    if (val === undefined) return fail([`find: missing argument to '${opt}'`]);
    if (opt === '-name' || opt === '-iname') {
      const re = globRe(val, opt === '-iname');
      tests.push((p) => re.test(basename(p)));
    } else if (opt === '-type') {
      if (val !== 'f' && val !== 'd') return fail([`find: Unknown argument to -type: ${val}`]);
      tests.push((p) => ctx.s.fs[p]?.type === (val === 'f' ? 'file' : 'dir'));
    } else if (opt === '-maxdepth') {
      maxdepth = Number(val);
      if (!Number.isInteger(maxdepth) || maxdepth < 0) return fail([`find: Expected a positive decimal integer argument to -maxdepth, but got '${val}'`]);
    } else if (opt === '-size') {
      const m = /^([+-]?)(\d+)([ckMG]?)$/.exec(val);
      if (!m) return fail([`find: invalid -size type in '${val}'`]);
      const unit = m[3] === 'c' ? 1 : m[3] === 'k' ? 1024 : m[3] === 'M' ? 1024 ** 2 : m[3] === 'G' ? 1024 ** 3 : 512;
      const n = Number(m[2]) * unit;
      tests.push((p) => {
        const node = ctx.s.fs[p];
        if (node?.type !== 'file') return false;
        return m[1] === '+' ? node.size > n : m[1] === '-' ? node.size < n : Math.ceil(node.size / unit) === Number(m[2]);
      });
    } else return fail([`find: unknown predicate '${opt}'`, ctx.t('sh.usage', { usage: USAGE['find']! })]);
    i += 2;
  }
  const out: string[] = [];
  let bad = false;
  for (const raw of roots.length > 0 ? roots : ['.']) {
    const root = abs(ctx, raw);
    if (!ctx.s.fs[root]) {
      out.push(`find: '${raw}': No such file or directory`);
      bad = true;
      continue;
    }
    const depth = (p: string) => (p === root ? 0 : relativeTo(p, root).split('/').length);
    for (const p of subtree(ctx.s, root).sort()) {
      if (depth(p) > maxdepth || !isUnder(p, root)) continue;
      if (!tests.every((t) => t(p))) continue;
      out.push(p === root ? raw : raw.replace(/\/$/, '') + (root === '/' ? p : p.slice(root.length)));
    }
  }
  return bad ? { out, exit: 1, fail: true } : ok(out);
};

const history: Command = (ctx, args) => {
  const all = ctx.s.history;
  const n = args[0] !== undefined && /^\d+$/.test(args[0]) ? Number(args[0]) : all.length;
  const start = Math.max(0, all.length - n);
  return ok(all.slice(start).map((l, i) => `${String(start + i + 1).padStart(5)}  ${l}`));
};

export const BASIC_COMMANDS: Record<string, Command> = {
  whoami,
  id,
  hostname,
  uname,
  env,
  printenv: env,
  echo,
  date,
  uptime,
  head,
  wc,
  sort,
  uniq,
  find,
  history,
};

/** `which` and `man` need the full command list, so commands.ts builds them with it. */
export function makeWhich(has: (name: string) => boolean): Command {
  return (_ctx, args) => {
    if (args.length === 0) return { out: [], exit: 1, fail: false };
    const out: string[] = [];
    let missing = false;
    for (const a of args) {
      if (BUILTINS.has(a)) out.push(`${a}: shell built-in command`);
      else if (has(a)) out.push(join(['systemctl', 'journalctl', 'nginx', 'kill', 'pkill'].includes(a) ? '/usr/sbin' : '/usr/bin', a));
      else missing = true;
    }
    return { out, exit: missing ? 1 : 0, fail: false };
  };
}
