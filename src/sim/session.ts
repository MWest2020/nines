// One terminal session on one scenario: run a command line, save a file from the editor, and
// after each step evaluate the scenario's events, hints and objectives. Pure: no DOM, no
// Phaser, no clock, no randomness. The UI layer renders RunResult and applies money changes.

import type { Translate } from '../core/i18n';
import type { ScenarioSpec } from '../content/types';
import { type Compiled, compile, test } from '../rules/expr';
import { own } from '../rules/own';
import { SCENARIO_FACTS } from '../rules/registries';
import { scenarioEnv } from './facts';
import { normalize, resolve } from './path';
import { COMMANDS, type Ctx, SUBCOMMANDS, type Ui } from './shell/commands';
import { parseLine } from './shell/parse';
import { createState, type SimState, writeFile } from './state';
import { expandGlob } from './vfs';

export interface FiredEvent {
  id: string;
  /** locale key; "quest" = from the quest folder, "global" = from content/locales */
  say: string;
  scope: 'quest' | 'global';
  money: number;
  reset: boolean;
  /** a progress flag the game stores in its save (progress flag() reads it) */
  setFlag?: string;
}

export interface RunResult {
  out: string[];
  exit: number;
  ui?: Ui;
  events: FiredEvent[];
  /** locale keys of hints unlocked by this step (at most one per step) */
  hints: string[];
  objectives: { id: string; text: string; done: boolean }[];
  won: boolean;
  /** true only on the step that completed the last objective */
  justWon: boolean;
}

interface CompiledScenario {
  objectives: { id: string; text: string; when: Compiled }[];
  hints: { id: string; text: string; when: Compiled }[];
  events: { id: string; when: Compiled; say: string; money: number; reset: boolean; setFlag?: string }[];
  serviceRules: Record<string, Compiled | undefined>;
  deploymentRules: Record<string, Compiled | undefined>;
}

export interface Session {
  spec: ScenarioSpec;
  t: Translate;
  hintBoost: number;
  initial: SimState;
  state: SimState;
  compiled: CompiledScenario;
  won: boolean;
}

export const DEFAULT_OUTAGE = { say: 'sh.outage', money: -100 };

/** Compile every condition of a scenario. Throws ExprError on bad content (the validator runs this too). */
export function compileScenario(spec: ScenarioSpec): CompiledScenario {
  const c = (src: string) => compile(src, SCENARIO_FACTS);
  const serviceRules: Record<string, Compiled | undefined> = {};
  for (const [name, s] of Object.entries(spec.services ?? {})) {
    serviceRules[name] = s.restart?.succeeds_if !== undefined ? c(s.restart.succeeds_if) : undefined;
  }
  const deploymentRules: Record<string, Compiled | undefined> = {};
  for (const [name, d] of Object.entries(spec.deployments ?? {})) {
    deploymentRules[name] = d.restart?.succeeds_if !== undefined ? c(d.restart.succeeds_if) : undefined;
  }
  return {
    objectives: spec.objectives.map((o) => ({ id: o.id, text: o.text, when: c(o.done_when) })),
    hints: (spec.hints ?? []).map((h) => ({ id: h.id, text: h.text, when: c(h.when) })),
    events: (spec.events ?? []).map((e) => ({
      id: e.id,
      when: c(e.when),
      say: e.say,
      money: e.money ?? 0,
      reset: e.reset ?? false,
      ...(e.set_flag !== undefined ? { setFlag: e.set_flag } : {}),
    })),
    serviceRules,
    deploymentRules,
  };
}

export function createSession(spec: ScenarioSpec, opts: { t: Translate; hintBoost?: number }): Session {
  const initial = createState(spec);
  return {
    spec,
    t: opts.t,
    hintBoost: opts.hintBoost ?? 0,
    initial,
    state: structuredClone(initial),
    compiled: compileScenario(spec),
    won: false,
  };
}

/** The prompt, e.g. "dev@web-01:~/shop$ ". */
export function prompt(s: SimState): string {
  const where = s.cwd === s.home ? '~' : s.cwd.startsWith(s.home + '/') ? '~' + s.cwd.slice(s.home.length) : s.cwd;
  return `${s.user}@${s.host}:${where}$ `;
}

/** Back to the initial machine, keeping what the player has learned (counters, hints, events). */
function resetMachine(session: Session, work: SimState): SimState {
  const fresh = structuredClone(session.initial);
  fresh.counters = work.counters;
  fresh.ran = work.ran;
  fresh.firedEvents = work.firedEvents;
  fresh.shownHints = work.shownHints;
  fresh.flags = work.flags;
  return fresh;
}

/** Flags that take a value before the subcommand, e.g. kubectl -n default get pods. */
const LEADING_VALUE_FLAGS: Record<string, string[]> = { kubectl: ['-n', '--namespace', '-o', '--output', '-f', '--filename'] };

function subcommandOf(name: string, args: string[]): string | undefined {
  if (!SUBCOMMANDS.has(name)) return undefined;
  const valueFlags = own(LEADING_VALUE_FLAGS, name) ?? [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (valueFlags.includes(a)) i++;
    else if (!a.startsWith('-')) return a;
  }
  return undefined;
}

