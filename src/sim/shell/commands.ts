// The core commands: files, services, git and help. Each one is a pure function of (context,
// arguments, stdin) that may change the working copy of the state it is handed and returns lines
// of output. More commands live beside this file: basic.ts (the shared base shell: whoami, ps,
// find, head...), procs.ts (logins and processes: who, w, last, kill, pkill, logout), nginx.ts
// and kubectl.ts. COMMANDS below gathers them all.
//
// Translation boundary: messages go through t() and live in the locale files (sh.* keys).
// Command names, flags, column headers, git/systemctl status labels and log lines are the
// interface being taught, so they stay as the real tools print them.

import { test } from '../../rules/expr';
import { has, own, setOwn } from '../../rules/own';
import { validateNinesCi } from '../ci';
import { gitChanges, pipelineFile } from '../facts';
import { basename, dirname, isUnder, join, relativeTo } from '../path';
import { formatHuman, kblocks } from '../size';
import { gitHash, signature, type SimState, writeFile } from '../state';
import { isDir, listDir, mountFor, mountUsed, move, remove, sizeOf, subtree } from '../vfs';
import { BASIC_COMMANDS, makeWhich } from './basic';
import { kubectl } from './kubectl';
import { nginx, nginxTest } from './nginx';
import { PROC_COMMANDS } from './procs';
import { abs, clock, type Command, type Ctx, fail, fileLines, flags, isResult, lines, ok, USAGE, type Ui, VITAL_PATHS } from './util';

export { type CmdResult, type Command, type Ctx, type Ui, USAGE, VITAL_PATHS } from './util';

// ------------------------------------------------------------------ files

const ls: Command = (ctx, args) => {
  const r = flags(ctx, 'ls', args, { bool: 'laAh1F' });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const targets = rest.length > 0 ? rest : ['.'];
  const out: string[] = [];
  let exit = 0;
  const entry = (p: string, name: string): string => {
    const n = ctx.s.fs[p]!;
    const shown = n.type === 'dir' ? `${name}/` : name;
    if (!f['l']) return shown;
    const size = n.type === 'dir' ? 4096 : n.size;
    const sizeText = f['h'] ? formatHuman(size) : String(size);
    return `${n.type === 'dir' ? 'drwxr-xr-x' : '-rw-r--r--'} root root ${sizeText.padStart(f['h'] ? 5 : 10)} ${shown}`;
  };
  const files = targets.filter((a) => ctx.s.fs[abs(ctx, a)]?.type === 'file');
  const dirs = targets.filter((a) => isDir(ctx.s, abs(ctx, a)));
  for (const a of targets) {
    if (!ctx.s.fs[abs(ctx, a)]) {
      out.push(ctx.t('sh.ls_no_such', { path: a }));
      exit = 2;
    }
  }
  for (const a of files) out.push(entry(abs(ctx, a), a));
  dirs.forEach((a, i) => {
    const dir = abs(ctx, a);
    if (targets.length > 1) {
      if (out.length > 0 || i > 0) out.push('');
      out.push(`${a}:`);
    }
    for (const name of listDir(ctx.s, dir)) {
      if (name.startsWith('.') && !f['a'] && !f['A']) continue;
      out.push(entry(join(dir, name), name));
    }
  });
  return exit === 0 ? ok(out) : fail(out, exit);
};

const cd: Command = (ctx, args) => {
  if (args.length > 1) return fail([ctx.t('sh.too_many_args', { cmd: 'cd' })]);
  const arg = args[0] ?? '~';
  const target = arg === '-' ? ctx.s.oldpwd : abs(ctx, arg);
  const n = ctx.s.fs[target];
  if (!n) return fail([ctx.t('sh.no_such', { cmd: 'cd', path: arg })]);
  if (n.type !== 'dir') return fail([ctx.t('sh.not_dir', { cmd: 'cd', path: arg })]);
  ctx.s.oldpwd = ctx.s.cwd;
  ctx.s.cwd = target;
  return ok(arg === '-' ? [target] : []);
};

const pwd: Command = (ctx) => ok([ctx.s.cwd]);

function catLike(cmd: 'cat' | 'less'): Command {
  return (ctx, args, stdin) => {
    const r = flags(ctx, cmd, args, { bool: 'nNRS' });
    if (isResult(r)) return r;
    const ui: Ui | undefined = cmd === 'less' ? { pager: true } : undefined;
    if (r.rest.length === 0) {
      if (stdin) return ok(stdin, ui);
      return fail([ctx.t('sh.missing_operand', { cmd }), ctx.t('sh.usage', { usage: own(USAGE, cmd) ?? cmd })]);
    }
    const out: string[] = [];
    let bad = false;
    for (const a of r.rest) {
      const got = fileLines(ctx, cmd, a);
      if ('error' in got) {
        out.push(got.error);
        bad = true;
      } else out.push(...got.lines);
    }
    return bad ? fail(out) : ok(out, ui);
  };
}

