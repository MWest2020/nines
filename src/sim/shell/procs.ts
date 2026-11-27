// Logins and processes: who, w, last, ps, kill, pkill, killall and logout. The logins come from
// the scenario's `sessions` (or the player's own default shell, src/sim/base.ts); the processes
// are derived: init, sshd and cron, a process per running service (nginx as a master and a
// worker), a shell per login, and ps itself. Killing has consequences, not blocks: a service's
// main process dies and the service fails; another login's shell dies and that login ends; init
// and your own shell are refused with a word of explanation (a kiosk's own shell logs you straight
// back in, anonymously, which is how a kiosk signs out).

import { own } from '../../rules/own';
import { clockTime, type Login, pidOf } from '../base';
import { clock, type Command, type Ctx, fail, ok } from './util';

interface Proc {
  pid: number;
  user: string;
  tty: string;
  cmd: string;
  /** what pkill matches: the program name */
  name: string;
  kind: 'init' | 'system' | 'service' | 'worker' | 'login' | 'ps';
  /** the service or login it belongs to */
  of?: string;
}

const hhmm = (ctx: Ctx): string => clockTime(ctx.s.counters.commands).slice(0, 5);

export function processes(ctx: Ctx): Proc[] {
  const list: Proc[] = [
    { pid: 1, user: 'root', tty: '?', cmd: '/sbin/init', name: 'systemd', kind: 'init' },
    { pid: 389, user: 'root', tty: '?', cmd: '/usr/sbin/cron -f', name: 'cron', kind: 'system' },
    { pid: 412, user: 'root', tty: '?', cmd: 'sshd: /usr/sbin/sshd -D [listener] 0 of 10-100 startups', name: 'sshd', kind: 'system' },
  ];
  for (const [name, svc] of Object.entries(ctx.s.services).sort()) {
    if (svc.state !== 'active') continue;
    const pid = pidOf(name, 600, 900);
    if (name === 'nginx') {
      list.push({ pid, user: 'root', tty: '?', cmd: 'nginx: master process /usr/sbin/nginx -g daemon on; master_process on;', name: 'nginx', kind: 'service', of: name });
      list.push({ pid: pid + 1, user: 'www-data', tty: '?', cmd: 'nginx: worker process', name: 'nginx', kind: 'worker', of: name });
    } else {
      list.push({ pid, user: 'root', tty: '?', cmd: `/usr/local/bin/${name}`, name, kind: 'service', of: name });
    }
  }
  for (const l of ctx.s.logins) {
    if (l.active) list.push({ pid: l.pid, user: l.user, tty: l.tty, cmd: '-bash', name: 'bash', kind: 'login', of: l.id });
  }
  return list.filter((p) => !ctx.s.killed.includes(p.pid)).sort((a, b) => a.pid - b.pid);
}

const self = (ctx: Ctx): Login | undefined => ctx.s.logins.find((l) => l.self && l.active);

// ------------------------------------------------------------------ who, w, last

const who: Command = (ctx) =>
  ok(ctx.s.logins.filter((l) => l.active).map((l) => `${l.user.padEnd(8)} ${l.tty.padEnd(12)} 2026-11-26 ${l.login} (${l.from})`));

const w: Command = (ctx) => {
  const active = ctx.s.logins.filter((l) => l.active);
  return ok([
    ` ${clockTime(ctx.s.counters.commands)} up 3 days, 12:53,  ${active.length} user${active.length === 1 ? '' : 's'},  load average: 0.08, 0.05, 0.01`,
    'USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT',
    ...active.map((l) => `${l.user.padEnd(8)} ${l.tty.padEnd(8)} ${l.from.slice(0, 16).padEnd(16)} ${l.login.padEnd(8)} ${l.self ? ' 0.00s' : ' 4:12 '}  0.02s  0.00s ${l.self ? 'w' : '-bash'}`),
  ]);
};

const last: Command = (ctx, args) => {
  const user = args.find((a) => !a.startsWith('-'));
  const rows = [...ctx.s.logins]
    .filter((l) => user === undefined || l.user === user)
    .sort((a, b) => (b.login + b.pid).localeCompare(a.login + a.pid))
    .map((l) => `${l.user.padEnd(8)} ${l.tty.padEnd(12)} ${l.from.slice(0, 16).padEnd(16)} Thu Nov 26 ${l.login}   ${l.active ? 'still logged in' : `- ${l.logout ?? hhmm(ctx)}`}`);
  return ok([
    ...rows,
    ...(user === undefined || user === 'reboot' ? [`reboot   system boot  6.8.0-nines      Mon Nov 23 20:07   still running`] : []),
    '',
    'wtmp begins Mon Nov 23 20:07:11 2026',
  ]);
};

