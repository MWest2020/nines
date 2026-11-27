// One terminal session on one scenario: run a command line, save a file from the editor, and
// after each step evaluate the scenario's events, hints and objectives. Pure: no DOM, no
// Phaser, no clock, no randomness. The UI layer renders RunResult and applies money changes.

import type { Translate } from '../core/i18n';
import type { CheckSpec, ScenarioSpec } from '../content/types';
import { type Compiled, compile, test } from '../rules/expr';
import { own } from '../rules/own';
import { SCENARIO_FACTS } from '../rules/registries';
import { type CheckNote, grade } from './check';
import { scenarioEnv } from './facts';
import { applyManifest, rollout } from './shell/kubectl';
import { normalize, resolve } from './path';
import { COMMANDS, type Ctx, hasNginx, SUBCOMMANDS, type Ui } from './shell/commands';
import { parseLine } from './shell/parse';
import { createState, type SimState, writeFile } from './state';
import { expandGlob } from './vfs';

export interface FiredEvent {
  id: string;
  /** locale key; "quest" = from the quest folder, "global" = from content/locales */
  say: string;
  scope: 'quest' | 'global';
  money: number;
  /** karma change (a loss costs every time, a gain counts once) */
  karma: number;
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
  /** `procedure`: a contractor may skip it; `skipped`: this session does (it does not count);
   *  `note`: what a free-text check still finds wrong, once the player has changed that file */
  objectives: { id: string; text: string; done: boolean; procedure?: true; skipped?: true; note?: CheckNote }[];
  /** a hustle's chance of getting caught right now (scenario `risk`); absent without one */
  risk?: Risk;
  won: boolean;
  /** true only on the step that completed the last objective */
  justWon: boolean;
}

/** A hustle's risk now: percent (0 to 100) and the factors that hold, as locale keys. */
export interface Risk {
  percent: number;
  factors: { id: string; text: string; add: number }[];
}

interface CompiledScenario {
  objectives: { id: string; text: string; when: Compiled | null; procedure: boolean; check?: CheckSpec }[];
  risk: { base: number; factors: { id: string; text: string; add: number; when: Compiled }[] } | null;
  hints: { id: string; text: string; when: Compiled }[];
  events: { id: string; when: Compiled; say: string; money: number; karma: number; reset: boolean; setFlag?: string }[];
  serviceRules: Record<string, Compiled | undefined>;
  deploymentRules: Record<string, Compiled | undefined>;
}

export interface Session {
  spec: ScenarioSpec;
  t: Translate;
  hintBoost: number;
  /** an independent contractor: procedure objectives do not count towards the win */
  skipProcedures: boolean;
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
    objectives: spec.objectives.map((o) => ({
      id: o.id,
      text: o.text,
      when: o.done_when !== undefined ? c(o.done_when) : null,
      procedure: o.procedure === true,
      ...(o.check ? { check: o.check } : {}),
    })),
    risk: spec.risk ? { base: spec.risk.base, factors: spec.risk.factors.map((f) => ({ id: f.id, text: f.text, add: f.add, when: c(f.when) })) } : null,
    hints: (spec.hints ?? []).map((h) => ({ id: h.id, text: h.text, when: c(h.when) })),
    events: (spec.events ?? []).map((e) => ({
      id: e.id,
      when: c(e.when),
      say: e.say,
      money: e.money ?? 0,
      karma: e.karma ?? 0,
      reset: e.reset ?? false,
      ...(e.set_flag !== undefined ? { setFlag: e.set_flag } : {}),
    })),
    serviceRules,
    deploymentRules,
  };
}

