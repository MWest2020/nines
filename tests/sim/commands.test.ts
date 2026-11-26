import { describe, expect, it } from 'vitest';
import { prompt, run, saveFile } from '../../src/sim/session';
import { FIXTURE, session, sh, steps } from '../helpers';

const fresh = () => session(FIXTURE);

describe('navigation', () => {
  it('pwd, cd and the prompt', () => {
    const s = fresh();
    expect(sh(s, 'pwd')).toBe('/home/dev');
    expect(prompt(s.state)).toBe('dev@box:~$ ');
    sh(s, 'cd /var/log');
    expect(prompt(s.state)).toBe('dev@box:/var/log$ ');
    sh(s, 'cd ..');
    expect(sh(s, 'pwd')).toBe('/var');
    expect(sh(s, 'cd -')).toBe('/var/log');
    sh(s, 'cd ~/repo');
    expect(prompt(s.state)).toBe('dev@box:~/repo$ ');
    sh(s, 'cd');
    expect(sh(s, 'pwd')).toBe('/home/dev');
  });
  it('cd errors', () => {
    const s = fresh();
    expect(sh(s, 'cd /nope')).toBe('cd: /nope: No such file or directory');
    expect(sh(s, 'cd notes.txt')).toBe('cd: notes.txt: Not a directory');
    expect(run(s, 'cd a b').exit).toBe(1);
  });
});

describe('ls', () => {
  it('lists sorted, marks dirs, hides dotfiles', () => {
    const s = fresh();
    expect(sh(s, 'ls')).toBe('empty/\nnotes.txt\nrepo/');
    expect(sh(s, 'ls -a')).toBe('.hidden\nempty/\nnotes.txt\nrepo/');
  });
  it('long format with human sizes', () => {
    const s = fresh();
    expect(sh(s, 'ls -lh /var/log')).toBe('-rw-r--r-- root root  500M app.log\n-rw-r--r-- root root  300M old.gz');
  });
  it('several operands and a missing one', () => {
    const s = fresh();
    const r = run(s, 'ls /nope /tmp notes.txt');
    expect(r.exit).toBe(2);
    expect(r.out).toEqual(["ls: cannot access '/nope': No such file or directory", 'notes.txt', '', '/tmp:']);
  });
  it('bad option', () => {
    expect(sh(fresh(), 'ls -z')).toMatch(/^ls: invalid option '-z'\nusage: ls/);
  });
});

describe('reading files', () => {
  it('cat, less, tail', () => {
    const s = fresh();
    expect(sh(s, 'cat notes.txt')).toBe('alpha\nbeta\nGamma');
    expect(run(s, 'less notes.txt').ui).toEqual({ pager: true });
    expect(sh(s, 'tail -n 1 notes.txt')).toBe('Gamma');
    expect(sh(s, 'tail -2 notes.txt')).toBe('beta\nGamma');
    expect(sh(s, 'cat /var/log/old.gz')).toMatch(/only its size is known/);
    expect(sh(s, 'cat /tmp')).toBe('cat: /tmp: Is a directory');
    expect(sh(s, 'cat nope')).toBe('cat: nope: No such file or directory');
    expect(sh(s, 'tail -n x notes.txt')).toBe("tail: invalid number: 'x'");
    expect(sh(s, 'tail -f notes.txt')).toMatch(/Following is not simulated/);
  });
  it('tail with several files prints headers', () => {
    expect(sh(fresh(), 'tail -n 1 notes.txt /etc/app.conf')).toBe('==> notes.txt <==\nGamma\n\n==> /etc/app.conf <==\nport 80');
  });
});