const tail: Command = (ctx, args, stdin) => {
  const norm = args.flatMap((a) => (/^-\d+$/.test(a) ? ['-n', a.slice(1)] : [a]));
  const r = flags(ctx, 'tail', norm, { bool: 'fFq', value: 'n', long: { lines: 'value', follow: 'bool' } });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const nRaw = f['n'] ?? f['lines'] ?? '10';
  const n = Number(nRaw);
  if (!Number.isInteger(n) || n < 0) return fail([ctx.t('sh.bad_number', { cmd: 'tail', value: String(nRaw) })]);
  const pick = (ls: string[]) => (n === 0 ? [] : ls.slice(-n));
  const out: string[] = [];
  let bad = false;
  if (rest.length === 0) {
    if (!stdin) return fail([ctx.t('sh.missing_operand', { cmd: 'tail' })]);
    out.push(...pick(stdin));
  }
  rest.forEach((a, i) => {
    const got = fileLines(ctx, 'tail', a);
    if (rest.length > 1) {
      if (i > 0) out.push('');
      out.push(`==> ${a} <==`);
    }
    if ('error' in got) {
      out.push(got.error);
      bad = true;
    } else out.push(...pick(got.lines));
  });
  if (f['f'] || f['F'] || f['follow']) out.push(ctx.t('sh.follow_note'));
  return bad ? fail(out) : ok(out);
};

const grep: Command = (ctx, args, stdin) => {
  const r = flags(ctx, 'grep', args, { bool: 'ivncrRFEl', long: { 'ignore-case': 'bool' } });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const pattern = rest[0];
  if (pattern === undefined) return fail([ctx.t('sh.usage', { usage: USAGE['grep']! })], 2);
  let re: RegExp;
  try {
    const src = f['F'] ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : pattern;
    re = new RegExp(src, f['i'] || f['ignore-case'] ? 'i' : '');
  } catch {
    return fail([ctx.t('sh.grep_bad_pattern', { pattern })], 2);
  }
  const recursive = f['r'] || f['R'];
  const operands = rest.slice(1);
  const sources: { label: string; lines: string[] }[] = [];
  const out: string[] = [];
  let errors = false;
  if (operands.length === 0 && !recursive) {
    if (!stdin) return fail([ctx.t('sh.usage', { usage: USAGE['grep']! })], 2);
    sources.push({ label: '', lines: stdin });
  }
  const targets = operands.length > 0 ? operands : recursive ? ['.'] : [];
  for (const a of targets) {
    const p = abs(ctx, a);
    const n = ctx.s.fs[p];
    if (!n) {
      out.push(ctx.t('sh.no_such', { cmd: 'grep', path: a }));
      errors = true;
    } else if (n.type === 'dir') {
      if (!recursive) {
        out.push(ctx.t('sh.is_dir', { cmd: 'grep', path: a }));
        errors = true;
        continue;
      }
      for (const k of subtree(ctx.s, p).sort()) {
        const c = ctx.s.fs[k]!;
        if (c.type !== 'file') continue;
        const label = a === '.' ? relativeTo(k, p) : a.replace(/\/$/, '') + k.slice(p.length);
        sources.push({ label, lines: lines(c.content) });
      }
    } else sources.push({ label: a, lines: lines(n.content) });
  }
  const prefixed = sources.length > 1 || recursive;
  let matched = false;
  for (const src of sources) {
    let count = 0;
    src.lines.forEach((line, i) => {
      if (re.test(line) === !f['v']) {
        count++;
        if (!f['c'] && !f['l']) {
          out.push(`${prefixed ? `${src.label}:` : ''}${f['n'] ? `${i + 1}:` : ''}${line}`);
        }
      }
    });
    if (count > 0) matched = true;
    if (f['c']) out.push(`${prefixed ? `${src.label}:` : ''}${count}`);
    else if (f['l'] && count > 0) out.push(src.label);
  }
  if (errors && !matched) return fail(out, 2);
  return { out, exit: matched ? 0 : 1, fail: false };
};

