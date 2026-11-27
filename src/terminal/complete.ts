// Tab completion for the terminal's input line: command names, a few subcommands, unit and
// deployment names, and paths in the simulated filesystem. Pure: it reads a SimState and
// returns the new line, so it behaves the same in the browser and in tests.
//
// Like bash: a unique match is completed (a directory gets "/", anything else a space); several
// matches are completed to their longest common prefix; when that adds nothing, the matches are
// returned for the overlay to list.

import { own } from '../rules/own';
import { resolve } from '../sim/path';
import { COMMANDS } from '../sim/shell/commands';
import type { SimState } from '../sim/state';
import { isDir, listDir } from '../sim/vfs';

export interface Completion {
  line: string;
  cursor: number;
  /** the candidates to show when the line could not be completed further; empty otherwise */
  options: string[];
}

/** Subcommands the simulator knows, for the word after the command. */
const SUBCOMMANDS: Record<string, string[]> = {
  systemctl: ['restart', 'start', 'status'],
  git: ['add', 'commit', 'status'],
  kubectl: ['get', 'logs', 'rollout'],
};

export const COMMAND_NAMES: readonly string[] = Object.keys(COMMANDS).sort();

const commonPrefix = (words: readonly string[]): string => {
  if (words.length === 0) return '';
  let p = words[0]!;
  for (const w of words) while (!w.startsWith(p)) p = p.slice(0, -1);
  return p;
};

interface Candidate {
  /** what replaces the word being completed */
  text: string;
  /** appended when it is the only match: " " or "" (a directory's "/" is part of text) */
  end: string;
  /** shown in the list of options */
  label: string;
}

const words = (list: readonly string[], prefix: string): Candidate[] =>
  list.filter((w) => w.startsWith(prefix)).map((w) => ({ text: w, end: ' ', label: w }));

function pathCandidates(s: SimState, word: string): Candidate[] {
  if (word.startsWith('-')) return [];
  if (word === '~') return [{ text: '~/', end: '', label: '~/' }];
  const slash = word.lastIndexOf('/');
  const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
  const base = word.slice(slash + 1);
  const dir = resolve(s.cwd, s.home, dirPart === '' ? '.' : dirPart);
  if (!isDir(s, dir)) return [];
  return listDir(s, dir)
    .filter((name) => name.startsWith(base) && (base.startsWith('.') || !name.startsWith('.')))
    .map((name) => {
      const abs = dir === '/' ? `/${name}` : `${dir}/${name}`;
      const d = isDir(s, abs);
      return { text: dirPart + name + (d ? '/' : ''), end: d ? '' : ' ', label: name + (d ? '/' : '') };
    });
}

function candidates(s: SimState, before: readonly string[], word: string): Candidate[] {
  const args = before[0] === 'sudo' ? before.slice(1) : before;
  if (args.length === 0) return words(COMMAND_NAMES, word);
  const cmd = args[0]!;
  const subs = own(SUBCOMMANDS, cmd);
  if (subs && args.length === 1 && !word.startsWith('-')) return words(subs, word);
  const services = Object.keys(s.services).sort();
  const deployments = [...new Set(s.pods.map((p) => p.deployment))].sort();
  if (cmd === 'systemctl' && args.length === 2) return words(services, word);
  if (cmd === 'journalctl' && args[args.length - 1] === '-u') return words(services, word);
  if (cmd === 'kubectl' && args[1] === 'logs' && args.length === 2) {
    return words([...s.pods.map((p) => p.name).sort(), ...deployments.map((d) => `deployment/${d}`)], word);
  }
  if (cmd === 'kubectl' && args[1] === 'rollout') {
    if (args.length === 2) return words(['restart', 'status'], word);
    if (args.length === 3) return words(deployments.map((d) => `deployment/${d}`), word);
  }
  return pathCandidates(s, word);
}

/** Complete the word that ends at the cursor. */
export function complete(s: SimState, line: string, cursor: number): Completion {
  const none: Completion = { line, cursor, options: [] };
  const before = line.slice(0, cursor);
  const after = line.slice(cursor);
  // inside quotes, or right after a backslash: leave the line alone
  if ((before.match(/'/g) ?? []).length % 2 === 1 || (before.match(/"/g) ?? []).length % 2 === 1 || before.endsWith('\\')) return none;
  const segment = before.slice(before.lastIndexOf('|') + 1);
  const m = /(\S*)$/.exec(segment)!;
  const word = m[1]!;
  const prior = segment.slice(0, segment.length - word.length).trim().split(/\s+/).filter((w) => w !== '');
  const found = candidates(s, prior, word);
  if (found.length === 0) return none;
  const head = before.slice(0, before.length - word.length);
  if (found.length === 1) {
    const c = found[0]!;
    // no double space when the cursor already sits before one: step over it instead
    const skip = c.end === ' ' && after.startsWith(' ');
    const text = head + c.text + (skip ? '' : c.end);
    return { line: text + after, cursor: text.length + (skip ? 1 : 0), options: [] };
  }
  const prefix = commonPrefix(found.map((c) => c.text));
  if (prefix.length > word.length) {
    const text = head + prefix;
    return { line: text + after, cursor: text.length, options: [] };
  }
  return { line, cursor, options: found.map((c) => c.label) };
}