describe('grep', () => {
  it('matches, with -i -v -n -c', () => {
    const s = fresh();
    expect(sh(s, 'grep a notes.txt')).toBe('alpha\nbeta\nGamma');
    expect(sh(s, 'grep -n ^g notes.txt')).toBe('');
    expect(run(s, 'grep -n ^g notes.txt').exit).toBe(1);
    expect(sh(s, 'grep -in ^g notes.txt')).toBe('3:Gamma');
    expect(sh(s, 'grep -v a notes.txt')).toBe('');
    expect(sh(s, 'grep -c l notes.txt')).toBe('1');
  });
  it('reads a pipe and searches folders with -r', () => {
    const s = fresh();
    expect(sh(s, 'cat notes.txt | grep -i GAMMA')).toBe('Gamma');
    expect(sh(s, 'journalctl -u web --no-pager | grep error')).toBe('l2 error: bad config');
    expect(sh(s, 'grep -r error /var/log')).toBe('/var/log/app.log:error: disk');
    expect(sh(s, 'grep -rl port /etc')).toBe('/etc/app.conf');
  });
  it('errors', () => {
    const s = fresh();
    expect(run(s, 'grep "(" notes.txt').exit).toBe(2);
    expect(sh(s, 'grep x /tmp')).toBe('grep: /tmp: Is a directory');
    expect(run(s, 'grep').exit).toBe(2);
    expect(sh(s, 'grep -F "(" notes.txt')).toBe('');
  });
  it('a no-match is not a failed attempt', () => {
    const s = fresh();
    run(s, 'grep zzz notes.txt');
    expect(s.state.counters.fails).toBe(0);
  });
});

describe('disk usage', () => {
  it('df -h per mount, rounded up like coreutils', () => {
    const s = fresh();
    expect(sh(s, 'df -h')).toBe(
      [
        'Filesystem       Size  Used Avail Use% Mounted on',
        '/dev/sda1         10G  2.1G  8.0G  21% /',
        '/dev/sdb1        1.0G  950M   74M  93% /var',
      ].join('\n'),
    );
    expect(sh(s, 'df -h /var/log').split('\n')[1]).toMatch(/\/var$/);
  });
  it('du -sh and du without -s', () => {
    const s = fresh();
    expect(sh(s, 'du -sh /var/log /var/lib')).toBe('800M\t/var/log\n50M\t/var/lib');
    expect(sh(s, 'du -h /var/lib')).toBe('50M\t/var/lib/db\n50M\t/var/lib');
    expect(sh(s, 'du -shc /var/log /var/lib').split('\n').pop()).toBe('850M\ttotal');
    expect(sh(s, 'du -s /var/lib')).toBe('51200\t/var/lib');
  });
  it('globs expand against the filesystem', () => {
    const s = fresh();
    expect(sh(s, 'du -sh /var/*')).toBe('50M\t/var/lib\n800M\t/var/log');
    sh(s, 'cd /var/log');
    expect(sh(s, 'ls *.gz')).toBe('old.gz');
    expect(sh(s, 'ls *.nothing')).toBe("ls: cannot access '*.nothing': No such file or directory");
  });
});

describe('rm and mv', () => {
  it('rm files, refuse dirs without -r, -f is quiet', () => {
    const s = fresh();
    expect(sh(s, 'rm /var/log/old.gz')).toBe('');
    expect(sh(s, 'ls /var/log')).toBe('app.log');
    expect(sh(s, 'rm /tmp')).toBe("rm: cannot remove '/tmp': Is a directory");
    expect(sh(s, 'rm nope')).toBe("rm: cannot remove 'nope': No such file or directory");
    expect(run(s, 'rm -f nope').exit).toBe(0);
    expect(sh(s, 'rm -rv repo')).toBe("removed 'repo'");
    expect(s.state.fs['/home/dev/repo/app.yml']).toBeUndefined();
  });
  it('freeing space shows in df', () => {
    const s = fresh();
    sh(s, 'rm /var/log/*');
    expect(sh(s, 'df -h /var').split('\n')[1]).toMatch(/ 15% \/var$/);
  });
  it('a removed cwd moves the shell up', () => {
    const s = fresh();
    sh(s, 'cd /var/log');
    sh(s, 'rm -r /var/log');
    expect(sh(s, 'pwd')).toBe('/var');
  });
  it('mv renames and moves into dirs, across mounts', () => {
    const s = fresh();
    sh(s, 'mv notes.txt n.txt');
    expect(sh(s, 'cat n.txt')).toBe('alpha\nbeta\nGamma');
    sh(s, 'mv /var/log/app.log /var/log/old.gz /tmp');
    expect(sh(s, 'ls /tmp')).toBe('app.log\nold.gz');
    expect(sh(s, 'df -h /var').split('\n')[1]).toMatch(/ 15% \/var$/);
  });
  it('mv errors', () => {
    const s = fresh();
    expect(sh(s, 'mv nope x')).toBe("mv: cannot stat 'nope': No such file or directory");
    expect(sh(s, 'mv a b notes.txt')).toBe("mv: target 'notes.txt' is not a directory");
    expect(sh(s, 'mv repo repo/sub')).toBe("mv: cannot move 'repo' to a subdirectory of itself, 'repo/sub'");
    expect(sh(s, 'mv notes.txt /no/where')).toBe("mv: cannot move 'notes.txt' to '/no/where': No such file or directory");
    expect(sh(s, 'mv')).toMatch(/missing operand/);
  });
});

