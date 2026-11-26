// The command line parser. Not a shell: words, quotes, backslash escapes, "~" and pipes.
// Redirection, ";", "&&", "$VAR", "$( )" and backticks are recognised and refused with a
// friendly message, so the player is never left guessing why something did nothing.

export interface Word {
  text: string;
  /** an unquoted * or ? was present: expand against the filesystem */
  glob: boolean;
}

export type Pipeline = Word[][];

export type ParseResult = { ok: true; pipeline: Pipeline } | { ok: false; error: 'unterminated_quote' | 'empty_pipe' } | { ok: false; error: 'unsupported'; op: string };

export function parseLine(line: string): ParseResult {
  const pipeline: Pipeline = [];
  let cmd: Word[] = [];
  let text = '';
  let glob = false;
  let inWord = false;
  let i = 0;

  const endWord = () => {
    if (inWord) cmd.push({ text, glob });
    text = '';
    glob = false;
    inWord = false;
  };

  while (i < line.length) {
    const c = line[i]!;
    if (c === ' ' || c === '\t') {
      endWord();
      i++;
      continue;
    }
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) return { ok: false, error: 'unterminated_quote' };
      text += line.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      inWord = true;
      for (;;) {
        if (i >= line.length) return { ok: false, error: 'unterminated_quote' };
        const d = line[i]!;
        if (d === '"') {
          i++;
          break;
        }
        if (d === '\\' && (line[i + 1] === '"' || line[i + 1] === '\\')) {
          text += line[i + 1];
          i += 2;
          continue;
        }
        if (d === '$' || d === '`') return { ok: false, error: 'unsupported', op: d === '$' ? '$' : '`' };
        text += d;
        i++;
      }
      continue;
    }
    if (c === '\\') {
      if (i + 1 < line.length) text += line[i + 1];
      inWord = true;
      i += 2;
      continue;
    }
    if (c === '|') {
      if (line[i + 1] === '|') return { ok: false, error: 'unsupported', op: '||' };
      endWord();
      if (cmd.length === 0) return { ok: false, error: 'empty_pipe' };
      pipeline.push(cmd);
      cmd = [];
      i++;
      continue;
    }
    if (c === '>' || c === '<' || c === ';' || c === '&' || c === '`' || c === '$') {
      const two = line.slice(i, i + 2);
      const op = ['>>', '&&', '$('].includes(two) ? two : c;
      return { ok: false, error: 'unsupported', op };
    }
    // "~" stays in the word; commands resolve "~" and "~/x" as the home directory.
    if (c === '*' || c === '?') glob = true;
    text += c;
    inWord = true;
    i++;
  }
  endWord();
  if (cmd.length === 0) {
    if (pipeline.length > 0) return { ok: false, error: 'empty_pipe' };
    return { ok: true, pipeline: [] };
  }
  pipeline.push(cmd);
  return { ok: true, pipeline };
}

export interface FlagSpec {
  /** short flags without a value, e.g. "rfi" */
  bool?: string;
  /** short flags that take a value, e.g. "n" for -n 20 / -n20 */
  value?: string;
  /** long flags: --no-pager (bool) or --tail=20 / --tail 20 (value) */
  long?: Record<string, 'bool' | 'value'>;
}

export type Flags = Record<string, string | true>;
export type FlagResult = { ok: true; flags: Flags; rest: string[] } | { ok: false; bad: string };

/** getopt-like: "-rf", "-n 20", "-n20", "--tail=5", "--" ends options, "-" is an operand. */
export function parseFlags(args: string[], spec: FlagSpec): FlagResult {
  const flags: Flags = {};
  const rest: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const name = eq < 0 ? a.slice(2) : a.slice(2, eq);
      const kind = spec.long?.[name];
      if (!kind) return { ok: false, bad: a };
      if (kind === 'bool') {
        if (eq >= 0) return { ok: false, bad: a };
        flags[name] = true;
      } else if (eq >= 0) flags[name] = a.slice(eq + 1);
      else {
        const v = args[++i];
        if (v === undefined) return { ok: false, bad: a };
        flags[name] = v;
      }
      continue;
    }
    if (a.startsWith('-') && a.length > 1) {
      for (let j = 1; j < a.length; j++) {
        const f = a[j]!;
        if (spec.bool?.includes(f)) flags[f] = true;
        else if (spec.value?.includes(f)) {
          const inline = a.slice(j + 1);
          const v = inline !== '' ? inline : args[++i];
          if (v === undefined) return { ok: false, bad: `-${f}` };
          flags[f] = v;
          break;
        } else return { ok: false, bad: `-${f}` };
      }
      continue;
    }
    rest.push(a);
  }
  return { ok: true, flags, rest };
}
