// nginx's command line (Mark's playtest: "nginx -t does not work either"): the config test with
// the file and line of the first error, -T, -v, -s reload, and systemctl restart running the same
// test first. Every machine in content that has an nginx config passes the test at the start,
// except service-down, whose broken config is the quest.

import { describe, expect, it } from 'vitest';
import type { ScenarioSpec } from '../../src/content/types';
import { createSession, run, saveFile } from '../../src/sim/session';
import { content, FIXTURE, session, sh, t } from '../helpers';

const conf = (files: Record<string, string>, state: 'active' | 'failed' = 'active'): ScenarioSpec => ({
  ...FIXTURE,
  files: { '/etc/nginx/nginx.conf': 'user www-data;\nevents {}\nhttp {\n  include /etc/nginx/conf.d/*.conf;\n}\n', ...files },
  services: { nginx: { description: 'nginx', state, logs: [] } },
  objectives: [{ id: 'up', text: 'obj', done_when: 'service("nginx") == "active"' }],
});

const scenario = (id: string) => content().quests.find((q) => q.id === id)!.scenario!;

describe('nginx -t', () => {
  it('passes a good config and names the file and line of a bad one', () => {
    expect(sh(session(conf({ '/etc/nginx/conf.d/a.conf': 'server {\n  listen 80;\n  root /srv;\n}\n' })), 'nginx -t')).toBe(
      'nginx: the configuration file /etc/nginx/nginx.conf syntax is ok\nnginx: configuration file /etc/nginx/nginx.conf test is successful',
    );
    const cases: [string, string][] = [
      ['server {\n  listn 80;\n}\n', 'unknown directive "listn" in /etc/nginx/conf.d/a.conf:2'],
      ['server {\n  listen 80\n  root /srv;\n}\n', 'directive "listen" is not terminated by ";" in /etc/nginx/conf.d/a.conf:2'],
      ['server {\n  listen 80;\n', 'unexpected end of file, expecting "}" in /etc/nginx/conf.d/a.conf:2'],
      ['server {\n  listen 80;\n}\n}\n', 'unexpected "}" in /etc/nginx/conf.d/a.conf:4'],
      ['server {\n  listen 80;\n  root;\n}\n', 'invalid number of arguments in "root" directive in /etc/nginx/conf.d/a.conf:3'],
      ['server {\n  include missing.conf;\n}\n', 'open() "/etc/nginx/missing.conf" failed (2: No such file or directory) in /etc/nginx/conf.d/a.conf:2'],
    ];
    for (const [text, err] of cases) {
      const r = run(session(conf({ '/etc/nginx/conf.d/a.conf': text })), 'nginx -t');
      expect(r.out, text).toEqual([`nginx: [emerg] ${err}`, 'nginx: configuration file /etc/nginx/nginx.conf test failed']);
      expect(r.exit).toBe(1);
    }
  });
  it('treats types and map blocks as data, quotes as words, # as a comment', () => {
    const s = session(conf({ '/etc/nginx/conf.d/a.conf': 'types {\n  text/html html;\n}\nmap $uri $x {\n  default 0;\n}\nserver {\n  # listn 80;\n  add_header X-Frame "DENY; really";\n}\n' }));
    expect(sh(s, 'nginx -t')).toMatch(/syntax is ok/);
  });
  it('-T prints every file it read; -v the version; -s reload signals a running nginx', () => {
    const s = session(conf({ '/etc/nginx/conf.d/a.conf': 'server {\n  listen 80;\n}\n' }));
    expect(sh(s, 'nginx -T')).toMatch(/test is successful\n# configuration file \/etc\/nginx\/nginx.conf:\nuser www-data;.*# configuration file \/etc\/nginx\/conf.d\/a.conf:\nserver \{/s);
    expect(sh(s, 'nginx -v')).toBe('nginx version: nginx/1.24.0');
    expect(sh(s, 'nginx -s reload')).toMatch(/\[notice\] \d+#\d+: signal process started/);
    expect(sh(s, 'nginx -s stop')).toMatch(/signal process started/);
    expect(sh(s, 'nginx -s reload')).toBe('nginx: [error] invalid PID number "" in "/run/nginx.pid"');
    expect(sh(s, 'nginx')).toMatch(/systemctl start nginx/);
    expect(sh(s, 'nginx -x')).toMatch(/^nginx: invalid option: "x"/);
  });
  it('a reload with a broken config fails and keeps nginx running on the old one', () => {
    const s = session(conf({ '/etc/nginx/conf.d/a.conf': 'server {\n  listen 80;\n}\n' }));
    saveFile(s, '/etc/nginx/conf.d/a.conf', 'server {\n  lisen 80;\n}\n');
    expect(sh(s, 'nginx -s reload')).toBe('nginx: [emerg] unknown directive "lisen" in /etc/nginx/conf.d/a.conf:2');
    expect(run(s, 'systemctl reload nginx').exit).toBe(1);
    expect(sh(s, 'systemctl status nginx')).toMatch(/active \(running\)/);
  });
});

describe('nginx in the quests', () => {
  it('every machine with an nginx config passes nginx -t at the start, except service-down', () => {
    let checked = 0;
    for (const q of content().quests) {
      if (!q.scenario?.files?.['/etc/nginx/nginx.conf']) continue;
      checked++;
      const out = sh(createSession(q.scenario, { t }), 'nginx -t');
      if (q.id === 'service-down') expect(out).toMatch(/unknown directive "listn" in \/etc\/nginx\/conf.d\/shop.conf:2/);
      else expect(out, q.id).toMatch(/test is successful/);
    }
    expect(checked).toBeGreaterThanOrEqual(3);
  });
  it('service-down: test the fix before the restart, as in real life', () => {
    const s = createSession(scenario('service-down'), { t });
    expect(run(s, 'help').out.join('\n')).toMatch(/\n {2}nginx +the web server's own tools/);
    // a restart with the typo fails with nginx's own error in the journal
    expect(run(s, 'systemctl restart nginx').exit).toBe(1);
    expect(sh(s, 'journalctl -u nginx -n 6 --no-pager')).toMatch(/nginx\[\d+\]: nginx: \[emerg\] unknown directive "listn" in \/etc\/nginx\/conf.d\/shop.conf:2/);
    // a half fix (the semicolon lost) is caught by the test, not by the outage
    saveFile(s, '/etc/nginx/conf.d/shop.conf', 'server {\n  listen 80\n  server_name shop.example.test;\n  root /var/www/shop;\n}\n');
    expect(sh(s, 'nginx -t')).toMatch(/directive "listen" is not terminated by ";" in \/etc\/nginx\/conf.d\/shop.conf:2/);
    saveFile(s, '/etc/nginx/conf.d/shop.conf', 'server {\n  listen 80;\n  server_name shop.example.test;\n  root /var/www/shop;\n}\n');
    expect(sh(s, 'nginx -t')).toMatch(/test is successful/);
    const r = run(s, 'systemctl restart nginx');
    expect(r.justWon).toBe(true);
  });
});
