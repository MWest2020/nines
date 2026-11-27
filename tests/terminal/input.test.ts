// The terminal's input line without a browser: history, Tab completion and the editor buffer.

import { describe, expect, it } from 'vitest';
import { complete } from '../../src/terminal/complete';
import { gutter, insertIndent, isDirty, lineCol, normalizeText, tabLines, TAB_MARK } from '../../src/terminal/editor';
import { down, HISTORY_LIMIT, newHistory, record, up } from '../../src/terminal/history';
import { run } from '../../src/sim/session';
import { content, FIXTURE, session } from '../helpers';

describe('history', () => {
  const filled = () => ['ls', 'df -h', 'cd /var'].reduce(record, newHistory());

  it('walks back with up and forward with down, and returns the draft at the end', () => {
    let h = filled();
    let r = up(h, 'cat no');
    expect(r.line).toBe('cd /var');
    r = up(r.history, r.line);
    expect(r.line).toBe('df -h');
    r = up(r.history, r.line);
    expect(r.line).toBe('ls');
    r = up(r.history, r.line);
    expect(r.line).toBe('ls'); // stays on the oldest
    r = down(r.history, r.line);
    expect(r.line).toBe('df -h');
    r = down(r.history, r.line);
    r = down(r.history, r.line);
    expect(r.line).toBe('cat no'); // the draft comes back
    h = r.history;
    expect(down(h, 'cat no').line).toBe('cat no');
  });
  it('up and down on an empty history leave the line alone', () => {
    expect(up(newHistory(), 'x').line).toBe('x');
    expect(down(newHistory(), 'x').line).toBe('x');
  });
  it('skips blank lines and repeats, resets to the draft and keeps a limit', () => {
    let h = record(record(record(newHistory(), 'ls'), 'ls'), '   ');
    expect(h.entries).toEqual(['ls']);
    h = up(h, '').history;
    h = record(h, 'pwd');
    expect(h.pos).toBe(h.entries.length);
    expect(h.draft).toBe('');
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = record(h, `echo ${i}`);
    expect(h.entries).toHaveLength(HISTORY_LIMIT);
    expect(h.entries.at(-1)).toBe(`echo ${HISTORY_LIMIT + 19}`);
  });
});