describe('consequences, not blocks', () => {
  it('rm -rf / is an outage: money, dialogue, and the machine restored', () => {
    const s = fresh();
    sh(s, 'rm /var/log/old.gz');
    const r = run(s, 'sudo rm -rf /');
    expect(r.events).toEqual([{ id: 'outage', say: 'sh.outage', scope: 'global', money: -100, reset: true }]);
    expect(s.state.fs['/var/log/old.gz']).toBeDefined();
    expect(s.state.counters.commands).toBe(2);
  });
  it('rm -rf /* and mv /etc are outages too', () => {
    expect(run(fresh(), 'rm -rf /*').events[0]?.id).toBe('outage');
    expect(run(fresh(), 'mv /etc /tmp').events[0]?.id).toBe('outage');
  });
  it('a scenario event fires once, with its own money and reset', () => {
    const s = fresh();
    const r = run(s, 'rm -r /var/lib/db');
    expect(r.events).toEqual([{ id: 'db', say: 'event.db', scope: 'quest', money: -50, reset: true }]);
    expect(s.state.fs['/var/lib/db/data']).toBeDefined();
    expect(run(s, 'rm -r /var/lib/db').events).toEqual([]);
  });
});

describe('services', () => {
  it('status shows state and recent logs; exit 3 is not a failed attempt', () => {
    const s = fresh();
    const r = run(s, 'systemctl status web.service');
    expect(r.exit).toBe(3);
    expect(r.out.slice(0, 3)).toEqual([
      '× web.service - Web server',
      '     Loaded: loaded (/lib/systemd/system/web.service; enabled; preset: enabled)',
      '     Active: failed (Result: exit-code)',
    ]);
    expect(s.state.counters.fails).toBe(0);
  });
  it('restart fails until its condition holds, then succeeds', () => {
    const s = fresh();
    const bad = run(s, 'systemctl restart web');
    expect(bad.exit).toBe(1);
    expect(bad.out[0]).toBe('Job for web.service failed because the control process exited with error code.');
    expect(s.state.services['web']!.logs.at(-1)).toMatch(/Failed to start web.service/);
    saveFile(s, '/etc/app.conf', 'port 8080\n');
    const good = run(s, 'sudo systemctl restart web');
    expect(good.exit).toBe(0);
    expect(good.won).toBe(true);
    expect(good.justWon).toBe(true);
    expect(run(s, 'pwd').justWon).toBe(false);
  });
  it('journalctl -u, -n, and errors', () => {
    const s = fresh();
    expect(run(s, 'journalctl -u web').out).toEqual(['l1', 'l2 error: bad config', 'l3']);
    expect(run(s, 'journalctl -u web').ui).toEqual({ pager: true });
    expect(sh(s, 'journalctl -xeu web -n 1')).toBe('l3');
    expect(sh(s, 'journalctl -u nope')).toBe('-- No entries --');
    expect(sh(s, 'journalctl')).toMatch(/pick a unit with -u/);
  });
  it('unknown units', () => {
    const s = fresh();
    expect(sh(s, 'systemctl status nope')).toBe('Unit nope.service could not be found.');
    expect(sh(s, 'systemctl restart nope')).toBe('Failed to restart nope.service: Unit nope.service not found.');
    expect(sh(s, 'systemctl')).toMatch(/^usage: systemctl/);
  });
});

