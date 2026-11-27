// "nines-ci": the fictional CI format the pipeline quests use. Small on purpose, so the player
// learns the two real lessons (YAML syntax, and a config that refers to things that exist)
// without learning a vendor's whole schema.
//
//   stages: [build, test]          required: a list of unique stage names
//   <job name>:                    every other top-level key is a job
//     stage: test                  required: one of the stages
//     script: [npm test]           required: a non-empty list of commands
//     needs: [build]               optional: other jobs that must run first
//     image: node:22               optional
//     cache:                       optional: kept between runs while the key file is unchanged
//       key: package-lock.json       a file in the repository; its hash is the cache key
//       paths: [.npm]                folders to keep
//     secrets: [DEPLOY_TOKEN]      optional: names from the CI's secret store, given to the job
//                                  as environment variables and masked in its log
//
// Messages are English on purpose: they imitate a real CI system's output.

import { parseDocument } from 'yaml';

export interface CiResult {
  ok: boolean;
  errors: string[];
}

const JOB_KEYS = ['stage', 'script', 'needs', 'image', 'cache', 'secrets'];
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function validateNinesCi(text: string): CiResult {
  const doc = parseDocument(text, { prettyErrors: true, uniqueKeys: true });
  if (doc.errors.length > 0) {
    // Only the first syntax error: the ones after it are usually echoes of the first.
    const e = doc.errors[0]!;
    const line = e.linePos?.[0]?.line;
    const msg = (e.message.split('\n')[0] ?? e.message).replace(/ at line \d+, column \d+:?$/, '');
    return { ok: false, errors: [line ? `line ${line}: ${msg}` : msg] };
  }
  const data: unknown = doc.toJS();
  const errors: string[] = [];
  if (!isPlainObject(data)) return { ok: false, errors: ['the file must be a mapping of stages and jobs'] };

  const stagesRaw = data['stages'];
  let stages: string[] = [];
  if (!Array.isArray(stagesRaw) || stagesRaw.length === 0) {
    errors.push('"stages" must be a non-empty list');
  } else {
    stages = stagesRaw.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (stages.length !== stagesRaw.length) errors.push('every stage must be a non-empty name');
    if (new Set(stages).size !== stages.length) errors.push('stage names must be unique');
  }

  const jobs = Object.keys(data).filter((k) => k !== 'stages');
  if (jobs.length === 0) errors.push('there are no jobs');
  for (const name of jobs) {
    const job = data[name];
    if (!isPlainObject(job)) {
      errors.push(`job "${name}" must be a mapping`);
      continue;
    }
    for (const key of Object.keys(job)) {
      if (!JOB_KEYS.includes(key)) errors.push(`job "${name}": unknown key "${key}"`);
    }
    const stage = job['stage'];
    if (typeof stage !== 'string') errors.push(`job "${name}": "stage" is missing`);
    else if (!stages.includes(stage)) errors.push(`job "${name}": stage "${stage}" is not in stages`);
    const script = job['script'];
    if (!Array.isArray(script) || script.length === 0 || !script.every((x) => typeof x === 'string')) {
      errors.push(`job "${name}": "script" must be a non-empty list of commands`);
    }
    const cache = job['cache'];
    if (cache !== undefined) {
      if (!isPlainObject(cache)) errors.push(`job "${name}": "cache" must be a mapping with key and paths`);
      else {
        for (const k of Object.keys(cache)) if (k !== 'key' && k !== 'paths') errors.push(`job "${name}": cache: unknown key "${k}"`);
        if (typeof cache['key'] !== 'string' || cache['key'].trim() === '') errors.push(`job "${name}": cache: "key" must name a file`);
        const paths = cache['paths'];
        if (!Array.isArray(paths) || paths.length === 0 || !paths.every((x) => typeof x === 'string' && x.trim() !== '')) {
          errors.push(`job "${name}": cache: "paths" must be a non-empty list of folders`);
        }
      }
    }
    const secrets = job['secrets'];
    if (secrets !== undefined) {
      if (!Array.isArray(secrets) || secrets.length === 0) errors.push(`job "${name}": "secrets" must be a non-empty list of names`);
      else for (const x of secrets) if (typeof x !== 'string' || !SECRET_NAME.test(x)) errors.push(`job "${name}": secret "${String(x)}" must be an upper-case name like DEPLOY_TOKEN`);
    }
    const needs = job['needs'];
    if (needs !== undefined) {
      if (!Array.isArray(needs)) errors.push(`job "${name}": "needs" must be a list`);
      else
        for (const n of needs) {
          if (n === name) errors.push(`job "${name}" cannot need itself`);
          else if (typeof n !== 'string' || !jobs.includes(n)) errors.push(`job "${name}" needs unknown job "${String(n)}"`);
        }
    }
  }
  return { ok: errors.length === 0, errors };
}