/** `flags`: the save's progress flags; the machine starts with those its scenario `carry`s. */
export function createSession(spec: ScenarioSpec, opts: { t: Translate; hintBoost?: number; skipProcedures?: boolean; flags?: Record<string, boolean> }): Session {
  const initial = createState(spec, opts.flags ?? {});
  return {
    spec,
    t: opts.t,
    hintBoost: opts.hintBoost ?? 0,
    skipProcedures: opts.skipProcedures ?? false,
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
  fresh.touched = work.touched;
  fresh.swept = work.swept;
  fresh.opened = work.opened;
  fresh.read = work.read;
  fresh.firedEvents = work.firedEvents;
  fresh.shownHints = work.shownHints;
  fresh.flags = work.flags;
  fresh.logins = work.logins;
  fresh.history = work.history;
  fresh.unknown = work.unknown;
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
    events.push({ id: e.id, say: e.say, scope: 'quest', money: e.money, karma: e.karma, reset: e.reset, ...(e.setFlag ? { setFlag: e.setFlag } : {}) });
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
  const objectives = session.compiled.objectives.map((o) => {
    const graded = o.check ? gradeIn(session, work, o.check) : null;
    const done = (o.when === null || test(o.when, env)) && (graded === null || graded.ok);
    return {
      id: o.id,
      text: o.text,
      done,
      ...(o.procedure ? { procedure: true as const } : {}),
      ...(o.procedure && session.skipProcedures ? { skipped: true as const } : {}),
      ...(!done && graded?.note && graded.changed ? { note: graded.note } : {}),
    };
  });
  const won = objectives.every((o) => o.done || o.skipped);
  const justWon = won && !session.won;
  session.won ||= won;
  session.state = work;
  const risk = riskIn(session, work);
  return { out, exit, ...(ui ? { ui } : {}), events, hints, objectives, won, justWon, ...(risk ? { risk } : {}) };
}

/** Grade a check's file; `changed`: the player has written it (a note before that would nag). */
function gradeIn(session: Session, work: SimState, check: CheckSpec) {
  const n = work.fs[check.file];
  const text = n?.type === 'file' ? (n.content ?? '') : undefined;
  const before = session.initial.fs[check.file];
  const changed = text !== (before?.type === 'file' ? (before.content ?? '') : undefined);
  return { ...grade(check, text), changed };
}

function riskIn(session: Session, work: SimState): Risk | null {
  const r = session.compiled.risk;
  if (!r) return null;
  const env = scenarioEnv({ state: () => work, initial: session.initial, spec: session.spec, hintBoost: 0 });
  const factors = r.factors.filter((f) => test(f.when, env)).map((f) => ({ id: f.id, text: f.text, add: f.add }));
  // a percentage here; the game caps it (core/karma.ts RISK_CAP) before it rolls
  return { percent: Math.max(0, Math.min(100, r.base + factors.reduce((sum, f) => sum + f.add, 0))), factors };
}

/** A hustle's risk of getting caught as the machine stands now; null for a scenario without one. */
export const riskOf = (session: Session): Risk | null => riskIn(session, session.state);

/** Commands that read what is inside a file (the opened() fact); listing and sizing (ls, du, wc) do not. */
const READERS = new Set(['cat', 'less', 'tail', 'head', 'grep', 'sort', 'uniq', 'edit', 'nano', 'vi', 'vim', 'mv']);
/** Flags whose next word is a value, never a path. */
const VALUE_FLAGS: Record<string, string[]> = {
  tail: ['-n'],
  head: ['-n'],
  find: ['-name', '-iname', '-type', '-maxdepth', '-size'],
  grep: ['-e', '-m', '-A', '-B', '-C'],
  journalctl: ['-u', '-n'],
  kubectl: ['-n', '--namespace', '-o', '--output', '--tail'],
};

/** Does a command line's words name a recursive walk (grep -r, du, rm -r)? */
function recursive(name: string, args: readonly string[]): boolean {
  // du and find always walk the folders they are given (the working directory without one)
  if (name === 'du' || name === 'find') return true;
  if (name !== 'grep' && name !== 'rm') return false;
  return args.some((a) => a === '--recursive' || (/^-[A-Za-z]+$/.test(a) && /[rR]/.test(a)));
}

/**
 * Record what a command reached, for the touched() and opened() facts: every operand that is an
 * existing path (relative ones resolved against the working directory; flag values and grep's
 * pattern are not operands), and for a recursive command the folders it walked (the working
 * directory when it names none). Reading commands also open the files they name, and grep -r
 * opens everything it walks. Before the command runs, so rm still sees what it removes.
 */
function touch(work: SimState, name: string, args: readonly string[]): void {
  const deep = recursive(name, args);
  const valueFlags = own(VALUE_FLAGS, name) ?? [];
  const operands: string[] = [];
  let pattern = name === 'grep' && !args.includes('-e');
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') continue;
    if (valueFlags.includes(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-') && a !== '-') continue;
    if (pattern) {
      pattern = false;
      continue;
    }
    operands.push(a);
  }
  // `cd` with no operand goes home; `cd -` goes back; du and grep -r with no operand walk the cwd
  if (name === 'cd' && operands.length === 0) operands.push(work.home);
  if (deep && name !== 'rm' && operands.length === 0) operands.push('.');
  const reads = READERS.has(name);
  for (const a of operands) {
    const p = a === '-' && name === 'cd' ? work.oldpwd : resolve(work.cwd, work.home, a);
    const n = work.fs[p];
    if (!n) continue;
    if (!work.touched.includes(p)) work.touched.push(p);
    if (deep && n.type === 'dir' && !work.swept.includes(p)) work.swept.push(p);
    if (reads && n.type === 'file' && !work.opened.includes(p)) work.opened.push(p);
    if (reads && deep && n.type === 'dir' && !work.read.includes(p)) work.read.push(p);
  }
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

  if (work.history.length < 500) work.history.push(line);
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
      if (cmd) touch(work, name, args.slice(1));
      if (!cmd || !available(work, name)) {
        out.length = 0;
        out.push(t('sh.not_found', { cmd: name }));
        // the gaps players hit (src/sim/unknown.ts collects them in the page); a command this
        // machine lacks but others have (nginx) is not a gap
        if (!cmd && !work.unknown.includes(name) && work.unknown.length < 100) work.unknown.push(name);
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
      karma: 0,
      reset: true,
    });
    work = resetMachine(session, work);
  }
  return settle(session, work, out, exit, ui, pre);
}