describe('kubectl', () => {
  it('get pods, logs, rollout restart', () => {
    const s = fresh();
    const pods = run(s, 'kubectl get pods').out;
    expect(pods[0]).toMatch(/^NAME\s+READY\s+STATUS\s+RESTARTS\s+AGE$/);
    expect(pods[1]).toMatch(/^api-[a-z0-9]{9}-[a-z0-9]{5}\s+0\/1\s+CrashLoopBackOff\s+4\s+42m$/);
    const name = pods[1]!.split(/\s+/)[0]!;
    expect(sh(s, `kubectl logs ${name}`)).toBe('panic: missing env DB_URL');
    expect(sh(s, 'kubectl logs deployment/api --tail=1')).toBe('panic: missing env DB_URL');
    expect(sh(s, 'kubectl rollout restart deployment/api')).toBe('deployment.apps/api restarted');
    expect(run(s, 'kubectl get pods').out[1]).toMatch(/CrashLoopBackOff\s+0\s+3s$/);
    saveFile(s, '/etc/api.env', 'DB_URL=postgres://db\n');
    sh(s, 'kubectl rollout restart deploy api');
    const after = run(s, 'kubectl get po').out[1]!;
    expect(after).toMatch(/1\/1\s+Running/);
    expect(after.split(/\s+/)[0]).not.toBe(name);
    expect(sh(s, `kubectl logs ${after.split(/\s+/)[0]}`)).toBe('listening on :8080');
  });
  it('namespaces and errors', () => {
    const s = fresh();
    expect(sh(s, 'kubectl get pods -n kube-system')).toBe('No resources found in kube-system namespace.');
    expect(run(s, 'kubectl get pods -A').out[0]).toMatch(/^NAMESPACE\s+NAME/);
    expect(sh(s, 'kubectl logs nope')).toBe('Error from server (NotFound): pods "nope" not found');
    expect(sh(s, 'kubectl rollout restart deployment/nope')).toBe('Error from server (NotFound): deployments.apps "nope" not found');
    expect(sh(s, 'kubectl describe pod x')).toMatch(/^usage: kubectl/);
  });
});

describe('git', () => {
  it('outside a repo', () => {
    expect(run(fresh(), 'git status').exit).toBe(128);
  });
  it('status, add, commit, and the pipeline run', () => {
    const s = fresh();
    sh(s, 'cd repo');
    expect(sh(s, 'git status')).toBe('On branch main\nnothing to commit, working tree clean');
    saveFile(s, '/home/dev/repo/app.yml', 'stages: [build]\nbuild:\n  stage: biuld\n  script: [make]\n');
    saveFile(s, '/home/dev/repo/new.txt', 'x\n');
    expect(sh(s, 'git status')).toBe(
      ['On branch main', 'Changes not staged for commit:', '\tmodified:   app.yml', '', 'Untracked files:', '\tnew.txt', ''].join('\n'),
    );
    expect(sh(s, 'git commit -m "x"')).toBe('no changes added to commit (use "git add")');
    sh(s, 'git add app.yml');
    expect(sh(s, 'git status').split('\n').slice(0, 3)).toEqual(['On branch main', 'Changes to be committed:', '\tmodified:   app.yml']);
    const r = run(s, 'git commit -m "try"');
    expect(r.out[0]).toMatch(/^\[main [0-9a-f]{7}\] try$/);
    expect(r.out.slice(2)).toEqual(['ci: pipeline #42 started for main', 'ci: pipeline #42 failed:', 'ci:   - job "build": stage "biuld" is not in stages']);
    expect(s.state.pipeline.status).toBe('failed');
    saveFile(s, '/home/dev/repo/app.yml', 'stages: [build]\nbuild:\n  stage: build\n  script: [make]\n');
    const ok = steps(s, 'git add .', 'git commit -m "fix"');
    expect(ok.out.at(-1)).toBe('ci: pipeline #43 passed');
    expect(s.state.pipeline.status).toBe('passed');
    expect(sh(s, 'git status')).toBe('On branch main\nnothing to commit, working tree clean');
  });
  it('commit -a, deletions, and errors', () => {
    const s = fresh();
    sh(s, 'cd repo');
    expect(sh(s, 'git commit')).toMatch(/Give the commit a message/);
    expect(sh(s, 'git commit -m x')).toBe('nothing to commit, working tree clean');
    sh(s, 'rm README.md');
    expect(sh(s, 'git status')).toMatch(/\tdeleted:    README.md/);
    expect(run(s, 'git commit -am "rm readme"').out[1]).toBe(' 1 file(s) changed');
    expect(sh(s, 'git add nope')).toBe("fatal: pathspec 'nope' did not match any files");
    expect(sh(s, 'git add /etc/app.conf')).toBe("fatal: '/etc/app.conf' is outside repository");
    expect(sh(s, 'git push')).toMatch(/^usage: git/);
  });
});