const du: Command = (ctx, args) => {
  const r = flags(ctx, 'du', args, { bool: 'shcak' });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const fmt = (b: number) => (f['h'] ? formatHuman(b) : String(kblocks(b)));
  const out: string[] = [];
  let total = 0;
  let bad = false;
  for (const a of rest.length > 0 ? rest : ['.']) {
    const p = abs(ctx, a);
    if (!ctx.s.fs[p]) {
      out.push(ctx.t('sh.du_no_such', { path: a }));
      bad = true;
      continue;
    }
    const shown = (k: string) => (k === p ? a : a.replace(/\/$/, '') + k.slice(p === '/' ? 0 : p.length));
    if (!f['s'] && isDir(ctx.s, p)) {
      const dirs = subtree(ctx.s, p)
        .filter((k) => k !== p && isDir(ctx.s, k))
        .sort()
        .reverse();
      for (const d of dirs) out.push(`${fmt(sizeOf(ctx.s, d))}\t${shown(d)}`);
    }
    const size = sizeOf(ctx.s, p);
    total += size;
    out.push(`${fmt(size)}\t${a}`);
  }
  if (f['c']) out.push(`${fmt(total)}\ttotal`);
  return bad ? fail(out) : ok(out);
};

const df: Command = (ctx, args) => {
  const r = flags(ctx, 'df', args, { bool: 'hTa' });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const out: string[] = [];
  let mounts = ctx.s.mounts;
  if (rest.length > 0) {
    const picked: typeof mounts = [];
    for (const a of rest) {
      const p = abs(ctx, a);
      if (!ctx.s.fs[p]) {
        out.push(ctx.t('sh.no_such', { cmd: 'df', path: a }));
        continue;
      }
      const m = mountFor(ctx.s, p);
      if (!picked.includes(m)) picked.push(m);
    }
    mounts = picked;
  }
  const fmt = (b: number) => (f['h'] ? formatHuman(b) : String(kblocks(b)));
  const w = f['h'] ? 5 : 10;
  const header = f['h']
    ? `${'Filesystem'.padEnd(15)} ${'Size'.padStart(w)} ${'Used'.padStart(w)} ${'Avail'.padStart(w)} Use% Mounted on`
    : `${'Filesystem'.padEnd(15)} ${'1K-blocks'.padStart(w)} ${'Used'.padStart(w)} ${'Available'.padStart(w)} Use% Mounted on`;
  const rows = mounts.map((m) => {
    const used = mountUsed(ctx.s, m);
    const pct = m.size === 0 ? 100 : Math.ceil((used / m.size) * 100);
    return `${m.device.padEnd(15)} ${fmt(m.size).padStart(w)} ${fmt(used).padStart(w)} ${fmt(Math.max(0, m.size - used)).padStart(w)} ${`${pct}%`.padStart(4)} ${m.path}`;
  });
  const res = [header, ...rows, ...out];
  return out.length > 0 ? fail(res) : ok(res);
};

function fixCwd(s: SimState): void {
  while (!s.fs[s.cwd]) s.cwd = dirname(s.cwd);
}

const rm: Command = (ctx, args) => {
  const r = flags(ctx, 'rm', args, {
    bool: 'rRfiIdv',
    long: { recursive: 'bool', force: 'bool', 'no-preserve-root': 'bool', verbose: 'bool' },
  });
  if (isResult(r)) return r;
  const { f, rest } = r;
  const recursive = f['r'] || f['R'] || f['recursive'];
  const force = f['f'] || f['force'];
  if (rest.length === 0) return force ? ok() : fail([ctx.t('sh.missing_operand', { cmd: 'rm' })]);
  const out: string[] = [];
  let bad = false;
  for (const a of rest) {
    const p = abs(ctx, a);
    if (recursive && VITAL_PATHS.has(p)) {
      return { out: [...out, ctx.t('sh.outage_rm', { path: a })], exit: 0, outage: true };
    }
    const n = ctx.s.fs[p];
    if (!n) {
      if (!force) {
        out.push(ctx.t('sh.rm_no_such', { path: a }));
        bad = true;
      }
      continue;
    }
    if (n.type === 'dir' && !recursive) {
      out.push(ctx.t('sh.rm_is_dir', { path: a }));
      bad = true;
      continue;
    }
    remove(ctx.s, p);
    if (f['v']) out.push(ctx.t('sh.rm_removed', { path: a }));
  }
  fixCwd(ctx.s);
  return bad ? fail(out) : ok(out);
};

