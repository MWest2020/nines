// The shared base shell (Mark's playtest, 27 Nov 2026): every machine has /etc, the logins and
// the everyday commands, whatever its quest; a scenario only adds or overrides. And an unknown
// command says so honestly and lands in the dev-only list.

import { beforeEach, describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/content/types';
import { createSession, run } from '../../src/sim/session';
import { clearUnknown, unknownCommands } from '../../src/sim/unknown';
import { content, FIXTURE, session, sh, t } from '../helpers';

describe('the base machine', () => {
  it('has /etc with passwd, group, hostname, hosts, os-release and a motd, and the usual dirs', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'ls /')).toMatch(/^bin\/\netc\/\nhome\/\nroot\/\ntmp\/\nusr\/\nvar\/$/);
    expect(sh(s, 'cat /etc/hostname')).toBe('box');
    expect(sh(s, 'cat /etc/hosts')).toMatch(/127\.0\.1\.1 box/);
    expect(sh(s, 'grep ^dev: /etc/passwd')).toBe('dev:x:1000:1000:dev:/home/dev:/bin/bash');
    expect(sh(s, 'grep sudo /etc/group')).toBe('sudo:x:27:dev');
    expect(sh(s, 'cat /etc/os-release')).toMatch(/PRETTY_NAME="Nines Linux 1\.0/);
    expect(sh(s, 'cat /etc/motd')).toMatch(/Welcome to box/);
    expect(sh(s, 'ls /var')).toMatch(/log\//);
  });
  it('keeps the scenario in charge: its files override the base, and df does not move', () => {
    const own: ScenarioSpec = { ...FIXTURE, files: { ...FIXTURE.files, '/etc/hosts': '10.0.0.1 db\n' } };
    expect(sh(session(own), 'cat /etc/hosts')).toBe('10.0.0.1 db');
    // the base files count as part of base_used: 2G used of 10G, plus the scenario's own files
    const df = sh(session(FIXTURE), 'df');
    const used = Number(df.split('\n')[1]!.split(/\s+/)[2]);
    expect(used).toBe(Math.ceil((2 * 1024 ** 3 + 'alpha\nbeta\nGamma\n'.length + 'secret\n'.length + 'stages: [build]\nbuild:\n  stage: build\n  script: [make]\n'.length + '# repo\n'.length + 'port 80\n'.length) / 1024));
  });
  it('every quest machine still starts, and gets the base', () => {
    for (const q of content().quests) {
      if (!q.scenario) continue;
      const s = createSession(q.scenario, { t });
      expect(sh(s, 'cat /etc/hostname'), q.id).toBe(q.scenario.host);
      expect(sh(s, 'whoami'), q.id).toBe(q.scenario.user);
    }
  });
});

