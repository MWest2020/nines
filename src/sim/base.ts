// The shared base every simulated machine starts from (Mark's playtest, 27 Nov 2026: "basic
// commands should just be there"). A scenario only adds or overrides: its files win over these,
// its sessions join the logins, its services become processes. Pure and deterministic.
//
// The base is a small Debian-like box: /etc with passwd, group, hostname, hosts, os-release and a
// motd; /home, /root, /tmp, /usr/bin, /var/log; the logins `who` shows and the processes `ps`
// lists. Its files are small and count as part of the mount's `base_used`, so a scenario's disk
// numbers (df, disk_usage) do not move.

import type { ScenarioSpec } from '../content/types';

export const BASE_DIRS = ['/bin', '/etc', '/home', '/root', '/tmp', '/usr/bin', '/usr/sbin', '/var/log'];

/** The kernel every machine runs, for uname and os-release. */
export const KERNEL = { release: '6.8.0-nines', version: '#1 SMP PREEMPT_DYNAMIC Thu Nov 26 06:00:00 UTC 2026', machine: 'x86_64' } as const;

/** A login session: who, w and last show it; kill, pkill and logout end it. */
export interface Login {
  /** scenario id (session_active() asks about it); the player's own default is "you" */
  id: string;
  user: string;
  tty: string;
  /** where from: an address, a desk, "library card 4417" */
  from: string;
  /** HH:MM on the machine's day */
  login: string;
  pid: number;
  /** the player's own shell */
  self: boolean;
  active: boolean;
  /** HH:MM when it ended, for last */
  logout?: string;
  /** a kiosk logs you straight back in, anonymously, when you log out: the shell stays */
  relogin?: string;
}

interface User {
  name: string;
  uid: number;
  home: string;
  shell: string;
  gecos: string;
}

/** System accounts, then the scenario's user and anyone else who logs in. */
export function usersOf(spec: ScenarioSpec): User[] {
  const users: User[] = [
    { name: 'root', uid: 0, home: '/root', shell: '/bin/bash', gecos: 'root' },
    { name: 'daemon', uid: 1, home: '/usr/sbin', shell: '/usr/sbin/nologin', gecos: 'daemon' },
    { name: 'bin', uid: 2, home: '/bin', shell: '/usr/sbin/nologin', gecos: 'bin' },
    { name: 'sys', uid: 3, home: '/dev', shell: '/usr/sbin/nologin', gecos: 'sys' },
    { name: 'www-data', uid: 33, home: '/var/www', shell: '/usr/sbin/nologin', gecos: 'www-data' },
    { name: 'nobody', uid: 65534, home: '/nonexistent', shell: '/usr/sbin/nologin', gecos: 'nobody' },
  ];
  const add = (name: string, home: string) => {
    if (!users.some((u) => u.name === name)) users.push({ name, uid: 1000 + users.filter((u) => u.uid >= 1000 && u.uid < 65534).length, home, shell: '/bin/bash', gecos: name });
  };
  add(spec.user, spec.home);
  for (const s of spec.sessions ?? []) add(s.user ?? spec.user, `/home/${s.user ?? spec.user}`);
  return users;
}

export const uidOf = (spec: ScenarioSpec, name: string): number | undefined => usersOf(spec).find((u) => u.name === name)?.uid;

/** The base files, path -> content. The scenario's own files replace any of them. */
export function baseFiles(spec: ScenarioSpec): Record<string, string> {
  const users = usersOf(spec);
  const passwd = users.map((u) => `${u.name}:x:${u.uid}:${u.uid === 65534 ? 65534 : u.uid}:${u.gecos}:${u.home}:${u.shell}`).join('\n') + '\n';
  const groups = [
    ...users.filter((u) => u.uid < 1000 || u.uid === 65534).map((u) => `${u.name === 'nobody' ? 'nogroup' : u.name}:x:${u.uid}:`),
    `sudo:x:27:${spec.user}`,
    `adm:x:4:${spec.user}`,
    ...users.filter((u) => u.uid >= 1000 && u.uid < 65534).map((u) => `${u.name}:x:${u.uid}:`),
  ].join('\n') + '\n';
  return {
    '/etc/hostname': `${spec.host}\n`,
    '/etc/hosts': `127.0.0.1 localhost\n127.0.1.1 ${spec.host}\n::1 localhost ip6-localhost ip6-loopback\n`,
    '/etc/passwd': passwd,
    '/etc/group': groups,
    '/etc/shells': '/bin/sh\n/bin/bash\n',
    '/etc/os-release': [
      'PRETTY_NAME="Nines Linux 1.0 (junior)"',
      'NAME="Nines Linux"',
      'VERSION_ID="1.0"',
      'VERSION="1.0 (junior)"',
      'ID=nines',
      'ID_LIKE=debian',
      '',
    ].join('\n'),
    '/etc/motd': `Welcome to ${spec.host} (Nines Linux 1.0, ${KERNEL.release} ${KERNEL.machine}).\nBe kind to this machine; it is the only one it has.\n`,
  };
}

/** HH:MM:SS of the machine's fake clock: 09:00 plus seven seconds per command. */
export function clockTime(commands: number): string {
  const secs = 9 * 3600 + commands * 7;
  return [Math.floor(secs / 3600) % 24, Math.floor(secs / 60) % 60, secs % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

/** The logins at the start: the scenario's sessions, or the player's own shell. */
export function baseLogins(spec: ScenarioSpec, flags: Record<string, boolean>): Login[] {
  const listed = spec.sessions ?? [];
  const logins: Login[] = listed.map((s, i) => {
    const covered = s.cover !== undefined && flags[s.cover.flag] === true;
    return {
      id: s.id,
      user: s.user ?? spec.user,
      tty: s.tty,
      from: covered ? s.cover!.from : s.from,
      login: s.login ?? '08:57',
      pid: 2101 + i * 37,
      self: s.self === true,
      active: s.logout === undefined,
      ...(s.logout !== undefined ? { logout: s.logout } : {}),
      ...(s.relogin !== undefined ? { relogin: s.relogin } : {}),
    };
  });
  if (!logins.some((l) => l.self)) {
    logins.push({ id: 'you', user: spec.user, tty: 'pts/0', from: '10.20.0.7', login: '08:57', pid: 2101 + logins.length * 37, self: true, active: true });
  }
  return logins;
}

/** A small stable number from a name, for process ids. */
export function pidOf(name: string, base: number, span: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return base + (h % span);
}