const mv: Command = (ctx, args) => {
  const r = flags(ctx, 'mv', args, { bool: 'fivn' });
  if (isResult(r)) return r;
  const { rest } = r;
  if (rest.length < 2) return fail([ctx.t('sh.missing_operand', { cmd: 'mv' }), ctx.t('sh.usage', { usage: USAGE['mv']! })]);
  const dstArg = rest[rest.length - 1]!;
  const srcs = rest.slice(0, -1);
  const dst = abs(ctx, dstArg);
  for (const a of srcs) {
    if (VITAL_PATHS.has(abs(ctx, a))) return { out: [ctx.t('sh.outage_rm', { path: a })], exit: 0, outage: true };
  }
  const intoDir = isDir(ctx.s, dst);
  if (!intoDir && srcs.length > 1) return fail([ctx.t('sh.mv_not_dir', { path: dstArg })]);
  const out: string[] = [];
  let bad = false;
  for (const a of srcs) {
    const src = abs(ctx, a);
    if (!ctx.s.fs[src]) {
      out.push(ctx.t('sh.mv_no_such', { path: a }));
      bad = true;
      continue;
    }
    const target = intoDir ? join(dst, basename(src)) : dst;
    if (target === src) continue;
    if (isUnder(target, src)) {
      out.push(ctx.t('sh.mv_into_self', { from: a, to: dstArg }));
      bad = true;
      continue;
    }
    if (!isDir(ctx.s, dirname(target))) {
      out.push(ctx.t('sh.mv_no_target', { from: a, to: dstArg }));
      bad = true;
      continue;
    }
    if (isDir(ctx.s, target)) {
      out.push(ctx.t('sh.mv_overwrite_dir', { from: a, to: dstArg }));
      bad = true;
      continue;
    }
    if (ctx.s.fs[target]) remove(ctx.s, target);
    move(ctx.s, src, target);
  }
  fixCwd(ctx.s);
  return bad ? fail(out) : ok(out);
};

function editor(cmd: string): Command {
  return (ctx, args) => {
    if (args.length !== 1) return fail([ctx.t('sh.usage', { usage: USAGE['edit']! })]);
    const arg = args[0]!;
    const p = abs(ctx, arg);
    const n = ctx.s.fs[p];
    if (n?.type === 'dir') return fail([ctx.t('sh.is_dir', { cmd, path: arg })]);
    if (!isDir(ctx.s, dirname(p))) return fail([ctx.t('sh.no_such', { cmd, path: arg })]);
    if (n && n.content === undefined && n.size > 0) return fail([ctx.t('sh.edit_too_big', { path: arg })]);
    const out = cmd === 'vi' || cmd === 'vim' ? [ctx.t('sh.vi_note')] : [];
    return ok(out, { editor: { path: p, content: n?.content ?? '' } });
  };
}

// ------------------------------------------------------------------ services

function statusBlock(ctx: Ctx, unit: string): string[] {
  const svc = own(ctx.s.services, unit)!;
  const active =
    svc.state === 'active' ? 'active (running)' : svc.state === 'failed' ? 'failed (Result: exit-code)' : 'inactive (dead)';
  return [
    `${svc.state === 'active' ? '●' : '×'} ${unit}.service - ${svc.description}`,
    `     Loaded: loaded (/lib/systemd/system/${unit}.service; ${svc.enabled ? 'enabled' : 'disabled'}; preset: enabled)`,
    `     Active: ${active}`,
    '',
    ...svc.logs.slice(-10),
  ];
}