// ------------------------------------------------------------------ ending things

/** End a login; a kiosk's own shell logs straight back in as its anonymous guest. */
function endLogin(ctx: Ctx, l: Login): string[] {
  l.active = false;
  l.logout = hhmm(ctx);
  if (l.self && l.relogin) {
    ctx.s.logins.push({ id: `${l.id}-relogin`, user: l.user, tty: l.tty, from: l.relogin, login: hhmm(ctx), pid: 3100 + ctx.s.counters.commands, self: true, active: true });
    return [ctx.t('sh.logout_relogin', { from: l.from, to: l.relogin })];
  }
  return [];
}

/** What killing one process does. `out` gets messages; returns false when refused. */
function killOne(ctx: Ctx, p: Proc, out: string[], via: 'kill' | 'pkill'): boolean {
  switch (p.kind) {
    case 'init':
      out.push(ctx.t('sh.kill_init', { cmd: via }));
      return false;
    case 'ps':
      return true;
    case 'worker':
      // the master starts a new worker at once: nothing changes
      return true;
    case 'service': {
      const svc = own(ctx.s.services, p.of!);
      if (svc) {
        svc.state = 'failed';
        svc.logs.push(
          `${clock(ctx.s)} ${ctx.s.host} systemd[1]: ${p.of}.service: Main process exited, code=killed, status=15/TERM`,
          `${clock(ctx.s)} ${ctx.s.host} systemd[1]: ${p.of}.service: Failed with result 'signal'.`,
        );
      }
      return true;
    }
    case 'login': {
      const l = ctx.s.logins.find((x) => x.id === p.of && x.active);
      if (!l) return true;
      if (l.self && !l.relogin) {
        out.push(ctx.t(via === 'kill' ? 'sh.kill_self' : 'sh.pkill_spared', { pid: p.pid }));
        return false;
      }
      out.push(...endLogin(ctx, l));
      return true;
    }
    default:
      ctx.s.killed.push(p.pid);
      return true;
  }
}

const SIGNALS = ['HUP', 'INT', 'QUIT', 'KILL', 'TERM', 'USR1', 'USR2', 'STOP', 'CONT'];

const kill: Command = (ctx, args) => {
  if (args[0] === '-l' || args[0] === '-L') return ok([SIGNALS.map((s, i) => `${[1, 2, 3, 9, 15, 10, 12, 19, 18][i]}) SIG${s}`).join('  ')]);
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '-s' || a === '-n') i++;
    else if (/^-(\d+|[A-Z]+|SIG[A-Z]+)$/.test(a)) continue;
    else rest.push(a);
  }
  if (rest.length === 0) return fail(['kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]'], 2);
  const procs = processes(ctx);
  const out: string[] = [];
  let bad = false;
  for (const a of rest) {
    if (!/^\d+$/.test(a)) {
      out.push(`bash: kill: ${a}: arguments must be process or job IDs`);
      bad = true;
      continue;
    }
    const p = procs.find((x) => x.pid === Number(a));
    if (!p) {
      out.push(`bash: kill: (${a}) - No such process`);
      bad = true;
      continue;
    }
    if (!killOne(ctx, p, out, 'kill')) bad = true;
  }
  return bad ? { out, exit: 1, fail: true } : ok(out);
};

