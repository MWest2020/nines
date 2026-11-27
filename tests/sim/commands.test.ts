import { describe, expect, it } from 'vitest';
import { scenarioEnv } from '../../src/sim/facts';
import { createSession, prompt, riskOf, run, saveFile } from '../../src/sim/session';
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
    expect(r.events).toEqual([{ id: 'outage', say: 'sh.outage', scope: 'global', money: -100, karma: 0, reset: true }]);
    expect(s.state.fs['/var/log/old.gz']).toBeDefined();
    expect(s.state.counters.commands).toBe(2);
  });
  it('rm -rf /* and mv /etc are outages too', () => {
    expect(run(fresh(), 'rm -rf /*').events[0]?.id).toBe('outage');
    expect(run(fresh(), 'mv /etc /tmp').events[0]?.id).toBe('outage');
  });
  it('a scenario event brings its own money and reset', () => {
    const s = fresh();
    const r = run(s, 'rm -r /var/lib/db');
    expect(r.events).toEqual([{ id: 'db', say: 'event.db', scope: 'quest', money: -50, karma: 0, reset: true }]);
    expect(s.state.fs['/var/lib/db/data']).toBeDefined();
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
  it('describe pod: phase, container state, last state, envFrom and the back-off event', () => {
    const k8s = session({
      ...FIXTURE,
      deployments: { api: { namespace: 'shop', status: 'CrashLoopBackOff', restarts: 6, image: 'registry.example.test/api:1.8.0', config_map: 'api-config' } },
    });
    const name = run(k8s, 'kubectl get pods -n shop').out[1]!.split(/\s+/)[0]!;
    const r = run(k8s, `kubectl describe pod ${name} -n shop`);
    expect(r.ui).toEqual({ pager: true });
    const out = r.out.join('\n');
    expect(out).toMatch(new RegExp(`^Name:\\s+${name}$`, 'm'));
    expect(out).toMatch(/^Namespace:\s+shop$/m);
    expect(out).toMatch(/^Status:\s+Running$/m); // a crash-looping pod's phase is still Running
    expect(out).toMatch(/State:\s+Waiting\n\s+Reason:\s+CrashLoopBackOff\n\s+Last State:\s+Terminated\n\s+Reason:\s+Error\n\s+Exit Code:\s+1/);
    expect(out).toMatch(/Ready:\s+False\n\s+Restart Count:\s+6/);
    expect(out).toMatch(/Environment Variables from:\n\s+api-config\s+ConfigMap\s+Optional: false/);
    expect(out).toMatch(/Warning\s+BackOff\s+.*Back-off restarting failed container api/);
    // every pod in the namespace without a name; the default namespace has none
    expect(sh(k8s, 'kubectl describe pods -n shop')).toContain(`Name:             ${name}`);
    expect(sh(k8s, 'kubectl describe pods')).toBe('No resources found in default namespace.');
  });
  it('apply -f: created, configured, unchanged; tabs, a missing path or a missing kind fail', () => {
    const cm = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: api-config\n  namespace: shop\ndata:\n  LOG_LEVEL: verbose\n';
    const k8s = session({
      ...FIXTURE,
      files: { ...FIXTURE.files, '/home/dev/k8s/cm.yaml': cm, '/home/dev/k8s/new.yaml': 'kind: Secret\nmetadata:\n  name: "db"\n', '/home/dev/k8s/notes.txt': 'x' },
      cluster: ['/home/dev/k8s/cm.yaml'],
      objectives: [{ id: 'cm', text: 'obj', done_when: 'applied_value("configmap/shop/api-config", "LOG_LEVEL") == "info"' }],
    });
    expect(sh(k8s, 'kubectl apply -f k8s/cm.yaml')).toBe('configmap/api-config unchanged');
    // a comment or a blank line is no change
    saveFile(k8s, '/home/dev/k8s/cm.yaml', `# tidied\n${cm}\n`);
    expect(sh(k8s, 'kubectl apply -f k8s/cm.yaml')).toBe('configmap/api-config unchanged');
    saveFile(k8s, '/home/dev/k8s/cm.yaml', cm.replace('verbose', 'info'));
    // saved but not applied: the cluster still runs the old config
    expect(run(k8s, 'pwd').won).toBe(false);
    expect(sh(k8s, 'kubectl apply -f /home/dev/k8s/cm.yaml')).toBe('configmap/api-config configured');
    expect(run(k8s, 'pwd').won).toBe(true);
    expect(sh(k8s, 'kubectl apply --filename=k8s/new.yaml')).toBe('secret/db created');
    // the object counts, not the file: the same Secret from another file, and in another namespace
    saveFile(k8s, '/tmp/db.yaml', 'kind: Secret\nmetadata:\n  name: db\ndata:\n  x: eQ==\n');
    expect(sh(k8s, 'kubectl apply -f /tmp/db.yaml')).toBe('secret/db configured');
    expect(sh(k8s, 'kubectl apply -f /tmp/db.yaml -n other')).toBe('secret/db created');
    // a directory applies its YAML files, in name order
    expect(sh(k8s, 'kubectl apply -f k8s')).toBe('configmap/api-config unchanged\nsecret/db configured');
    expect(sh(k8s, 'kubectl apply')).toBe('error: must specify one of -f and -k');
    expect(sh(k8s, 'kubectl apply -f nope.yaml')).toBe('error: the path "nope.yaml" does not exist');
    expect(sh(k8s, 'kubectl apply -f k8s/notes.txt')).toBe('error: error validating "k8s/notes.txt": error validating data: kind or metadata.name not set');
    saveFile(k8s, '/home/dev/k8s/cm.yaml', cm.replace('  LOG_LEVEL', '\tLOG_LEVEL'));
    const tab = run(k8s, 'kubectl apply -f k8s/cm.yaml');
    expect(tab.exit).toBe(1);
    expect(tab.out).toEqual(['error: error parsing k8s/cm.yaml: error converting YAML to JSON: yaml: line 7: found character that cannot start any token']);
    expect(run(k8s, 'pwd').won).toBe(true); // a failed apply changes nothing
  });
  it('describe by name prefix; logs -f follows; Deployment kinds print with their group', () => {
    const k8s = session({ ...FIXTURE, deployments: { api: { namespace: 'shop', replicas: 2, status: 'Running', logs: ['up'] } } });
    const out = sh(k8s, 'kubectl describe pod api -n shop');
    expect(out.match(/^Name:/gm)).toHaveLength(2);
    expect(sh(k8s, 'kubectl logs -f deployments/api -n shop').split('\n')).toEqual([
      expect.stringMatching(/^Found 2 pods, using pod\/api-/),
      'up',
      '(Following is not simulated here; these are the last lines.)',
    ]);
    const d = session({ ...FIXTURE, files: { ...FIXTURE.files, '/home/dev/d.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n' } });
    expect(sh(d, 'kubectl apply -f d.yaml')).toBe('deployment.apps/api created');
  });
  it('a Pending pod has no node and no container state', () => {
    const k8s = session({ ...FIXTURE, deployments: { api: { status: 'Pending' } } });
    const out = sh(k8s, 'kubectl describe pods');
    expect(out).toMatch(/^Node:\s+<none>$/m);
    expect(out).not.toMatch(/State:/);
    expect(out).toMatch(/FailedScheduling/);
  });
  it('namespaces and errors', () => {
    const s = fresh();
    expect(sh(s, 'kubectl get pods -n kube-system')).toBe('No resources found in kube-system namespace.');
    expect(run(s, 'kubectl get pods -A').out[0]).toMatch(/^NAMESPACE\s+NAME/);
    expect(sh(s, 'kubectl logs nope')).toBe('Error from server (NotFound): pods "nope" not found');
    expect(sh(s, 'kubectl rollout restart deployment/nope')).toBe('Error from server (NotFound): deployments.apps "nope" not found');
    expect(sh(s, 'kubectl describe pod x')).toBe('Error from server (NotFound): pods "x" not found');
    expect(sh(s, 'kubectl describe secret x')).toMatch(/doesn't have a resource type "secret"/);
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
    expect(sh(s, 'vim2 x')).toMatch(/^vim2: command not found. .*help lists/);
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
  it('strips escape sequences from what the player types and saves', () => {
    const s = fresh();
    expect(sh(s, 'x\u001b[31my\u0007')).toMatch(/^x\[31my: command not found/);
    saveFile(s, '/tmp/f', 'a\u001b[31mb\r\nc\tz\n');
    expect(s.state.fs['/tmp/f']).toMatchObject({ content: 'a[31mb\nc\tz\n' });
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

describe('names that exist on Object.prototype', () => {
  it('are ordinary unknown words in the terminal, never a crash', () => {
    const s = fresh();
    for (const word of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty x']) {
      const r = run(s, word);
      expect(r.exit, word).toBe(127);
    }
    expect(sh(s, 'systemctl status constructor')).toBe('Unit constructor.service could not be found.');
    expect(sh(s, 'systemctl restart toString')).toBe('Failed to restart toString.service: Unit toString.service not found.');
    expect(sh(s, 'journalctl -u constructor')).toBe('-- No entries --');
    expect(sh(s, 'kubectl rollout restart deployment/constructor')).toBe('Error from server (NotFound): deployments.apps "constructor" not found');
    expect(run(s, 'kubectl get pods').exit).toBe(0);
    expect(sh(s, 'help constructor')).toMatch(/No help for 'constructor'/);
    expect(({} as Record<string, unknown>)['state']).toBeUndefined();
  });
  it('work as file names in git', () => {
    const s = fresh();
    sh(s, 'cd repo');
    saveFile(s, '/home/dev/repo/constructor', 'x\n');
    saveFile(s, '/home/dev/repo/__proto__', 'y\n');
    expect(sh(s, 'git status')).toMatch(/Untracked files:\n\t__proto__\n\tconstructor/);
    sh(s, 'git add .');
    expect(sh(s, 'git status')).toMatch(/new file:   __proto__\n\tnew file:   constructor/);
    expect(run(s, 'git commit -m "odd names"').out[1]).toBe(' 2 file(s) changed');
  });
});

describe('events, hints and flags', () => {
  const spec = {
    ...FIXTURE,
    events: [
      ...FIXTURE.events!,
      { id: 'clumsy', when: 'fails >= 1', say: 'event.clumsy', set_flag: 'was-clumsy' },
    ],
  };
  it('an event that resets stays armed: the same damage costs twice', () => {
    const s = session(FIXTURE);
    expect(run(s, 'rm -r /var/lib/db').events.map((e) => e.id)).toEqual(['db']);
    expect(run(s, 'rm -r /var/lib/db').events.map((e) => e.id)).toEqual(['db']);
  });
  it('a reset event whose condition survives the reset fires once, not on every command', () => {
    const s = session({ ...FIXTURE, events: [{ id: 'sloppy', when: 'fails >= 2', say: 'event.sloppy', money: -50, reset: true }] });
    run(s, 'nope');
    expect(run(s, 'nope').events.map((e) => e.id)).toEqual(['sloppy']);
    expect(run(s, 'ls').events).toEqual([]);
    expect(run(s, 'nope').events).toEqual([]);
  });
  it('the hint boost counts for hints only, never for events', () => {
    const s = session(spec, 3);
    expect(run(s, 'pwd').events).toEqual([]);
    const r = run(s, 'nope');
    expect(r.events).toEqual([{ id: 'clumsy', say: 'event.clumsy', scope: 'quest', money: 0, karma: 0, reset: false, setFlag: 'was-clumsy' }]);
    expect(s.state.flags['was-clumsy']).toBe(true);
  });
  it('ran() sees the subcommand after leading flags', () => {
    const s = fresh();
    steps(s, 'kubectl -n default get pods');
    expect(s.state.ran).toContain('kubectl get');
  });
});

describe('touched(): what a command reached (karma quests: scope, snooping)', () => {
  const touched = (s: ReturnType<typeof fresh>, p: string) => {
    const env = scenarioEnv({ state: () => s.state, initial: s.initial, spec: s.spec, hintBoost: 0 });
    return env.funcs['touched']!(p) as boolean;
  };
  it('counts existing paths named as operands, relative ones resolved, and the path below them', () => {
    const s = fresh();
    expect(touched(s, '/home/dev/notes.txt')).toBe(false);
    run(s, 'cat notes.txt');
    expect(touched(s, '/home/dev/notes.txt')).toBe(true);
    expect(touched(s, '/home/dev')).toBe(true); // something inside it was reached
    expect(touched(s, '/var')).toBe(false);
    run(s, 'ls /var/log');
    expect(touched(s, '/var/log')).toBe(true);
    expect(touched(s, '/var/log/app.log')).toBe(false); // listing a folder is not opening its files
  });
  it('a recursive grep, du or rm -r sweeps everything below its folder', () => {
    const s = fresh();
    run(s, 'grep -rn error /var');
    expect(touched(s, '/var/lib/db/data')).toBe(true);
    const d = fresh();
    run(d, 'du -sh /var/lib');
    expect(touched(d, '/var/lib/db')).toBe(true);
    expect(touched(d, '/var/log')).toBe(false);
    const g = fresh();
    run(g, 'grep error /var/log/app.log');
    expect(touched(g, '/var/log/old.gz')).toBe(false);
  });
  it('cd, cd with no operand, the editor and a pipe stage all count; a missing path does not', () => {
    const s = fresh();
    run(s, 'cd /etc');
    expect(touched(s, '/etc')).toBe(true);
    run(s, 'cd');
    expect(touched(s, '/home/dev')).toBe(true);
    run(s, 'cat /nope');
    expect(touched(s, '/nope')).toBe(false);
    run(s, 'edit /etc/app.conf');
    expect(touched(s, '/etc/app.conf')).toBe(true);
    const e = fresh();
    saveFile(e, '/tmp/new.txt', 'x');
    expect(touched(e, '/tmp/new.txt')).toBe(true);
    const p = fresh();
    run(p, 'cat notes.txt | grep alpha');
    expect(touched(p, '/home/dev/notes.txt')).toBe(true);
  });
  it('flag values and a grep pattern are not paths; du and grep -r without a folder walk the working directory', () => {
    const s = fresh();
    run(s, 'cd /var');
    run(s, 'grep log /etc/app.conf'); // "log" would resolve to /var/log
    expect(touched(s, '/var/log')).toBe(false);
    run(s, 'tail -n 5 /etc/app.conf');
    expect(touched(s, '/var/5')).toBe(false);
    const d = fresh();
    run(d, 'cd /var/lib');
    run(d, 'du -sh');
    expect(touched(d, '/var/lib/db/data')).toBe(true);
  });
  it('opened(): reading commands open files, listing and sizing do not, grep -r opens what it walks', () => {
    const s = fresh();
    const opened = (p: string) => scenarioEnv({ state: () => s.state, initial: s.initial, spec: s.spec, hintBoost: 0 }).funcs['opened']!(p) as boolean;
    run(s, 'ls -l /var/log/app.log');
    run(s, 'du -sh /var/log');
    expect(opened('/var/log/app.log')).toBe(false);
    expect(touched(s, '/var/log/app.log')).toBe(true);
    run(s, 'tail -n 2 /var/log/app.log');
    expect(opened('/var/log/app.log')).toBe(true);
    expect(opened('/var/log')).toBe(true);
    expect(opened('/var/lib/db/data')).toBe(false);
    run(s, 'grep -r x /var/lib');
    expect(opened('/var/lib/db/data')).toBe(true);
  });
  it('survives a reset: what the player did stays done', () => {
    const s = session({ ...FIXTURE, events: [{ id: 'db', when: 'removed("/var/lib/db/data")', say: 'event.db', money: -50, reset: true }] });
    run(s, 'cat /etc/app.conf');
    run(s, 'rm /var/lib/db/data');
    expect(s.state.fs['/var/lib/db/data']).toBeDefined(); // restored
    expect(touched(s, '/etc/app.conf')).toBe(true);
    expect(touched(s, '/var/lib/db/data')).toBe(true);
  });
});

describe('procedures and risk (DESIGN.md, Independent contractor; Side hustles)', () => {
  const spec = {
    ...FIXTURE,
    objectives: [
      { id: 'web', text: 'obj', done_when: 'service("web") == "active"' },
      { id: 'ticket', text: 'obj.ticket', done_when: 'exists("/tmp/ticket")', procedure: true },
    ],
  };
  it('an employee needs every objective; a contractor skips the procedures', () => {
    const fix = (s: ReturnType<typeof fresh>) => {
      saveFile(s, '/etc/app.conf', 'port 8080\n');
      return run(s, 'systemctl restart web');
    };
    const employee = session(spec);
    const e = fix(employee);
    expect(e.won).toBe(false);
    expect(e.objectives).toEqual([
      { id: 'web', text: 'obj', done: true },
      { id: 'ticket', text: 'obj.ticket', done: false, procedure: true },
    ]);
    expect(saveFile(employee, '/tmp/ticket', 'done').justWon).toBe(true);
    const contractor = createSession(spec, { t: (k) => k, skipProcedures: true });
    const c = fix(contractor);
    expect(c.justWon).toBe(true);
    expect(c.objectives[1]).toEqual({ id: 'ticket', text: 'obj.ticket', done: false, procedure: true, skipped: true });
  });
  it('a scenario with a risk reports it after every step: base plus the factors that hold, 0 to 100', () => {
    const risky = {
      ...FIXTURE,
      risk: {
        base: 10,
        factors: [
          { id: 'snoop', when: 'touched("/var/lib/db")', add: 30, text: 'risk.snoop' },
          { id: 'tidy', when: 'removed("/var/log/old.gz")', add: -20, text: 'risk.tidy' },
          { id: 'clumsy', when: 'fails >= 1', add: 90, text: 'risk.clumsy' },
        ],
      },
    };
    const s = session(risky);
    expect(run(s, 'pwd').risk).toEqual({ percent: 10, factors: [] });
    expect(run(s, 'ls /var/lib/db').risk).toEqual({ percent: 40, factors: [{ id: 'snoop', text: 'risk.snoop', add: 30 }] });
    expect(run(s, 'rm /var/log/old.gz').risk?.percent).toBe(20);
    expect(run(s, 'nope').risk?.percent).toBe(100);
    expect(riskOf(s)?.percent).toBe(100);
    expect(run(fresh(), 'pwd').risk).toBeUndefined();
    expect(riskOf(fresh())).toBeNull();
    const calm = session({ ...risky, risk: { base: 0, factors: [{ id: 'tidy', when: 'true', add: -20, text: 'risk.tidy' }] } });
    expect(run(calm, 'pwd').risk?.percent).toBe(0);
  });
  it('an event carries its karma', () => {
    const s = session({ ...FIXTURE, events: [{ id: 'peek', when: 'touched("/etc")', say: 'event.peek', karma: -5 }] });
    expect(run(s, 'ls /etc').events).toEqual([{ id: 'peek', say: 'event.peek', scope: 'quest', money: 0, karma: -5, reset: false }]);
  });
});

describe('kubectl for Medior City: readiness, rollouts from apply, rollout status, get deployments', () => {
  const dep = (probe: string) =>
    `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\n  namespace: shop\nspec:\n  template:\n    spec:\n      containers:\n        - name: api\n          readinessProbe:\n            httpGet:\n              path: ${probe}\n`;
  const k8s = () =>
    session({
      ...FIXTURE,
      files: { ...FIXTURE.files, '/home/dev/d.yaml': dep('/healthz') },
      cluster: ['/home/dev/d.yaml'],
      deployments: {
        api: {
          namespace: 'shop',
          replicas: 2,
          status: 'NotReady',
          readiness_failure: 'HTTP probe failed with statuscode: 404',
          restart: { succeeds_if: 'applied_value("deployment/shop/api", "path") == "/ready"', status_on_failure: 'NotReady' },
        },
      },
      objectives: [{ id: 'up', text: 'obj', done_when: 'pods_running("api")' }],
    });
  it('a NotReady pod shows Running with READY 0/1, and describe names the failing probe', () => {
    const s = k8s();
    const row = run(s, 'kubectl get pods -n shop').out[1]!;
    expect(row).toMatch(/\s0\/1\s+Running\s+0\s+42m$/);
    const out = sh(s, 'kubectl describe pods -n shop');
    expect(out).toMatch(/State:\s+Running\n\s+Ready:\s+False/);
    expect(out).toMatch(/Warning\s+Unhealthy\s+.*Readiness probe failed: HTTP probe failed with statuscode: 404/);
    expect(run(s, 'pwd').won).toBe(false);
  });
  it('get deployments counts ready replicas; rollout status says whether it is done, without counting a failure', () => {
    const s = k8s();
    expect(run(s, 'kubectl get deploy -n shop').out).toEqual(['NAME   READY   UP-TO-DATE   AVAILABLE   AGE', 'api    0/2     2            0           42m']);
    const r = run(s, 'kubectl rollout status deployment/api -n shop');
    expect(r.out[0]).toBe('Waiting for deployment "api" rollout to finish: 0 of 2 updated replicas are available...');
    expect(r.exit).toBe(1);
    expect(sh(s, 'kubectl get deployments')).toBe('No resources found in default namespace.');
  });
  it('applying a changed Deployment rolls it out: healthy when the fix holds, still NotReady when not', () => {
    const s = k8s();
    const before = run(s, 'kubectl get pods -n shop').out[1]!.split(/\s+/)[0];
    // unchanged: nothing rolls
    expect(sh(s, 'kubectl apply -f d.yaml')).toBe('deployment.apps/api unchanged');
    expect(run(s, 'kubectl get pods -n shop').out[1]!.split(/\s+/)[0]).toBe(before);
    // a wrong fix: new pods, still not ready
    saveFile(s, '/home/dev/d.yaml', dep('/health'));
    expect(sh(s, 'kubectl apply -f d.yaml')).toBe('deployment.apps/api configured');
    const wrong = run(s, 'kubectl get pods -n shop').out[1]!;
    expect(wrong.split(/\s+/)[0]).not.toBe(before);
    expect(wrong).toMatch(/0\/1\s+Running\s+0\s+3s$/);
    // the right fix: Ready, and the rollout is done without a rollout restart
    saveFile(s, '/home/dev/d.yaml', dep('/ready'));
    sh(s, 'kubectl apply -f d.yaml');
    expect(run(s, 'kubectl get pods -n shop').out[1]).toMatch(/1\/1\s+Running/);
    expect(sh(s, 'kubectl rollout status deploy/api -n shop')).toBe('deployment "api" successfully rolled out');
    expect(run(s, 'pwd').won).toBe(true);
    // the same Deployment applied into another namespace is another object: no rollout here
    const t = k8s();
    saveFile(t, '/home/dev/d.yaml', dep('/ready').replace('  namespace: shop\n', ''));
    expect(sh(t, 'kubectl apply -f d.yaml')).toBe('deployment.apps/api created');
    expect(run(t, 'kubectl get pods -n shop').out[1]).toMatch(/0\/1/);
  });
});