const systemctl: Command = (ctx, args) => {
  const r = flags(ctx, 'systemctl', args, { bool: 'ql', long: { 'no-pager': 'bool', now: 'bool' } });
  if (isResult(r)) return r;
  const [sub, unitRaw] = r.rest;
  if (!sub || !unitRaw || r.rest.length > 2) return fail([ctx.t('sh.usage', { usage: USAGE['systemctl']! })]);
  const unit = unitRaw.replace(/\.service$/, '');
  const svc = own(ctx.s.services, unit);
  switch (sub) {
    case 'status':
      if (!svc) return fail([ctx.t('sh.unit_not_found', { unit })], 4);
      return { out: statusBlock(ctx, unit), exit: svc.state === 'active' ? 0 : 3, fail: false };
    case 'restart':
    case 'start': {
      if (!svc) return fail([ctx.t('sh.restart_not_found', { unit, verb: sub })], 5);
      const rule = own(ctx.serviceRules, unit);
      const spec = own(ctx.spec.services, unit)?.restart;
      const now = clock(ctx.s);
      ctx.s.restarted.push(unit);
      // systemd runs `nginx -t` before it starts nginx: a broken config fails with its own error
      const conf = unit === 'nginx' ? nginxTest(ctx.s) : null;
      if (conf && !conf.ok) {
        svc.state = 'failed';
        const pid = 1200 + ctx.s.counters.commands;
        svc.logs.push(
          `${now} ${ctx.s.host} systemd[1]: Starting ${unit}.service - ${svc.description}...`,
          ...conf.lines.map((l) => `${now} ${ctx.s.host} nginx[${pid}]: ${l}`),
          `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Control process exited, code=exited, status=1/FAILURE`,
          `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Failed with result 'exit-code'.`,
          `${now} ${ctx.s.host} systemd[1]: Failed to start ${unit}.service - ${svc.description}.`,
        );
        return fail([ctx.t('sh.restart_failed', { unit }), ctx.t('sh.restart_failed_hint', { unit })]);
      }
      if (rule === undefined || test(rule, ctx.env)) {
        svc.state = 'active';
        svc.logs.push(
          ...(spec?.logs_on_success ?? [
            `${now} ${ctx.s.host} systemd[1]: Starting ${unit}.service - ${svc.description}...`,
            `${now} ${ctx.s.host} systemd[1]: Started ${unit}.service - ${svc.description}.`,
          ]),
        );
        return ok();
      }
      svc.state = 'failed';
      svc.logs.push(
        `${now} ${ctx.s.host} systemd[1]: Starting ${unit}.service - ${svc.description}...`,
        ...(spec?.logs_on_failure ?? []),
        `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Control process exited, code=exited, status=1/FAILURE`,
        `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Failed with result 'exit-code'.`,
        `${now} ${ctx.s.host} systemd[1]: Failed to start ${unit}.service - ${svc.description}.`,
      );
      return fail([ctx.t('sh.restart_failed', { unit }), ctx.t('sh.restart_failed_hint', { unit })]);
    }
    case 'stop': {
      if (!svc) return fail([ctx.t('sh.restart_not_found', { unit, verb: sub })], 5);
      const now = clock(ctx.s);
      if (svc.state === 'active') svc.logs.push(`${now} ${ctx.s.host} systemd[1]: Stopping ${unit}.service - ${svc.description}...`, `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Deactivated successfully.`);
      svc.state = 'inactive';
      return ok();
    }
    case 'reload': {
      if (!svc) return fail([ctx.t('sh.restart_not_found', { unit, verb: sub })], 5);
      if (svc.state !== 'active') return fail([`${unit}.service is not active, cannot reload.`]);
      const conf = unit === 'nginx' ? nginxTest(ctx.s) : null;
      const now = clock(ctx.s);
      if (conf && !conf.ok) {
        // the running nginx keeps its old config; the reload job fails
        svc.logs.push(`${now} ${ctx.s.host} systemd[1]: Reloading ${unit}.service - ${svc.description}...`, ...conf.lines.map((l) => `${now} ${ctx.s.host} nginx[${1200 + ctx.s.counters.commands}]: ${l}`), `${now} ${ctx.s.host} systemd[1]: ${unit}.service: Control process exited, code=exited, status=1/FAILURE`, `${now} ${ctx.s.host} systemd[1]: Reload failed for ${unit}.service - ${svc.description}.`);
        return fail([`Job for ${unit}.service failed because the control process exited with error code.`, ctx.t('sh.restart_failed_hint', { unit })]);
      }
      svc.logs.push(`${now} ${ctx.s.host} systemd[1]: Reloading ${unit}.service - ${svc.description}...`, `${now} ${ctx.s.host} systemd[1]: Reloaded ${unit}.service - ${svc.description}.`);
      return ok();
    }
    case 'is-active':
      if (!svc) return { out: ['inactive'], exit: 3, fail: false };
      return { out: [svc.state], exit: svc.state === 'active' ? 0 : 3, fail: false };
    default:
      return fail([ctx.t('sh.usage', { usage: USAGE['systemctl']! })]);
  }
};

const journalctl: Command = (ctx, args) => {
  const r = flags(ctx, 'journalctl', args, {
    bool: 'xefqr',
    value: 'un',
    long: { unit: 'value', lines: 'value', 'no-pager': 'bool', follow: 'bool' },
  });
  if (isResult(r)) return r;
  const { f } = r;
  const unitRaw = f['u'] ?? f['unit'];
  if (typeof unitRaw !== 'string') return fail([ctx.t('sh.journalctl_need_unit')]);
  const unit = unitRaw.replace(/\.service$/, '');
  const svc = own(ctx.s.services, unit);
  if (!svc || svc.logs.length === 0) return ok([ctx.t('sh.no_entries')]);
  const nRaw = f['n'] ?? f['lines'];
  let logs = svc.logs;
  if (nRaw !== undefined) {
    const n = Number(nRaw);
    if (!Number.isInteger(n) || n < 0) return fail([ctx.t('sh.bad_number', { cmd: 'journalctl', value: String(nRaw) })]);
    logs = n === 0 ? [] : logs.slice(-n);
  }
  const out = [...logs];
  if (f['f'] || f['follow']) out.push(ctx.t('sh.follow_note'));
  return f['no-pager'] ? ok(out) : ok(out, { pager: true });
};


