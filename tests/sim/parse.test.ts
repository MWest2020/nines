import { describe, expect, it } from 'vitest';
import { parseFlags, parseLine } from '../../src/sim/shell/parse';

const words = (line: string) => {
  const r = parseLine(line);
  if (!r.ok) throw new Error(r.error);
  return r.pipeline.map((c) => c.map((w) => w.text));
};

describe('parseLine', () => {
  it('splits words on spaces and tabs', () => {
    expect(words('ls   -la\t/var')).toEqual([['ls', '-la', '/var']]);
  });
  it('handles quotes and escapes', () => {
    expect(words(`git commit -m "fix the \\"pipeline\\""`)).toEqual([['git', 'commit', '-m', 'fix the "pipeline"']]);
    expect(words(`grep 'a b' x`)).toEqual([['grep', 'a b', 'x']]);
    expect(words('cat my\\ file')).toEqual([['cat', 'my file']]);
    expect(words('echo ""')).toEqual([['echo', '']]);
  });
  it('splits pipes', () => {
    expect(words('journalctl -u nginx | grep emerg')).toEqual([['journalctl', '-u', 'nginx'], ['grep', 'emerg']]);
  });
  it('marks unquoted globs only', () => {
    const r = parseLine(`rm *.gz '*.log'`);
    expect(r.ok && r.pipeline[0]!.map((w) => w.glob)).toEqual([false, true, false]);
  });
  it('refuses what a real shell would do but this one does not', () => {
    for (const [line, op] of [['ls > x', '>'], ['a && b', '&&'], ['a; b', ';'], ['echo $HOME', '$'], ['a || b', '||'], ['echo $(ls)', '$(']] as const) {
      expect(parseLine(line)).toEqual({ ok: false, error: 'unsupported', op });
    }
  });
  it('reports unterminated quotes and empty pipe sides', () => {
    expect(parseLine('cat "x')).toEqual({ ok: false, error: 'unterminated_quote' });
    expect(parseLine('| grep x')).toEqual({ ok: false, error: 'empty_pipe' });
    expect(parseLine('ls |')).toEqual({ ok: false, error: 'empty_pipe' });
  });
  it('returns an empty pipeline for a blank line', () => {
    expect(parseLine('   ')).toEqual({ ok: true, pipeline: [] });
  });
});

describe('parseFlags', () => {
  const spec = { bool: 'rfh', value: 'n', long: { 'no-pager': 'bool' as const, tail: 'value' as const } };
  it('reads clusters, values and long options', () => {
    expect(parseFlags(['-rf', '-n', '5', 'x', '--no-pager', '--tail=3'], spec)).toEqual({
      ok: true,
      flags: { r: true, f: true, n: '5', 'no-pager': true, tail: '3' },
      rest: ['x'],
    });
    expect(parseFlags(['-n20'], spec)).toEqual({ ok: true, flags: { n: '20' }, rest: [] });
    expect(parseFlags(['-hn', '7'], spec)).toEqual({ ok: true, flags: { h: true, n: '7' }, rest: [] });
  });
  it('stops at -- and keeps - as an operand', () => {
    expect(parseFlags(['--', '-r', '-'], spec)).toEqual({ ok: true, flags: {}, rest: ['-r', '-'] });
    expect(parseFlags(['-'], spec)).toEqual({ ok: true, flags: {}, rest: ['-'] });
  });
  it('names the bad option', () => {
    expect(parseFlags(['-x'], spec)).toEqual({ ok: false, bad: '-x' });
    expect(parseFlags(['--nope'], spec)).toEqual({ ok: false, bad: '--nope' });
    expect(parseFlags(['-n'], spec)).toEqual({ ok: false, bad: '-n' });
  });
});