function expandWord(work: SimState, text: string, glob: boolean): string[] {
  if (!glob) return [text];
  const absPattern = resolve(work.cwd, work.home, text);
  const hits = expandGlob(work, absPattern);
  if (hits.length === 0) return [text];
  if (text.startsWith('/') || text.startsWith('~')) return hits;
  const prefix = work.cwd === '/' ? '/' : work.cwd + '/';
  return hits.map((h) => (h.startsWith(prefix) ? h.slice(prefix.length) : h));
}

function settle(session: Session, work: SimState, out: string[], exit: number, ui: Ui | undefined, pre: FiredEvent[]): RunResult {
  // The homelab's hint boost counts as extra failed attempts for hints only, never for
  // events or objectives.
  const source = { state: () => work, initial: session.initial, spec: session.spec };
  const env = scenarioEnv({ ...source, hintBoost: 0 });
  const hintEnv = scenarioEnv({ ...source, hintBoost: session.hintBoost });
  const events = [...pre];
  for (const e of session.compiled.events) {
    if (work.firedEvents.includes(e.id) || !test(e.when, env)) continue;
    // An event that resets the machine stays armed: the reset makes its condition false
    // again, and doing the same damage twice should cost twice.
    if (!e.reset) work.firedEvents.push(e.id);
    if (e.setFlag) work.flags[e.setFlag] = true;
    events.push({ id: e.id, say: e.say, scope: 'quest', money: e.money, reset: e.reset, ...(e.setFlag ? { setFlag: e.setFlag } : {}) });
    if (e.reset) {
      work = resetMachine(session, work);
      // If the condition reads something the reset keeps (fails, ran(), flags), it would fire
      // on every command from now on. Then it has fired for good.
      if (test(e.when, env)) work.firedEvents.push(e.id);
    }
  }
  const hints: string[] = [];
  for (const h of session.compiled.hints) {
    if (work.shownHints.includes(h.id) || !test(h.when, hintEnv)) continue;
    work.shownHints.push(h.id);
    hints.push(h.text);
    break;
  }
  const objectives = session.compiled.objectives.map((o) => ({ id: o.id, text: o.text, done: test(o.when, env) }));
  const won = objectives.every((o) => o.done);
  const justWon = won && !session.won;
  session.won ||= won;
  session.state = work;
  return { out, exit, ...(ui ? { ui } : {}), events, hints, objectives, won, justWon };
}

/** Control characters other than tab and newline: player input never carries escape sequences into xterm. */
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g;
export const stripControl = (text: string): string => text.replace(CONTROL, '');

export function run(session: Session, rawLine: string): RunResult {
  const line = stripControl(rawLine);
  let work = structuredClone(session.state);
  if (line.trim() === '') return settle(session, work, [], 0, undefined, []);
  const t = session.t;
  const env = scenarioEnv({ state: () => work, initial: session.initial, spec: session.spec, hintBoost: 0 });
  const ctx: Ctx = {
    s: work,
    spec: session.spec,
    env,
    t,
    serviceRules: session.compiled.serviceRules,
    deploymentRules: session.compiled.deploymentRules,
  };

  const out: string[] = [];
  let exit = 0;
  let failed = false;
  let ui: Ui | undefined;
  let outage = false;

  const parsed = parseLine(line);
  if (!parsed.ok) {
    out.push(parsed.error === 'unsupported' ? t('sh.unsupported', { op: parsed.op }) : t(`sh.${parsed.error}`));
    exit = 2;
    failed = true;
  } else {
    let stdin: string[] | null = null;
    for (const words of parsed.pipeline) {
      let args = words.flatMap((w) => expandWord(work, w.text, w.glob));
      if (args[0] === 'sudo') args = args.slice(1);
      const name = args[0];
      if (name === undefined) {
        stdin = [];
        continue;
      }
      const cmd = own(COMMANDS, name);
      if (!cmd) {
        out.length = 0;
        out.push(t('sh.not_found', { cmd: name }));
        exit = 127;
        failed = true;
        break;
      }
      const record = (n: string) => {
        if (!work.ran.includes(n)) work.ran.push(n);
      };
      record(name);
      const sub = subcommandOf(name, args.slice(1));
      if (sub) record(`${name} ${sub}`);

      const res = cmd(ctx, args.slice(1), stdin);
      exit = res.exit;
      failed ||= res.fail ?? res.exit !== 0;
      if (res.ui) ui = { ...ui, ...res.ui };
      if (res.outage) {
        out.push(...res.out);
        outage = true;
        break;
      }
      stdin = res.out;
    }
    if (!outage && stdin && exit !== 127) out.push(...stdin);
  }

  work.counters.commands++;
  if (failed) work.counters.fails++;

  const pre: FiredEvent[] = [];
  if (outage) {
    const o = session.spec.outage;
    pre.push({
      id: 'outage',
      say: o?.say ?? DEFAULT_OUTAGE.say,
      scope: o?.say !== undefined ? 'quest' : 'global',
      money: o?.money ?? DEFAULT_OUTAGE.money,
      reset: true,
    });
    work = resetMachine(session, work);
  }
  return settle(session, work, out, exit, ui, pre);
}

/** The editor's Save. The path comes from the editor ui returned by `edit`. */
export function saveFile(session: Session, path: string, content: string): RunResult {
  const work = structuredClone(session.state);
  writeFile(work.fs, normalize(path), stripControl(content.replace(/\r\n?/g, '\n')));
  if (!work.ran.includes('edit')) work.ran.push('edit');
  return settle(session, work, [], 0, undefined, []);
}
