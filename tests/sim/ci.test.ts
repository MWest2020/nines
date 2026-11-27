import { describe, expect, it } from 'vitest';
import { validateNinesCi } from '../../src/sim/ci';

const GOOD = 'stages: [build, test]\nbuild:\n  stage: build\n  script: [npm ci]\ntest:\n  stage: test\n  needs: [build]\n  script:\n    - npm test\n';

describe('nines-ci validator', () => {
  it('accepts a good pipeline', () => {
    expect(validateNinesCi(GOOD)).toEqual({ ok: true, errors: [] });
  });
  it('reports a tab with its line, once', () => {
    const r = validateNinesCi('stages: [t]\nt:\n  stage: t\n  script:\n\t- x\n');
    expect(r.ok).toBe(false);
    expect(r.errors).toEqual(['line 5: Tabs are not allowed as indentation']);
  });
  it('reports structure errors', () => {
    const r = validateNinesCi('stages: [build, build]\nbuild:\n  stage: biuld\n  scirpt: [x]\n  needs: [nope, build]\n');
    expect(r.errors).toEqual([
      'stage names must be unique',
      'job "build": unknown key "scirpt"',
      'job "build": stage "biuld" is not in stages',
      'job "build": "script" must be a non-empty list of commands',
      'job "build" needs unknown job "nope"',
      'job "build" cannot need itself',
    ]);
  });
  it('wants stages and at least one job', () => {
    expect(validateNinesCi('build:\n  stage: x\n  script: [y]\n').errors).toContain('"stages" must be a non-empty list');
    expect(validateNinesCi('stages: [a]\n').errors).toContain('there are no jobs');
    expect(validateNinesCi('- a\n').errors).toEqual(['the file must be a mapping of stages and jobs']);
    expect(validateNinesCi('stages: [a]\nstages: [b]\n').ok).toBe(false);
  });
});

describe('nines-ci cache and secrets (the DevOps quest in Medior City)', () => {
  const base = 'stages: [build]\nbuild:\n  stage: build\n  script: [npm ci]\n';
  it('accepts a cache keyed on a file, with folders to keep, and secrets by name', () => {
    expect(validateNinesCi(`${base}  cache:\n    key: package-lock.json\n    paths: [.npm]\n  secrets: [DEPLOY_TOKEN, NPM_TOKEN]\n`)).toEqual({ ok: true, errors: [] });
  });
  it('refuses a cache without a key or paths, unknown cache keys, and secrets that are not names', () => {
    expect(validateNinesCi(`${base}  cache: .npm\n`).errors).toEqual(['job "build": "cache" must be a mapping with key and paths']);
    expect(validateNinesCi(`${base}  cache:\n    paths: [.npm]\n    ttl: 7d\n`).errors).toEqual(['job "build": cache: unknown key "ttl"', 'job "build": cache: "key" must name a file']);
    expect(validateNinesCi(`${base}  cache:\n    key: package-lock.json\n    paths: []\n`).errors).toEqual(['job "build": cache: "paths" must be a non-empty list of folders']);
    expect(validateNinesCi(`${base}  secrets: DEPLOY_TOKEN\n`).errors).toEqual(['job "build": "secrets" must be a non-empty list of names']);
    // a value pasted where a name belongs is refused, so a token cannot hide in this list
    expect(validateNinesCi(`${base}  secrets: [dpl_live_7f3a]\n`).errors).toEqual(['job "build": secret "dpl_live_7f3a" must be an upper-case name like DEPLOY_TOKEN']);
  });
});