/** A small diff of two texts: one hunk around the changed lines, three lines of context. */
export function diffLines(path: string, before: string, after: string): string[] {
  const a = lines(before);
  const b = lines(after);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const from = Math.max(0, start - 3);
  const toA = Math.min(a.length, endA + 3);
  const toB = Math.min(b.length, endB + 3);
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -${from + 1},${toA - from} +${from + 1},${toB - from} @@`,
    ...a.slice(from, start).map((l) => ` ${l}`),
    ...a.slice(start, endA).map((l) => `-${l}`),
    ...b.slice(start, endB).map((l) => `+${l}`),
    ...a.slice(endA, toA).map((l) => ` ${l}`),
  ];
}

const sizeOnly = (sig: string | undefined): boolean => sig === undefined || sig.startsWith('\u0000');

const git: Command = (ctx, argsIn) => {
  let args = argsIn;
  // git -C <dir> runs as if started in <dir>
  if (args[0] === '-C') {
    const dir = args[1];
    if (dir === undefined) return fail([ctx.t('sh.usage', { usage: USAGE['git']! })], 129);
    const p = abs(ctx, dir);
    if (!isDir(ctx.s, p)) return fail([`fatal: cannot change to '${dir}': No such file or directory`], 128);
    const saved = ctx.s.cwd;
    ctx.s.cwd = p;
    try {
      return git(ctx, args.slice(2), null);
    } finally {
      ctx.s.cwd = saved;
    }
  }
  if (args[0] === '--version' || args[0] === 'version') return ok(['git version 2.43.0']);
  const g = ctx.s.git;
  if (!g || !isUnder(ctx.s.cwd, g.root)) {
    // honest, and helpful: name the repository this machine does have
    return fail(g ? [ctx.t('sh.not_git'), ctx.t('sh.not_git_here', { root: g.root })] : [ctx.t('sh.not_git')], 128);
  }
  if (args[0] === undefined || args[0] === 'help' || args[0] === '--help') return ok([ctx.t('sh.usage', { usage: USAGE['git']! })]);
  const [sub, ...subArgs] = args;
  switch (sub) {
    case 'log': {
      const r = flags(ctx, 'git', subArgs, { value: 'n', long: { oneline: 'bool', 'no-pager': 'bool', stat: 'bool' } });
      if (isResult(r)) return r;
      const n = typeof r.f['n'] === 'string' ? Number(r.f['n']) : Infinity;
      const shown = [...g.log].reverse().slice(0, Number.isFinite(n) ? n : undefined);
      if (r.f['oneline']) return ok(shown.map((c, i) => `${c.hash}${i === 0 ? ` (HEAD -> ${g.branch})` : ''} ${c.msg}`));
      return ok(shown.flatMap((c, i) => [
        `commit ${c.hash}${'0'.repeat(33)}${i === 0 ? ` (HEAD -> ${g.branch})` : ''}`,
        `Author: ${ctx.s.user} <${ctx.s.user}@${ctx.s.host}>`,
        `Date:   Thu Nov 26 ${i === shown.length - 1 && c.msg === 'Initial import' ? '06:00:00' : clock(ctx.s).slice(7)} 2026 +0100`,
        '',
        `    ${c.msg}`,
        '',
      ]), { pager: true });
    }
    case 'diff': {
      const r = flags(ctx, 'git', subArgs, { long: { staged: 'bool', cached: 'bool', stat: 'bool', 'name-only': 'bool' } });
      if (isResult(r)) return r;
      const staged = r.f['staged'] === true || r.f['cached'] === true;
      const c = gitChanges(ctx.s);
      const paths = (staged ? c.staged : c.unstaged).filter((p) => r.rest.length === 0 || r.rest.some((a) => isUnder(join(g.root, p), abs(ctx, a))));
      if (r.f['name-only']) return ok(paths);
      const out: string[] = [];
      for (const p of paths) {
        const before = staged ? own(g.head, p) : own(g.index, p);
        const afterSig = staged ? own(g.index, p) : signature(ctx.s.fs[join(g.root, p)]);
        if (sizeOnly(before) && before !== undefined || sizeOnly(afterSig) && afterSig !== undefined) {
          out.push(`diff --git a/${p} b/${p}`, `Binary files a/${p} and b/${p} differ`);
          continue;
        }
        out.push(...diffLines(p, before ?? '', afterSig ?? ''));
      }
      return ok(out, out.length > 20 ? { pager: true } : undefined);
    }
    case 'branch':
      return ok([`* ${g.branch}`]);
    case 'restore':
    case 'checkout': {
      const r = flags(ctx, 'git', subArgs, { long: { staged: 'bool' } });
      if (isResult(r)) return r;
      const targets = r.rest.filter((a) => a !== '--');
      if (targets.length === 0) return fail([ctx.t('sh.usage', { usage: 'git restore [--staged] <path...>' })], 128);
      for (const a of targets) {
        const p = abs(ctx, a);
        if (!isUnder(p, g.root)) return fail([ctx.t('sh.git_outside', { path: a })], 128);
        const rel = relativeTo(p, g.root);
        const known = Object.keys(g.index).filter((k) => rel === '' || k === rel || k.startsWith(rel + '/'));
        if (known.length === 0) return fail([`error: pathspec '${a}' did not match any file(s) known to git`], 1);
        for (const k of known) {
          if (r.f['staged']) {
            const h = own(g.head, k);
            if (h === undefined) delete g.index[k];
            else setOwn(g.index, k, h);
            continue;
          }
          const sig = own(g.index, k)!;
          const full = join(g.root, k);
          if (sig.startsWith('\u0000')) continue; // a file known only by its size stays as it is
          writeFile(ctx.s.fs, full, sig);
        }
      }
      return ok();
    }
    case 'status': {
      const c = gitChanges(ctx.s);
      const out = [ctx.t('sh.git_on_branch', { branch: g.branch })];
      if (c.staged.length + c.unstaged.length + c.untracked.length === 0) {
        out.push(ctx.t('sh.git_clean'));
        return ok(out);
      }
      if (c.staged.length > 0) {
        out.push(ctx.t('sh.git_staged'));
        for (const p of c.staged) {
          const label = !has(g.head, p) ? 'new file:' : !has(g.index, p) ? 'deleted:' : 'modified:';
          out.push(`\t${label.padEnd(12)}${p}`);
        }
        out.push('');
      }
      if (c.unstaged.length > 0) {
        out.push(ctx.t('sh.git_unstaged'));
        for (const p of c.unstaged) {
          const exists = ctx.s.fs[join(g.root, p)] !== undefined;
          out.push(`\t${(exists ? 'modified:' : 'deleted:').padEnd(12)}${p}`);
        }
        out.push('');
      }
      if (c.untracked.length > 0) {
        out.push(ctx.t('sh.git_untracked'));
        for (const p of c.untracked) out.push(`\t${p}`);
        out.push('');
      }
      return ok(out);
    }
    case 'add': {
      const r = flags(ctx, 'git', subArgs, { bool: 'Av', long: { all: 'bool' } });
      if (isResult(r)) return r;
      const specs = r.f['A'] || r.f['all'] ? [g.root] : r.rest.map((a) => abs(ctx, a));
      if (specs.length === 0) return { out: [ctx.t('sh.git_add_nothing')], exit: 0, fail: true };
      for (const [i, p] of specs.entries()) {
        if (!isUnder(p, g.root)) return fail([ctx.t('sh.git_outside', { path: r.rest[i] ?? p })], 128);
        const rel = relativeTo(p, g.root);
        const under = (k: string) => rel === '' || k === rel || k.startsWith(rel + '/');
        const work = subtree(ctx.s, p).filter((k) => ctx.s.fs[k]!.type === 'file');
        const known = Object.keys(g.index).filter(under);
        if (work.length === 0 && known.length === 0) {
          return fail([ctx.t('sh.git_pathspec', { path: r.rest[i] ?? rel })], 128);
        }
        for (const k of known) delete g.index[k];
        for (const k of work) setOwn(g.index, relativeTo(k, g.root), signature(ctx.s.fs[k])!);
      }
      return ok();
    }
    case 'commit': {
      const r = flags(ctx, 'git', subArgs, { bool: 'aq', value: 'm', long: { message: 'value', all: 'bool' } });
      if (isResult(r)) return r;
      const msg = r.f['m'] ?? r.f['message'];
      if (typeof msg !== 'string' || msg.trim() === '') return fail([ctx.t('sh.git_need_message')]);
      if (r.f['a'] || r.f['all']) {
        for (const k of Object.keys(g.index)) {
          const sig = signature(ctx.s.fs[join(g.root, k)]);
          if (sig === undefined) delete g.index[k];
          else setOwn(g.index, k, sig);
        }
      }
      const c = gitChanges(ctx.s);
      if (c.staged.length === 0) {
        const dirty = c.unstaged.length + c.untracked.length > 0;
        return fail([ctx.t(dirty ? 'sh.git_nothing_staged' : 'sh.git_clean')]);
      }
      g.head = { ...g.index };
      g.commits++;
      const hash = gitHash(`${msg}#${g.commits}`);
      g.log.push({ hash, msg });
      const out = [`[${g.branch} ${hash}] ${msg}`, ctx.t('sh.git_files_changed', { n: c.staged.length })];
      const pf = pipelineFile(ctx.spec, ctx.s);
      if (pf) {
        ctx.s.pipeline.runs++;
        const n = 41 + ctx.s.pipeline.runs;
        const committed = own(g.head, relativeTo(pf, g.root));
        const result =
          committed === undefined || committed.startsWith('\u0000')
            ? { ok: false, errors: [`${relativeTo(pf, g.root)} is missing`] }
            : validateNinesCi(committed);
        ctx.s.pipeline.status = result.ok ? 'passed' : 'failed';
        out.push(ctx.t('sh.ci_started', { n, branch: g.branch }));
        if (result.ok) out.push(ctx.t('sh.ci_passed', { n }));
        else out.push(ctx.t('sh.ci_failed', { n }), ...result.errors.map((e) => `ci:   - ${e}`));
        return { out, exit: 0, fail: !result.ok };
      }
      return ok(out);
    }
    default:
      return fail([ctx.t('sh.usage', { usage: USAGE['git']! })]);
  }
};