describe('the everyday commands', () => {
  it('who am I and where: whoami, id, hostname, uname, env, date, uptime', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'whoami')).toBe('dev');
    expect(sh(s, 'id')).toBe('uid=1000(dev) gid=1000(dev) groups=1000(dev),4(adm),27(sudo)');
    expect(sh(s, 'id root')).toBe('uid=0(root) gid=0(root) groups=0(root)');
    expect(sh(s, 'id nobody2')).toBe("id: 'nobody2': no such user");
    expect(sh(s, 'hostname')).toBe('box');
    expect(sh(s, 'uname')).toBe('Linux');
    expect(sh(s, 'uname -a')).toMatch(/^Linux box 6\.8\.0-nines .* x86_64 GNU\/Linux$/);
    expect(sh(s, 'uname -r')).toBe('6.8.0-nines');
    expect(sh(s, 'env')).toMatch(/^SHELL=\/bin\/bash\nPWD=\/home\/dev\n.*USER=dev/s);
    expect(sh(s, 'printenv HOME')).toBe('/home/dev');
    expect(sh(s, 'date')).toMatch(/^Thu Nov 26 09:0\d:\d\d UTC 2026$/);
    expect(sh(s, 'uptime')).toMatch(/up 3 days, .* 1 user, +load average/);
  });
  it('text tools: echo, head, wc, sort, uniq, also in pipes', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'echo hello  world')).toBe('hello world');
    expect(sh(s, 'echo -n')).toBe('');
    expect(sh(s, 'head -n 2 notes.txt')).toBe('alpha\nbeta');
    expect(sh(s, 'head -1 notes.txt')).toBe('alpha');
    expect(sh(s, 'cat notes.txt | head -n 1')).toBe('alpha');
    expect(sh(s, 'wc -l notes.txt')).toBe('3 notes.txt');
    expect(sh(s, 'wc notes.txt')).toBe('      3       3      17 notes.txt');
    expect(sh(s, 'cat notes.txt | wc -l')).toBe('3');
    expect(sh(s, 'sort notes.txt')).toBe('Gamma\nalpha\nbeta');
    expect(sh(s, 'sort -r notes.txt')).toBe('beta\nalpha\nGamma');
    expect(sh(s, 'sort -f notes.txt')).toBe('alpha\nbeta\nGamma');
    expect(sh(s, 'cat /var/log/app.log /var/log/app.log | sort | uniq -c')).toBe('      2 error: disk\n      2 line 1\n      2 line 3');
    expect(sh(s, 'du -sh /var/* | sort -h')).toBe('50M\t/var/lib\n800M\t/var/log');
    expect(sh(s, 'head nope')).toBe('head: nope: No such file or directory');
  });
  it('find: by name, type, depth and size', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'find /var -name "*.log"')).toBe('/var/log/app.log');
    expect(sh(s, 'find /var/log -type f')).toBe('/var/log/app.log\n/var/log/old.gz');
    expect(sh(s, 'find /var -maxdepth 1 -type d')).toBe('/var\n/var/lib\n/var/log');
    expect(sh(s, 'find / -size +400M')).toBe('/var/log/app.log');
    expect(sh(s, 'find . -iname readme*')).toBe('./repo/README.md');
    expect(sh(s, 'find /nope')).toBe("find: '/nope': No such file or directory");
    expect(sh(s, 'find / -perm 777')).toMatch(/^find: unknown predicate '-perm'/);
  });
  it('which, man, help and history', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'which grep kubectl cd')).toBe('/usr/bin/grep\n/usr/bin/kubectl\ncd: shell built-in command');
    expect(run(s, 'which nmap').exit).toBe(1);
    expect(sh(s, 'man tail')).toMatch(/^TAIL\(1\)\n\nNAME\n {7}tail - the last lines of a file/);
    expect(sh(s, 'man nmap')).toBe('No manual entry for nmap');
    expect(sh(s, 'help')).toMatch(/Also here: whoami id w last logout/);
    expect(sh(s, 'help ps')).toMatch(/^ps \[aux \| -ef\]/);
    expect(sh(s, 'history')).toBe(['    1  which grep kubectl cd', '    2  which nmap', '    3  man tail', '    4  man nmap', '    5  help', '    6  help ps', '    7  history'].join('\n'));
    expect(sh(s, 'history 1')).toBe('    8  history 1');
  });
  it('logins and processes: who, w, last, ps', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'who')).toBe('dev      pts/0        2026-11-26 08:57 (10.20.0.7)');
    expect(sh(s, 'w')).toMatch(/1 user,.*\nUSER {5}TTY {6}FROM .*\ndev {6}pts\/0 {4}10\.20\.0\.7 .* w$/s);
    expect(sh(s, 'last')).toMatch(/^dev +pts\/0 +10\.20\.0\.7 +Thu Nov 26 08:57 +still logged in\nreboot +system boot/);
    expect(sh(s, 'ps')).toMatch(/^ {4}PID TTY {10}TIME CMD\n +\d+ pts\/0 +00:00:00 bash\n +\d+ pts\/0 +00:00:00 ps$/);
    const aux = sh(s, 'ps aux');
    expect(aux).toMatch(/^USER +PID %CPU/);
    expect(aux).toMatch(/root +1 .*\/sbin\/init/);
    expect(aux).toMatch(/\/usr\/local\/bin\/db/); // a running service is a process; the failed web is not
    expect(aux).not.toMatch(/\/usr\/local\/bin\/web/);
    expect(sh(s, 'ps -ef')).toMatch(/^UID +PID +PPID/);
  });
  it('kill and pkill have consequences: a service dies, init and your own shell are refused', () => {
    const s = session(FIXTURE);
    const pid = /root +(\d+) .*\/usr\/local\/bin\/db/.exec(sh(s, 'ps aux'))![1]!;
    expect(run(s, `kill ${pid}`).exit).toBe(0);
    expect(sh(s, 'systemctl status db')).toMatch(/failed/);
    expect(sh(s, 'journalctl -u db --no-pager')).toMatch(/code=killed, status=15\/TERM/);
    expect(sh(s, 'kill 1')).toMatch(/Operation not permitted\. That's init/);
    const me = /^ +(\d+) pts\/0 .* bash$/m.exec(sh(s, 'ps'))![1]!;
    expect(sh(s, `kill ${me}`)).toMatch(/is your own shell/);
    expect(sh(s, 'kill 99999')).toBe('bash: kill: (99999) - No such process');
    expect(sh(s, 'pkill -u dev')).toMatch(/Your own shell, pid \d+, was spared/);
    expect(sh(s, 'pkill sshd')).toBe('');
    expect(sh(s, 'ps aux')).not.toMatch(/sshd/);
    expect(run(s, 'pkill nothing-here').exit).toBe(1);
    expect(sh(s, 'kill -l')).toMatch(/9\) SIGKILL/);
  });
  it('logout leaves the terminal like exit (a kiosk is different: tests/quests/playtest.test.ts)', () => {
    const r = run(session(FIXTURE), 'logout');
    expect(r.out).toEqual(['logout']);
    expect(r.ui?.close).toBe(true);
  });
});

describe('unknown commands', () => {
  beforeEach(() => clearUnknown());
  it('say so honestly, point to help, count as a failed attempt and land in the dev-only list once each', () => {
    const s = session(FIXTURE);
    const r = run(s, 'nmap -sV localhost');
    expect(r.out[0]).toBe("nmap: command not found. This machine's shell has no 'nmap' (yet); help lists what it does have.");
    expect(r.exit).toBe(127);
    run(s, 'nmap');
    run(s, 'telnet');
    expect(s.state.unknown).toEqual(['nmap', 'telnet']);
    expect(s.state.counters.fails).toBe(3);
    expect(unknownCommands()).toEqual(['nmap', 'telnet']);
  });
  it('nginx is a command only where nginx is installed', () => {
    const s = session(FIXTURE);
    expect(sh(s, 'nginx -t')).toMatch(/^nginx: command not found/);
    expect(sh(s, 'help nginx')).toMatch(/No help for 'nginx'/);
    expect(sh(s, 'help')).not.toMatch(/\n {2}nginx /);
  });
});