/** The editor's Save. The path comes from the editor ui returned by `edit` (or kubectl edit). */
export function saveFile(session: Session, path: string, content: string): RunResult {
  const work = structuredClone(session.state);
  const p = normalize(path);
  writeFile(work.fs, p, stripControl(content.replace(/\r\n?/g, '\n')));
  const out: string[] = [];
  let exit = 0;
  let ui: Ui | undefined;
  const edit = work.kubeEdit;
  if (edit && edit.path === p) {
    // kubectl edit: saving the temporary file applies it to the object it came from
    const env = scenarioEnv({ state: () => work, initial: session.initial, spec: session.spec, hintBoost: 0 });
    const ctx: Ctx = { s: work, spec: session.spec, env, t: session.t, serviceRules: session.compiled.serviceRules, deploymentRules: session.compiled.deploymentRules };
    const r = applyManifest(ctx, p, p, edit.key.split('/')[1] ?? 'default', edit.key);
    if (r.bad) {
      // like kubectl, the editor opens again on the same text, so nothing typed is lost
      out.push(r.line, session.t('sh.kubectl_edit_again'));
      exit = 1;
      const n = work.fs[p];
      ui = { editor: { path: p, content: n?.type === 'file' ? (n.content ?? '') : '' } };
    } else {
      out.push(r.line.replace(/ (configured|unchanged|created)$/, (_m, how: string) => (how === 'unchanged' ? ' skipped: no changes' : ' edited')));
      // an edited Deployment rolls out new pods, as apply does
      if (r.rollout) rollout(ctx, r.rollout);
      work.kubeEdit = null;
      delete work.fs[p];
    }
  } else {
    if (!work.ran.includes('edit')) work.ran.push('edit');
    if (!work.touched.includes(p)) work.touched.push(p);
    if (!work.opened.includes(p)) work.opened.push(p);
  }
  return settle(session, work, out, exit, ui, []);
}

/** The editor closed without saving: a kubectl edit is cancelled ("Edit cancelled, no changes made."). */
export function cancelEdit(session: Session, path: string): string[] {
  const edit = session.state.kubeEdit;
  if (!edit || edit.path !== normalize(path)) return [];
  const work = structuredClone(session.state);
  delete work.fs[edit.path];
  work.kubeEdit = null;
  session.state = work;
  return ['Edit cancelled, no changes made.'];
}

/** A command this machine has: nginx only where nginx is installed. */
function available(s: SimState, name: string): boolean {
  return name !== 'nginx' || hasNginx(s);
}