/** pkill and killall: by name, user (-u) or terminal (-t). */
function pkillLike(cmd: 'pkill' | 'killall'): Command {
  return (ctx, args) => {
    let user: string | undefined;
    let tty: string | undefined;
    const names: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i]!;
      if (a === '-u' || a === '-U' || a === '--user') user = args[++i];
      else if (a === '-t' || a === '--terminal') tty = args[++i];
      else if (a === '-s' || a === '--signal') i++;
      else if (/^-(\d+|[A-Z]+|SIG[A-Z]+|f|e|x|9)$/.test(a)) continue;
      else if (a.startsWith('-')) return fail([`${cmd}: invalid option -- '${a.replace(/^-+/, '')}'`], 2);
      else names.push(a);
    }
    if (names.length === 0 && user === undefined && tty === undefined) {
      return fail([cmd === 'pkill' ? 'pkill: no matching criteria specified' : 'Usage: killall [OPTION]... [--] NAME...'], 2);
    }
    const hits = processes(ctx).filter(
      (p) =>
        (user === undefined || p.user === user) &&
        (tty === undefined || p.tty === tty || p.tty === tty.replace(/^\/dev\//, '')) &&
        (names.length === 0 || names.some((n) => (cmd === 'killall' ? p.name === n : p.name.includes(n) || p.cmd.includes(n)))),
    );
    if (hits.length === 0) return { out: cmd === 'killall' ? names.map((n) => `${n}: no process found`) : [], exit: 1, fail: true };
    const out: string[] = [];
    // the player's own shell last, so its note comes after everything else
    for (const p of [...hits].sort((a, b) => Number(a.kind === 'login' && ctx.s.logins.find((l) => l.id === a.of)?.self) - Number(b.kind === 'login' && ctx.s.logins.find((l) => l.id === b.of)?.self))) {
      killOne(ctx, p, out, 'pkill');
    }
    return ok(out);
  };
}

// ------------------------------------------------------------------ ps

const ps: Command = (ctx, args) => {
  const joined = args.join(' ');
  const userIdx = args.findIndex((a) => a === '-u' || a === '-U' || a === '--user');
  const user = userIdx >= 0 ? args[userIdx + 1] : undefined;
  const bsd = args.some((a) => !a.startsWith('-') && /^[auxwef]+$/.test(a));
  const everyone = bsd ? /[ax]/.test(joined) : args.some((a) => /^-[a-zA-Z]*[eA]/.test(a));
  const me = self(ctx);
  const mine = (p: Proc) => (user !== undefined ? p.user === user : everyone || (me !== undefined && p.tty === me.tty));
  const psPid = 3000 + ctx.s.counters.commands;
  const procs = [...processes(ctx), { pid: psPid, user: me?.user ?? ctx.s.user, tty: me?.tty ?? 'pts/0', cmd: `ps ${joined}`.trim(), name: 'ps', kind: 'ps' as const }].filter(mine);
  const tty = (p: Proc) => p.tty.padEnd(8);
  if (bsd && /u/.test(joined)) {
    return ok([
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
      ...procs.map((p) => `${p.user.padEnd(10)} ${String(p.pid).padStart(5)}  ${p.kind === 'service' ? '0.3' : '0.0'}  ${p.kind === 'service' ? '1.2' : '0.1'} ${String(pidOf(p.cmd, 4000, 90000)).padStart(6)} ${String(pidOf(p.cmd, 900, 9000)).padStart(5)} ${tty(p)} ${p.kind === 'login' ? 'Ss ' : p.kind === 'ps' ? 'R+ ' : 'Ss '}  ${p.kind === 'login' ? '08:57' : 'Nov23'}   0:00 ${p.cmd}`),
    ]);
  }
  if (args.some((a) => /^-[a-zA-Z]*f/.test(a)) || joined.includes('-ef')) {
    return ok([
      'UID          PID    PPID  C STIME TTY          TIME CMD',
      ...procs.map((p) => `${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.kind === 'init' ? 0 : p.kind === 'worker' ? p.pid - 1 : p.kind === 'ps' ? (me?.pid ?? 1) : 1).padStart(7)}  0 ${p.kind === 'login' || p.kind === 'ps' ? '08:57' : 'Nov23'} ${p.tty.padEnd(12)} 00:00:00 ${p.cmd}`),
    ]);
  }
  return ok(['    PID TTY          TIME CMD', ...procs.map((p) => `${String(p.pid).padStart(7)} ${p.tty.padEnd(12)} 00:00:00 ${p.kind === 'login' ? 'bash' : p.cmd.split(' ')[0]!.replace(/^.*\//, '').replace(/:$/, '')}`)]);
};

// ------------------------------------------------------------------ logout

const logout: Command = (ctx) => {
  const me = self(ctx);
  if (me?.relogin) return ok(endLogin(ctx, me));
  return ok(['logout'], { close: true });
};

export const PROC_COMMANDS: Record<string, Command> = {
  who,
  w,
  last,
  ps,
  kill,
  pkill: pkillLike('pkill'),
  killall: pkillLike('killall'),
  logout,
};