describe('the session', () => {
  it('help lists every command and explains one', () => {
    const s = fresh();
    const out = sh(s, 'help');
    for (const c of ['ls', 'df', 'du', 'rm', 'systemctl', 'journalctl', 'kubectl', 'git', 'edit']) expect(out).toMatch(new RegExp(`\\n  ${c} `));
    expect(sh(s, 'help nano')).toMatch(/^edit <file>/);
    expect(sh(s, 'help nope')).toMatch(/No help for 'nope'/);
  });
  it('unknown commands, unsupported syntax, blank lines', () => {
    const s = fresh();
    expect(run(s, 'vim2 x').exit).toBe(127);
    expect(sh(s, 'vim2 x')).toBe('vim2: command not found');
    expect(sh(s, 'ls > out.txt')).toMatch(/has no '>'/);
    const before = s.state.counters.commands;
    run(s, '   ');
    expect(s.state.counters.commands).toBe(before);
  });
  it('the editor opens files and saves them', () => {
    const s = fresh();
    expect(run(s, 'edit notes.txt').ui).toEqual({ editor: { path: '/home/dev/notes.txt', content: 'alpha\nbeta\nGamma\n' } });
    expect(run(s, 'nano new.txt').ui?.editor?.content).toBe('');
    expect(run(s, 'vi notes.txt').out[0]).toMatch(/not vi/);
    expect(sh(s, 'edit /var/log/old.gz')).toMatch(/too big/);
    expect(sh(s, 'edit /tmp')).toBe('edit: /tmp: Is a directory');
    saveFile(s, '/home/dev/new.txt', 'hello\n');
    expect(sh(s, 'cat new.txt')).toBe('hello');
    expect(s.state.ran).toContain('edit');
  });
  it('hints unlock from failed attempts, one at a time; a boost brings them sooner', () => {
    const s = fresh();
    expect(run(s, 'nope').hints).toEqual([]);
    expect(run(s, 'nope').hints).toEqual(['hint.one']);
    expect(run(s, 'nope').hints).toEqual([]);
    const boosted = session(FIXTURE, 1);
    expect(run(boosted, 'nope').hints).toEqual(['hint.one']);
  });
  it('clear and exit are ui actions', () => {
    const s = fresh();
    expect(run(s, 'clear').ui).toEqual({ clear: true });
    expect(run(s, 'exit').ui).toEqual({ close: true });
  });
  it('records commands and subcommands for ran()', () => {
    const s = fresh();
    steps(s, 'systemctl status web', 'sudo kubectl get pods');
    expect(s.state.ran).toEqual(['systemctl', 'systemctl status', 'kubectl', 'kubectl get']);
  });
});