// ------------------------------------------------------------------ session

/** `help` lists these with a line each; the base shell's everyday commands follow on one line. */
export const HELP_ORDER = [
  'ls', 'cd', 'pwd', 'cat', 'less', 'tail', 'grep', 'find', 'df', 'du', 'rm', 'mv', 'edit',
  'systemctl', 'journalctl', 'nginx', 'kubectl', 'git', 'ps', 'kill', 'who', 'clear', 'exit',
];
/** The rest of the base shell, named on one line under the list. */
export const HELP_MORE = [
  'whoami', 'id', 'w', 'last', 'logout', 'hostname', 'uname', 'env', 'echo', 'date', 'uptime',
  'head', 'wc', 'sort', 'uniq', 'which', 'man', 'history', 'pkill',
];

/** nginx is a command only where nginx is installed. */
export const hasNginx = (s: SimState): boolean => s.fs['/etc/nginx/nginx.conf'] !== undefined || has(s.services, 'nginx');

const help: Command = (ctx, args) => {
  const topic = args[0];
  if (topic !== undefined) {
    const name = own(ALIASES, topic) ?? topic;
    const usage = own(USAGE, name);
    if (usage === undefined || (name === 'nginx' && !hasNginx(ctx.s))) return fail([ctx.t('sh.help_unknown', { cmd: topic })]);
    return ok([usage, `  ${ctx.t(`help.${name}`)}`]);
  }
  const list = HELP_ORDER.filter((c) => c !== 'nginx' || hasNginx(ctx.s));
  return ok([ctx.t('help.intro'), ...list.map((c) => `  ${c.padEnd(11)} ${ctx.t(`help.${c}`)}`), '', ctx.t('help.more', { list: HELP_MORE.join(' ') })]);
};

