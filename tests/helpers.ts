import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createTranslator } from '../src/core/i18n';
import type { ContentBundle, ScenarioSpec } from '../src/content/types';
import { createSession, run, type RunResult, type Session } from '../src/sim/session';
import { loadContent } from '../tools/content/load';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const CONTENT_DIR = join(ROOT, 'content');
export const SCHEMA_DIR = join(ROOT, 'schemas');

let cached: ContentBundle | null = null;
export function content(): ContentBundle {
  if (!cached) {
    const r = loadContent(CONTENT_DIR, SCHEMA_DIR);
    if (!r.bundle) throw new Error(r.errors.join('\n'));
    cached = r.bundle;
  }
  return cached;
}

export const t = (() => {
  let tr: ReturnType<typeof createTranslator> | null = null;
  return (key: string, params?: Record<string, string | number>) => {
    tr ??= createTranslator(content().locales, 'en');
    return tr(key, params);
  };
})();

export function session(spec: ScenarioSpec, hintBoost = 0): Session {
  return createSession(spec, { t, hintBoost });
}

/** Run a line and return its output as one string, for readable assertions. */
export function sh(s: Session, line: string): string {
  return run(s, line).out.join('\n');
}

export function steps(s: Session, ...lines: string[]): RunResult {
  let last: RunResult | null = null;
  for (const l of lines) last = run(s, l);
  return last!;
}

/** A small machine for command tests. */
export const FIXTURE: ScenarioSpec = {
  schema: 1,
  host: 'box',
  user: 'dev',
  home: '/home/dev',
  motd: 'motd',
  mounts: [
    { path: '/', device: '/dev/sda1', size: '10G', base_used: '2G' },
    { path: '/var', device: '/dev/sdb1', size: '1G', base_used: '100M' },
  ],
  dirs: ['/tmp', '/home/dev/empty'],
  files: {
    '/home/dev/notes.txt': 'alpha\nbeta\nGamma\n',
    '/home/dev/.hidden': 'secret\n',
    '/home/dev/repo/app.yml': 'stages: [build]\nbuild:\n  stage: build\n  script: [make]\n',
    '/home/dev/repo/README.md': '# repo\n',
    '/var/log/app.log': { size: '500M', content: 'line 1\nerror: disk\nline 3\n' },
    '/var/log/old.gz': { size: '300M' },
    '/var/lib/db/data': { size: '50M' },
    '/etc/app.conf': 'port 80\n',
  },
  services: {
    web: {
      description: 'Web server',
      state: 'failed',
      logs: ['l1', 'l2 error: bad config', 'l3'],
      restart: { succeeds_if: 'file_contains("/etc/app.conf", "port 8080")' },
    },
    db: { description: 'Database', state: 'active' },
  },
  deployments: {
    api: {
      status: 'CrashLoopBackOff',
      restarts: 4,
      logs: ['panic: missing env DB_URL'],
      restart: { succeeds_if: 'exists("/etc/api.env")', logs_on_success: ['listening on :8080'] },
    },
  },
  git: { root: '/home/dev/repo', pipeline: { file: 'app.yml', validator: 'nines-ci' } },
  objectives: [{ id: 'web', text: 'obj', done_when: 'service("web") == "active"' }],
  hints: [{ id: 'h1', when: 'fails >= 2', text: 'hint.one' }],
  events: [{ id: 'db', when: 'removed("/var/lib/db/data")', say: 'event.db', money: -50, reset: true }],
};