describe('tab completion', () => {
  const s = () => session(FIXTURE).state;
  const tab = (line: string, cursor = line.length) => complete(s(), line, cursor);

  it('completes a unique command with a space', () => {
    expect(tab('jour')).toEqual({ line: 'journalctl ', cursor: 11, options: [] });
    expect(tab('sudo systemc').line).toBe('sudo systemctl ');
  });
  it('lists ambiguous commands and extends to a common prefix', () => {
    expect(tab('c').options).toEqual(['cat', 'cd', 'clear']);
    expect(tab('c').line).toBe('c');
    expect(tab('vi').options).toEqual(['vi', 'vim']);
    expect(tab('hel').line).toBe('help ');
  });
  it('completes subcommands, units and deployments', () => {
    expect(tab('systemctl res').line).toBe('systemctl restart ');
    expect(tab('systemctl restart w').line).toBe('systemctl restart web ');
    expect(tab('systemctl status ').options).toEqual(['db', 'web']);
    expect(tab('journalctl -u d').line).toBe('journalctl -u db ');
    expect(tab('git co').line).toBe('git commit ');
    expect(tab('kubectl rollout restart dep').line).toBe('kubectl rollout restart deployment/api ');
    expect(tab('kubectl logs deploy').line).toBe('kubectl logs deployment/api ');
  });
  it('completes paths relative to cwd, absolute and from home', () => {
    expect(tab('cat no').line).toBe('cat notes.txt ');
    expect(tab('cd re').line).toBe('cd repo/');
    expect(tab('ls /var/l').line).toBe('ls /var/l'); // log and lib: nothing in common
    expect(tab('ls /var/l').options).toEqual(['lib/', 'log/']);
    expect(tab('ls /var/lo').line).toBe('ls /var/log/');
    expect(tab('cat /var/log/').options).toEqual(['app.log', 'old.gz']);
    expect(tab('cat ~/repo/R').line).toBe('cat ~/repo/README.md ');
    expect(tab('cd ~').line).toBe('cd ~/');
    expect(tab('cat ../dev/no').line).toBe('cat ../dev/notes.txt ');
  });
  it('hides dotfiles unless the word starts with a dot', () => {
    expect(tab('cat ').options).toEqual(['empty/', 'notes.txt', 'repo/']);
    expect(tab('cat .h').line).toBe('cat .hidden ');
  });
  it('follows the current working directory of the session', () => {
    const sess = session(FIXTURE);
    run(sess, 'cd /var/log');
    expect(complete(sess.state, 'tail ap', 7).line).toBe('tail app.log ');
  });
  it('completes the word at the cursor and after a pipe', () => {
    const line = 'cat no | grep x';
    const r = complete(s(), line, 6);
    expect(r.line).toBe('cat notes.txt | grep x');
    expect(r.cursor).toBe(14);
    expect(tab('cat notes.txt | gr').line).toBe('cat notes.txt | grep ');
  });
  it('leaves quotes, flags and unknown words alone', () => {
    expect(tab("grep 'no")).toEqual({ line: "grep 'no", cursor: 8, options: [] });
    expect(tab('ls -l').options).toEqual([]);
    expect(tab('cat zzz')).toEqual({ line: 'cat zzz', cursor: 7, options: [] });
    expect(tab('cat /nope/x').options).toEqual([]);
  });
  it('names on Object.prototype are not commands', () => {
    expect(tab('constructor').options).toEqual([]);
    expect(tab('__proto__ x').line).toBe('__proto__ x');
  });
  it('finds the files the three MVP quests need', () => {
    const quest = (id: string) => session(content().quests.find((q) => q.id === id)!.scenario!).state;
    expect(complete(quest('broken-pipeline'), 'edit .n', 7).line).toBe('edit .nines-ci.yml ');
    expect(complete(quest('service-down'), 'edit /etc/nginx/conf.d/s', 24).line).toBe('edit /etc/nginx/conf.d/shop.conf ');
    expect(complete(quest('disk-full'), 'rm /var/log/nginx/access.log.', 29).options).toContain('access.log.2.gz');
  });
});

describe('editor buffer', () => {
  const yaml = 'stages:\n  - build\ntest:\n  script:\n\t- npm test\n';

  it('finds and marks the lines with a tab', () => {
    expect(tabLines(yaml)).toEqual([5]);
    expect(gutter(yaml)).toEqual(['1 ', '2 ', '3 ', '4 ', `5${TAB_MARK}`, '6 ']);
    expect(gutter('a\n'.repeat(11))[0]).toBe(' 1 ');
    expect(tabLines('no tabs')).toEqual([]);
  });
  it('reports line and column', () => {
    expect(lineCol(yaml, 0)).toEqual({ line: 1, col: 1 });
    expect(lineCol(yaml, 8)).toEqual({ line: 2, col: 1 });
    expect(lineCol(yaml, 11)).toEqual({ line: 2, col: 4 });
    expect(lineCol(yaml, 9999)).toEqual({ line: 6, col: 1 });
  });
  it('Tab inserts two spaces, replacing a selection', () => {
    expect(insertIndent('ab', 1, 1)).toEqual({ text: 'a  b', cursor: 3 });
    expect(insertIndent('a\tb', 1, 2)).toEqual({ text: 'a  b', cursor: 3 });
    expect(insertIndent('a\tb', 2, 1)).toEqual({ text: 'a  b', cursor: 3 });
  });
  it('replacing the tab fixes the file for the CI validator', () => {
    const at = yaml.indexOf('\t');
    const fixed = insertIndent(yaml, at, at + 1).text.replace('script:\n  -', 'script:\n    -');
    expect(tabLines(fixed)).toEqual([]);
  });
  it('knows when the buffer changed, ignoring line-ending style', () => {
    expect(isDirty('a\nb', 'a\r\nb')).toBe(false);
    expect(isDirty('a\nb', 'a\nc')).toBe(true);
    expect(normalizeText('a\r\nb\rc')).toBe('a\nb\nc');
  });
});