/** man <cmd>: the short manual, help's usage and line under a man-like header. */
const man: Command = (ctx, args) => {
  const topic = args.find((a) => !a.startsWith('-'));
  if (topic === undefined) return fail(['What manual page do you want?', 'For example, try \'man man\'.']);
  const name = own(ALIASES, topic) ?? topic;
  const usage = name === 'man' ? USAGE['man'] : own(USAGE, name);
  if (usage === undefined || (name === 'nginx' && !hasNginx(ctx.s))) return fail([`No manual entry for ${topic}`]);
  return ok([`${name.toUpperCase()}(1)`, '', 'NAME', `       ${name} - ${ctx.t(`help.${name}`)}`, '', 'SYNOPSIS', `       ${usage}`, '', ctx.t('sh.man_note')]);
};

const ALIASES: Record<string, string> = { nano: 'edit', vi: 'edit', vim: 'edit', printenv: 'env', killall: 'pkill' };

export const COMMANDS: Record<string, Command> = {
  help,
  ls,
  cd,
  pwd,
  cat: catLike('cat'),
  less: catLike('less'),
  tail,
  grep,
  df,
  du,
  rm,
  mv,
  edit: editor('edit'),
  nano: editor('nano'),
  vi: editor('vi'),
  vim: editor('vim'),
  systemctl,
  journalctl,
  kubectl,
  nginx,
  git,
  man,
  clear: () => ok([], { clear: true }),
  exit: () => ok([], { close: true }),
  ...BASIC_COMMANDS,
  ...PROC_COMMANDS,
};
COMMANDS['which'] = makeWhich((name) => has(COMMANDS, name));

/** Commands whose first operand is a subcommand worth remembering for ran("git commit"). */
export const SUBCOMMANDS = new Set(['systemctl', 'kubectl', 'git']);
